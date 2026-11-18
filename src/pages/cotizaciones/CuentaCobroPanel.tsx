import { useState } from 'react'
import { Ban, FileOutput, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { AccionesCuentaCobro } from '@/components/shared/AccionesCuentaCobro'
import { useAnularCuentaCobro, useCuentaCobroVigente, useEmitirCuentaCobro } from '@/hooks/useCartera'
import { useToast } from '@/hooks/useToast'
import { MOTIVO_ANULACION_MIN } from '@/lib/anulacion'
import { estaLiquidada } from '@/lib/pagos'
import { formatCOP, formatFecha, hoyBogota, mensajeError } from '@/lib/utils'
import type { Cotizacion } from '@/types/database'

/**
 * La cuenta de cobro de una venta a crédito, dentro de la tarjeta de pagos:
 * imprimirla, emitirla antes de entregar (si la empresa la pide con la OC) o,
 * siendo admin, anularla para emitir otra.
 */
export function CuentaCobroPanel({
  cotizacion,
  saldo,
  esAdmin,
}: {
  cotizacion: Cotizacion
  saldo: number
  esAdmin: boolean
}) {
  const { toast } = useToast()
  const { data: cuenta, isLoading } = useCuentaCobroVigente(cotizacion.id)
  const emitir = useEmitirCuentaCobro()
  const anular = useAnularCuentaCobro()
  const [anularOpen, setAnularOpen] = useState(false)
  const [motivo, setMotivo] = useState('')

  if (isLoading) return null

  const onEmitir = async () => {
    try {
      const cc = await emitir.mutateAsync(cotizacion.id)
      toast({ title: `Cuenta de cobro ${cc.numero} emitida`, variant: 'success' })
    } catch (err) {
      toast({ title: mensajeError(err, 'No se pudo emitir la cuenta de cobro'), variant: 'destructive' })
    }
  }

  const onAnular = async () => {
    if (!cuenta) return
    try {
      await anular.mutateAsync({ cuentaId: cuenta.id, motivo: motivo.trim(), cotizacionId: cotizacion.id })
      toast({ title: `Cuenta de cobro ${cuenta.numero} anulada`, variant: 'success' })
      setAnularOpen(false)
      setMotivo('')
    } catch (err) {
      toast({ title: mensajeError(err, 'No se pudo anular la cuenta de cobro'), variant: 'destructive' })
    }
  }

  const vencida = !!cuenta && !estaLiquidada(saldo) && hoyBogota() > cuenta.fecha_vencimiento

  return (
    <div className="rounded-md border px-3 py-2 text-sm">
      {cuenta ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-muted-foreground">Cuenta de cobro</span>
          <AccionesCuentaCobro cuentaId={cuenta.id} numero={cuenta.numero} />
          <span className="font-mono">{formatCOP(cuenta.monto)}</span>
          <span className={vencida ? 'font-medium text-destructive' : 'text-muted-foreground'}>
            {vencida ? 'Venció' : 'Vence'} el {formatFecha(cuenta.fecha_vencimiento)}
          </span>
          {estaLiquidada(saldo) && <Badge variant="success">Pagada</Badge>}
          {esAdmin && !estaLiquidada(saldo) && (
            <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => setAnularOpen(true)}>
              <Ban className="mr-1 h-3.5 w-3.5" />
              Anular
            </Button>
          )}
        </div>
      ) : estaLiquidada(saldo) ? (
        <span className="text-muted-foreground">Pagada sin cuenta de cobro.</span>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground">
            La cuenta de cobro se emite al entregar la orden. Si la empresa la pide antes, emítela ahora.
          </span>
          <Button size="sm" variant="outline" onClick={onEmitir} disabled={emitir.isPending}>
            {emitir.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileOutput className="mr-2 h-4 w-4" />}
            Emitir cuenta de cobro
          </Button>
        </div>
      )}

      <Dialog open={anularOpen} onOpenChange={setAnularOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Anular cuenta de cobro {cuenta?.numero}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Los pagos y la orden no cambian. Después puedes emitir otra cuenta de cobro por el saldo de hoy.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="motivo-anular-cc">Motivo</Label>
              <textarea
                id="motivo-anular-cc"
                className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                rows={2}
                placeholder="Ej: la orden de compra estaba equivocada"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
              {motivo.length > 0 && motivo.trim().length < MOTIVO_ANULACION_MIN && (
                <p className="text-xs text-muted-foreground">Mínimo {MOTIVO_ANULACION_MIN} caracteres.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnularOpen(false)}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={onAnular}
              disabled={anular.isPending || motivo.trim().length < MOTIVO_ANULACION_MIN}
            >
              {anular.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Anular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
