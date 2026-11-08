import { useState } from 'react'
import { AlertCircle, Ban, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { PistaConfirmar } from '@/components/shared/Kbd'
import { useAnularCotizacion, usePreviaAnulacionCotizacion, type PreviaAnulacionCotizacion } from '@/hooks/useVentasCaja'
import { useToast } from '@/hooks/useToast'
import { useAtajoConfirmar } from '@/hooks/useAtajoConfirmar'
import { MOTIVO_ANULACION_MIN, efectoEnCaja, type Efecto } from '@/lib/anulacion'
import { METODO_PAGO_LABEL, TIPO_PAGO_LABEL } from '@/lib/pagos'
import { formatCOP, formatFecha, mensajeError } from '@/lib/utils'
import type { Cotizacion, TipoAnulacionCotizacion } from '@/types/database'

/** Cobros en efectivo de cajas ya cerradas: los únicos a los que afecta el tipo. */
function efectivoDeCajasCerradas(previa: PreviaAnulacionCotizacion) {
  return previa.cobros
    .filter((c) => c.venta.metodo_pago === 'efectivo' && c.cajaOriginal?.status !== 'open')
    .reduce((s, c) => s + c.venta.monto, 0)
}

/** Efectos sobre la orden. Espejo de las validaciones de `anular_cotizacion`. */
function efectosEnOrden(previa: PreviaAnulacionCotizacion): Efecto[] {
  const avanzada = previa.ordenes.find((o) => o.estado !== 'pendiente')
  if (avanzada) {
    return [{
      texto: `La orden ${avanzada.numero} ya no está pendiente (${avanzada.estado.replace('_', ' ')}): resuelve la orden antes de anular la cotización.`,
      bloquea: true,
    }]
  }
  if (previa.materialConsumido) {
    return [{
      texto: 'La orden ya consumió material del inventario: decide qué hacer con ese material antes de anular la cotización.',
      bloquea: true,
    }]
  }
  return previa.ordenes.map((o) => ({ texto: `La orden ${o.numero} se cancela (aún no había empezado).` }))
}

/**
 * Anula una cotización vendida completa: todos sus cobros, la orden pendiente
 * y la cotización, que queda en 'anulada'. Para un cobro suelto (el duplicado
 * dentro de una venta válida) sigue estando AnularVentaDialog.
 */
export function AnularCotizacionDialog({
  cotizacion,
  open,
  onClose,
}: {
  cotizacion: Pick<Cotizacion, 'id' | 'numero'>
  open: boolean
  onClose: () => void
}) {
  const { toast } = useToast()
  const anular = useAnularCotizacion()
  const { data: previa, isLoading, error } = usePreviaAnulacionCotizacion(open ? cotizacion.id : null)
  const [tipo, setTipo] = useState<TipoAnulacionCotizacion | null>(null)
  const [motivo, setMotivo] = useState('')

  const handleClose = () => {
    setTipo(null)
    setMotivo('')
    onClose()
  }

  const efectosCaja = previa ? previa.cobros.map((c) => efectoEnCaja(c.venta, { cajaOriginal: c.cajaOriginal, cajaAbierta: previa.cajaAbierta })) : []
  const efectosOrden = previa ? efectosEnOrden(previa) : []
  const sinCobros = !!previa && previa.cobros.length === 0
  const bloqueada = sinCobros || [...efectosCaja.flat(), ...efectosOrden].some((e) => e.bloquea)
  const enCajasCerradas = previa ? efectivoDeCajasCerradas(previa) : 0
  const totalCobrado = previa?.cobros.reduce((s, c) => s + c.venta.monto, 0) ?? 0

  const motivoValido = motivo.trim().length >= MOTIVO_ANULACION_MIN
  const puedeAnular = !!previa && !bloqueada && tipo !== null && motivoValido && !anular.isPending

  const handleAnular = async () => {
    if (!puedeAnular || !tipo) return
    try {
      await anular.mutateAsync({ cotizacionId: cotizacion.id, motivo: motivo.trim(), tipo })
      toast({ title: `Cotización ${cotizacion.numero} anulada`, variant: 'success' })
      handleClose()
    } catch (err) {
      toast({ title: mensajeError(err, 'Error al anular la cotización'), variant: 'destructive' })
    }
  }

  const atajo = useAtajoConfirmar(handleAnular, { habilitado: open && puedeAnular, conCtrl: true })

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg" onKeyDown={atajo}>
        <DialogHeader>
          <DialogTitle>Anular cotización {cotizacion.numero}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <LoadingSpinner className="py-6" />
        ) : error ? (
          <p className="text-sm text-destructive">{mensajeError(error, 'No se pudo cargar la vista previa')}</p>
        ) : previa && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Cobros que se anulan · {formatCOP(totalCobrado)}
              </p>
              {sinCobros ? (
                <p className="flex gap-2 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  La cotización no tiene cobros activos: no hay nada que anular.
                </p>
              ) : (
                <ul className="space-y-2">
                  {previa.cobros.map((c, i) => (
                    <li key={c.venta.id} className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                      <div className="flex justify-between">
                        <span>
                          {TIPO_PAGO_LABEL[c.venta.tipo]} · {METODO_PAGO_LABEL[c.venta.metodo_pago]}
                        </span>
                        <span className="font-mono font-semibold">{formatCOP(c.venta.monto)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">Cobrado el {formatFecha(c.venta.created_at)}</p>
                      {efectosCaja[i].map((e) => (
                        <p key={e.texto} className={`mt-1 flex gap-1.5 text-xs ${e.bloquea ? 'text-destructive' : 'text-muted-foreground'}`}>
                          {e.bloquea && <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />}
                          {e.texto}
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <ul className="space-y-1.5 text-sm">
              <li className="flex gap-2">
                <Ban className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>
                  La cotización queda <strong>Anulada</strong>: no se le podrán registrar cobros ni editarla.
                </span>
              </li>
              {efectosOrden.map((e) => (
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

            {!bloqueada && (
              <fieldset className="space-y-1.5 rounded-md border px-3 py-2 text-sm">
                <legend className="px-1 text-xs font-medium uppercase text-muted-foreground">
                  ¿Por qué se anula?
                </legend>
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="tipo-anulacion"
                    className="mt-1"
                    checked={tipo === 'desistimiento'}
                    onChange={() => setTipo('desistimiento')}
                  />
                  <span>
                    El cliente desistió (se le devuelve el dinero)
                    {enCajasCerradas > 0 && (
                      <span className="block text-xs text-muted-foreground">
                        Salen {formatCOP(enCajasCerradas)} del efectivo de hoy por los cobros de cajas ya cerradas.
                      </span>
                    )}
                  </span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="tipo-anulacion"
                    className="mt-1"
                    checked={tipo === 'error'}
                    onChange={() => setTipo('error')}
                  />
                  <span>
                    Error de registro (cobro o cotización duplicada)
                    {enCajasCerradas > 0 && (
                      <span className="block text-xs text-muted-foreground">
                        Ese dinero nunca entró: el faltante ya quedó en el arqueo de esos días y el efectivo de hoy no cambia.
                      </span>
                    )}
                  </span>
                </label>
                <p className="text-xs text-muted-foreground">
                  Los cobros de la caja abierta siempre se reversan en ella y corrigen su efectivo esperado.
                </p>
              </fieldset>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="motivo-anulacion-cotizacion">Motivo de la anulación</Label>
              <textarea
                id="motivo-anulacion-cotizacion"
                className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                rows={2}
                placeholder="Ej: el cliente canceló la obra / la cotización se creó dos veces"
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
                {anular.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Anular cotización
                <PistaConfirmar conCtrl />
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
