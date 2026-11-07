import { useState } from 'react'
import { AlertCircle, Ban, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { useAnularVenta, usePreviaAnulacion, type PreviaAnulacion } from '@/hooks/useVentasCaja'
import { useToast } from '@/hooks/useToast'
import { useAtajoConfirmar } from '@/hooks/useAtajoConfirmar'
import { PistaConfirmar } from '@/components/shared/Kbd'
import { cajaVencida } from '@/lib/caja'
import { METODO_PAGO_LABEL, TIPO_PAGO_LABEL } from '@/lib/pagos'
import { formatCOP, formatFecha, mensajeError } from '@/lib/utils'
import type { Cotizacion, Venta } from '@/types/database'

/** El mismo mínimo que exige `anular_venta` y el check de la tabla. */
const MOTIVO_ANULACION_MIN = 10

const ESTADO_COTIZACION_LABEL: Record<Cotizacion['estado'], string> = {
  borrador: 'Borrador',
  enviada: 'Enviada',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
  vencida: 'Vencida',
  vendida: 'Vendida',
}

type Efecto = { texto: string; bloquea?: boolean }

/**
 * Los efectos de anular, en palabras, antes de confirmar. Es un espejo de las
 * reglas del RPC `anular_venta`: si algo cambió entre la vista previa y el
 * clic, el RPC decide y su mensaje llega como error.
 */
function efectosDeAnular(venta: Venta, previa: PreviaAnulacion): Efecto[] {
  const efectos: Efecto[] = []
  const monto = formatCOP(venta.monto)
  const metodo = METODO_PAGO_LABEL[venta.metodo_pago].toLowerCase()

  if (venta.metodo_pago === 'financiera') {
    if (venta.desembolso_id) {
      efectos.push({
        texto: 'La financiera ya desembolsó esta venta: la anulación requiere gestión manual con la financiera.',
        bloquea: true,
      })
    } else {
      efectos.push({
        texto: 'No hay egreso en caja: el dinero del crédito nunca entró. La venta sale de la cartera por desembolsar.',
      })
    }
  } else if (previa.cajaOriginal?.status === 'open') {
    efectos.push({ texto: `Reverso de ${monto} en ${metodo} en la caja del cobro, que sigue abierta.` })
  } else if (!previa.cajaAbierta) {
    efectos.push({
      texto: 'La caja de este cobro ya cerró y no hay una caja abierta. Abre la caja para registrar el reverso.',
      bloquea: true,
    })
  } else {
    efectos.push({
      texto: `La caja del cobro ya cerró (no se modifica). El reverso de ${monto} en ${metodo} va a la caja abierta de hoy.`,
    })
    if (cajaVencida(previa.cajaAbierta.opened_at)) {
      efectos.push({
        texto: `La caja abierta es del ${formatFecha(previa.cajaAbierta.opened_at)}: ciérrala y abre la de hoy primero.`,
        bloquea: true,
      })
    }
  }

  if (venta.cotizacion_id && previa.cotizacion) {
    if (previa.otrosCobrosActivos > 0) {
      efectos.push({
        texto: `La cotización ${previa.cotizacion.numero} sigue vendida: le quedan ${previa.otrosCobrosActivos} cobro(s) activo(s). Su saldo pendiente sube en ${monto}.`,
      })
    } else {
      const avanzada = previa.ordenes.find((o) => o.estado !== 'pendiente')
      if (avanzada) {
        efectos.push({
          texto: `La orden ${avanzada.numero} ya no está pendiente (${avanzada.estado.replace('_', ' ')}): anular su único cobro requiere gestión manual de la orden.`,
          bloquea: true,
        })
      } else if (previa.materialConsumido) {
        efectos.push({
          texto: 'La orden ya consumió material del inventario: anular su único cobro requiere decidir qué hacer con ese material.',
          bloquea: true,
        })
      } else {
        const destino = previa.cotizacion.estado_previo_venta ?? 'aprobada'
        efectos.push({
          texto: `Es el único cobro: la cotización ${previa.cotizacion.numero} vuelve a "${ESTADO_COTIZACION_LABEL[destino]}".`,
        })
        for (const orden of previa.ordenes) {
          efectos.push({ texto: `La orden ${orden.numero} se cancela (aún no había empezado).` })
        }
      }
    }
  }

  if (venta.venta_mostrador_id) {
    if (previa.itemsMostrador.length > 0) {
      const lineas = previa.itemsMostrador.map((i) => `${i.cantidad} × ${i.descripcion}`).join(', ')
      efectos.push({ texto: `Vuelve al inventario lo que salió con esta venta: ${lineas}.` })
    }
  }

  return efectos
}

/**
 * Anular un cobro. No se borra nada: queda tachado con su motivo y se registran
 * los movimientos inversos. El botón que abre este diálogo solo se muestra al
 * admin, pero eso es cosmético: la regla vive en el RPC.
 */
export function AnularVentaDialog({
  venta,
  documento,
  onClose,
}: {
  venta: Venta | null
  /** Número de la cotización o de la venta de mostrador. */
  documento: string
  onClose: () => void
}) {
  const { toast } = useToast()
  const anularVenta = useAnularVenta()
  const { data: previa, isLoading, error } = usePreviaAnulacion(venta)
  const [motivo, setMotivo] = useState('')
  const [saleEfectivo, setSaleEfectivo] = useState<boolean | null>(null)

  const handleClose = () => {
    setMotivo('')
    setSaleEfectivo(null)
    onClose()
  }

  const efectos = venta && previa ? efectosDeAnular(venta, previa) : []
  const bloqueada = efectos.some((e) => e.bloquea)
  // Solo hay que preguntar cuando el reverso va a otra caja y es efectivo. En
  // la misma caja abierta el efectivo sí entró, así que sale con el reverso.
  const preguntarEfectivo =
    !!venta &&
    venta.metodo_pago === 'efectivo' &&
    !!previa &&
    previa.cajaOriginal?.status !== 'open' &&
    !!previa.cajaAbierta
  const motivoValido = motivo.trim().length >= MOTIVO_ANULACION_MIN
  const puedeAnular =
    !!previa &&
    !bloqueada &&
    motivoValido &&
    (!preguntarEfectivo || saleEfectivo !== null) &&
    !anularVenta.isPending

  const handleAnular = async () => {
    if (!venta || !puedeAnular) return
    try {
      await anularVenta.mutateAsync({
        venta,
        motivo: motivo.trim(),
        saleEfectivo: preguntarEfectivo ? saleEfectivo === true : true,
      })
      toast({ title: `Venta ${documento} anulada`, variant: 'success' })
      handleClose()
    } catch (err) {
      toast({ title: mensajeError(err, 'Error al anular la venta'), variant: 'destructive' })
    }
  }

  const atajo = useAtajoConfirmar(handleAnular, { habilitado: !!venta && puedeAnular, conCtrl: true })

  return (
    <Dialog open={!!venta} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-md" onKeyDown={atajo}>
        <DialogHeader>
          <DialogTitle>Anular venta</DialogTitle>
        </DialogHeader>
        {venta && (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <div className="flex justify-between">
                <span className="font-mono">{documento}</span>
                <span className="font-mono font-semibold">{formatCOP(venta.monto)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {TIPO_PAGO_LABEL[venta.tipo]} · {METODO_PAGO_LABEL[venta.metodo_pago]} · cobrado el{' '}
                {formatFecha(venta.created_at)}
              </p>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase text-muted-foreground">Qué va a pasar</p>
              {isLoading ? (
                <LoadingSpinner className="py-4" />
              ) : error ? (
                <p className="text-sm text-destructive">{mensajeError(error, 'No se pudo cargar la vista previa')}</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  <li className="flex gap-2">
                    <Ban className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    El cobro queda anulado (no se borra) y deja de sumar en ventas y saldos.
                  </li>
                  {efectos.map((e) => (
                    <li key={e.texto} className={`flex gap-2 ${e.bloquea ? 'text-destructive' : ''}`}>
                      {e.bloquea ? (
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                      ) : (
                        <span className="mt-0.5 w-4 shrink-0 text-center text-muted-foreground">•</span>
                      )}
                      {e.texto}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {preguntarEfectivo && !bloqueada && (
              <fieldset className="space-y-1.5 rounded-md border px-3 py-2 text-sm">
                <legend className="px-1 text-xs font-medium uppercase text-muted-foreground">
                  ¿Sale efectivo del cajón hoy?
                </legend>
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="sale-efectivo"
                    className="mt-1"
                    checked={saleEfectivo === true}
                    onChange={() => setSaleEfectivo(true)}
                  />
                  <span>
                    Sí, se devuelve al cliente
                    <span className="block text-xs text-muted-foreground">
                      El reverso resta {formatCOP(venta.monto)} del efectivo esperado de hoy.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="sale-efectivo"
                    className="mt-1"
                    checked={saleEfectivo === false}
                    onChange={() => setSaleEfectivo(false)}
                  />
                  <span>
                    No, ese dinero nunca entró (cobro duplicado)
                    <span className="block text-xs text-muted-foreground">
                      El faltante ya quedó en el arqueo de ese día: el reverso se registra sin tocar el
                      efectivo de hoy.
                    </span>
                  </span>
                </label>
              </fieldset>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="motivo-anulacion">Motivo de la anulación</Label>
              <textarea
                id="motivo-anulacion"
                className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                rows={2}
                placeholder="Ej: cobro duplicado, la cotización se convirtió dos veces"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
              {motivo.length > 0 && !motivoValido && (
                <p className="text-xs text-muted-foreground">Mínimo {MOTIVO_ANULACION_MIN} caracteres.</p>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancelar
              </Button>
              <Button variant="destructive" onClick={handleAnular} disabled={!puedeAnular}>
                {anularVenta.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Anular venta
                <PistaConfirmar conCtrl />
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Marca visual de un cobro anulado. El motivo queda en el tooltip. */
export function BadgeAnulada({ motivo }: { motivo: string | null }) {
  return (
    <Badge variant="destructive" className="ml-2 no-underline" title={motivo ?? undefined}>
      Anulada
    </Badge>
  )
}
