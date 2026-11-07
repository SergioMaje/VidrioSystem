import { useState } from 'react'
import { Calculator, Keyboard, Loader2, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { InputDinero } from '@/components/shared/InputDinero'
import { useToast } from '@/hooks/useToast'
import { useCerrarCaja } from '@/hooks/useCajaSesiones'
import { useVentasSesion } from '@/hooks/useVentasCaja'
import { useMovimientosSesion } from '@/hooks/useMovimientosCaja'
import { TOLERANCIA_CAJA, calcularArqueo, requiereObservacion, totalDenominaciones, type Cantidades } from '@/lib/caja'
import { cn, formatCOP, mensajeError } from '@/lib/utils'
import { ResumenVentasSesion, type Arqueo } from './ResumenVentasSesion'
import { ContadorDenominaciones } from './cierre/ContadorDenominaciones'
import { EncabezadoTurno } from './cierre/EncabezadoTurno'

type ModoConteo = 'total' | 'billetes'

export function CerrarCajaDialog({
  sessionId,
  openingAmount,
  open,
  onOpenChange,
}: {
  sessionId: string
  openingAmount: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { toast } = useToast()
  const cerrarCaja = useCerrarCaja()
  // Mismas consultas que ResumenVentasSesion (comparten caché): el diálogo
  // necesita el esperado para saber si exigir la observación.
  const { data: ventas } = useVentasSesion(sessionId)
  const { data: movimientos } = useMovimientosSesion(sessionId)
  const [modo, setModo] = useState<ModoConteo>('total')
  const [conteo, setConteo] = useState('')
  const [cantidades, setCantidades] = useState<Cantidades>({})
  const [observacion, setObservacion] = useState('')
  const [resultado, setResultado] = useState<Arqueo | null>(null)

  const contado =
    modo === 'total'
      ? conteo === '' ? null : Number(conteo)
      : Object.values(cantidades).some(Boolean) ? totalDenominaciones(cantidades) : null
  const esperado = calcularArqueo(ventas, movimientos, openingAmount).efectivoEsperado
  const exigeObservacion = contado != null && requiereObservacion(contado - esperado)
  const faltaObservacion = exigeObservacion && !observacion.trim()

  const handleCerrar = async () => {
    if (contado == null || contado < 0 || faltaObservacion) return
    try {
      const sesion = await cerrarCaja.mutateAsync({ sessionId, counted_amount: contado, observacion })
      setResultado({
        expected_amount: sesion.expected_amount ?? 0,
        counted_amount: sesion.counted_amount ?? contado,
        difference: sesion.difference ?? 0,
        observacion_cierre: sesion.observacion_cierre,
      })
      toast({ title: 'Caja cerrada', variant: 'success' })
    } catch (err) {
      toast({ title: mensajeError(err, 'Error al cerrar caja'), variant: 'destructive' })
    }
  }

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setConteo('')
      setCantidades({})
      setObservacion('')
      setModo('total')
      setResultado(null)
    }
    onOpenChange(isOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="max-h-[90vh] max-w-3xl overflow-y-auto [&>*]:min-w-0"
        data-imprimir={resultado ? '' : undefined}
      >
        <DialogHeader>
          <DialogTitle>{resultado ? 'Cierre de caja' : 'Cerrar caja'}</DialogTitle>
        </DialogHeader>

        <EncabezadoTurno sessionId={sessionId} />

        {resultado ? (
          <ResumenVentasSesion sessionId={sessionId} openingAmount={openingAmount} arqueo={resultado} />
        ) : (
          <>
            <section className="space-y-3 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="conteo-total" className="text-sm font-semibold">
                  Conteo físico de efectivo
                </Label>
                <div className="flex gap-1 rounded-md bg-muted p-1" role="group" aria-label="Forma de contar">
                  <BotonModo activo={modo === 'total'} onClick={() => setModo('total')}>
                    <Keyboard className="mr-1.5 h-4 w-4" aria-hidden /> Digitar total
                  </BotonModo>
                  <BotonModo activo={modo === 'billetes'} onClick={() => setModo('billetes')}>
                    <Calculator className="mr-1.5 h-4 w-4" aria-hidden /> Contar billetes
                  </BotonModo>
                </div>
              </div>
              {modo === 'total' ? (
                <InputDinero id="conteo-total" value={conteo} onChange={setConteo} inputClassName="text-lg" />
              ) : (
                <ContadorDenominaciones cantidades={cantidades} onChange={setCantidades} />
              )}

              <div className="space-y-1">
                <Label htmlFor="observacion-cierre">
                  Observación {exigeObservacion ? <span className="text-destructive">(obligatoria)</span> : '(opcional)'}
                </Label>
                <textarea
                  id="observacion-cierre"
                  value={observacion}
                  onChange={(e) => setObservacion(e.target.value)}
                  rows={2}
                  aria-invalid={faltaObservacion}
                  aria-describedby="observacion-ayuda"
                  placeholder="Ej.: abono que no se registró, billete devuelto, error en un cambio…"
                  className={cn(
                    'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    faltaObservacion && 'border-destructive'
                  )}
                />
                <p id="observacion-ayuda" className="text-xs text-muted-foreground">
                  Si la diferencia supera {formatCOP(TOLERANCIA_CAJA)}, explica la causa para poder cerrar.
                </p>
              </div>
            </section>

            <ResumenVentasSesion sessionId={sessionId} openingAmount={openingAmount} contado={contado} />
          </>
        )}

        <DialogFooter className="gap-2 print:hidden">
          {resultado ? (
            <>
              <Button variant="outline" onClick={() => window.print()}>
                <Printer className="mr-2 h-4 w-4" />
                Imprimir / PDF
              </Button>
              <Button onClick={() => handleClose(false)}>Listo</Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => handleClose(false)}>Cancelar</Button>
              <Button onClick={handleCerrar} disabled={cerrarCaja.isPending || contado == null || faltaObservacion}>
                {cerrarCaja.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirmar cierre
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BotonModo({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      onClick={onClick}
      className={cn(
        'inline-flex items-center rounded-sm px-2.5 py-1 text-sm font-medium text-muted-foreground',
        activo && 'bg-background text-foreground shadow-sm'
      )}
    >
      {children}
    </button>
  )
}
