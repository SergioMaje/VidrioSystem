import { useState } from 'react'
import { Loader2, Receipt, TrendingDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { useVentasSesion } from '@/hooks/useVentasCaja'
import { useAnularGasto, useMovimientosSesion } from '@/hooks/useMovimientosCaja'
import { CATEGORIA_GASTO_LABEL, METODO_PAGO_LABEL, esGastoVivo, totalGastosEfectivo } from '@/lib/pagos'
import { formatCOP, formatHora, mensajeError } from '@/lib/utils'
import type { CashRegisterSession, MovimientoCajaConUsuario } from '@/types/database'
import { RegistrarGastoDialog } from './RegistrarGastoDialog'

/**
 * Las salidas de dinero del turno. Los gastos en efectivo descuentan del arqueo
 * del cierre, así que lo que se registra aquí es lo que evita que la diferencia
 * final salga en rojo sin explicación.
 */
export function MovimientosTab({ sesion }: { sesion: CashRegisterSession }) {
  const { usuario } = useAuth()
  const { data: movimientos, isLoading } = useMovimientosSesion(sesion.id)
  const { data: ventas } = useVentasSesion(sesion.id)
  const [registrarOpen, setRegistrarOpen] = useState(false)
  const [aAnular, setAAnular] = useState<MovimientoCajaConUsuario | null>(null)

  const esAdmin = usuario?.rol === 'admin'
  const vivos = (movimientos ?? []).filter(esGastoVivo)
  const gastosEfectivo = totalGastosEfectivo(movimientos)
  const totalGastos = vivos.reduce((suma, m) => suma + m.monto, 0)

  const ventasEfectivo = (ventas ?? []).reduce(
    (suma, v) => (v.metodo_pago === 'efectivo' ? suma + v.monto : suma),
    0
  )
  const efectivoDisponible = sesion.opening_amount + ventasEfectivo - gastosEfectivo

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Gastos del turno</CardTitle>
            <p className="text-sm text-muted-foreground">
              Salidas de dinero: domicilios, transporte, papelería, retiros.
            </p>
          </div>
          <Button onClick={() => setRegistrarOpen(true)}>
            <TrendingDown className="mr-2 h-4 w-4" />
            Registrar gasto
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div className="rounded-md border p-2 text-center">
              <p className="text-xs text-muted-foreground">Total gastos</p>
              <p className="font-mono font-semibold">{formatCOP(totalGastos)}</p>
            </div>
            <div className="rounded-md border p-2 text-center">
              <p className="text-xs text-muted-foreground">En efectivo</p>
              <p className="font-mono font-semibold text-destructive">−{formatCOP(gastosEfectivo)}</p>
            </div>
            <div className="rounded-md border p-2 text-center">
              <p className="text-xs text-muted-foreground">Efectivo en caja</p>
              <p className="font-mono font-semibold text-primary">{formatCOP(efectivoDisponible)}</p>
            </div>
          </div>

          {isLoading ? (
            <LoadingSpinner className="py-8" />
          ) : !movimientos || movimientos.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="Sin gastos en este turno"
              description="Registra aquí cada salida de dinero para que el cierre cuadre."
            />
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase text-muted-foreground">
                    <th className="px-3 py-2">Hora</th>
                    <th className="px-3 py-2">Categoría</th>
                    <th className="px-3 py-2">Concepto</th>
                    <th className="px-3 py-2">Método</th>
                    <th className="px-3 py-2">Registró</th>
                    <th className="px-3 py-2 text-right">Monto</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {movimientos.map((m) => {
                    const anulado = !esGastoVivo(m)
                    return (
                      <tr
                        key={m.id}
                        className={`border-b last:border-0 ${anulado ? 'text-muted-foreground line-through' : ''}`}
                      >
                        <td className="px-3 py-2 font-mono text-xs">{formatHora(m.created_at)}</td>
                        <td className="px-3 py-2">
                          <Badge variant="secondary">{CATEGORIA_GASTO_LABEL[m.categoria]}</Badge>
                        </td>
                        <td className="px-3 py-2">
                          {m.concepto}
                          {anulado && (
                            /* El motivo vive junto a la fila: sin él, un gasto tachado
                               es una pregunta sin responder en el arqueo. */
                            <span className="ml-2 text-xs no-underline">
                              <Badge variant="destructive">Anulado</Badge>{' '}
                              {m.motivo_anulacion}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">{METODO_PAGO_LABEL[m.metodo_pago]}</td>
                        <td className="px-3 py-2">
                          {m.usuario ? `${m.usuario.nombre} ${m.usuario.apellido}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">{formatCOP(m.monto)}</td>
                        <td className="px-3 py-2 text-right">
                          {/* Gate cosmético: la garantía de que solo un admin anula
                              está en el RPC anular_movimiento_caja. */}
                          {esAdmin && !anulado && (
                            <Button size="sm" variant="ghost" onClick={() => setAAnular(m)}>
                              Anular
                            </Button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Solo los gastos en efectivo bajan el efectivo esperado del cierre; los pagados por
            transferencia o tarjeta quedan registrados para el reporte.
          </p>
        </CardContent>
      </Card>

      <RegistrarGastoDialog
        efectivoDisponible={efectivoDisponible}
        open={registrarOpen}
        onOpenChange={setRegistrarOpen}
      />
      <AnularGastoDialog movimiento={aAnular} onClose={() => setAAnular(null)} />
    </div>
  )
}

/**
 * Anular exige motivo, así que no sirve el ConfirmDialog compartido. El gasto no
 * se borra: queda tachado con su motivo y deja de contar para el arqueo.
 */
function AnularGastoDialog({
  movimiento,
  onClose,
}: {
  movimiento: MovimientoCajaConUsuario | null
  onClose: () => void
}) {
  const { toast } = useToast()
  const anularGasto = useAnularGasto()
  const [motivo, setMotivo] = useState('')

  const handleClose = () => {
    setMotivo('')
    onClose()
  }

  const handleAnular = async () => {
    if (!movimiento || !motivo.trim()) return
    try {
      await anularGasto.mutateAsync({ movimientoId: movimiento.id, motivo: motivo.trim() })
      toast({ title: 'Gasto anulado', variant: 'success' })
      handleClose()
    } catch (err) {
      toast({ title: mensajeError(err, 'Error al anular el gasto'), variant: 'destructive' })
    }
  }

  return (
    <Dialog open={!!movimiento} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Anular gasto</DialogTitle>
        </DialogHeader>
        {movimiento && (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <div className="flex justify-between">
                <span>{movimiento.concepto}</span>
                <span className="font-mono">{formatCOP(movimiento.monto)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {CATEGORIA_GASTO_LABEL[movimiento.categoria]} ·{' '}
                {METODO_PAGO_LABEL[movimiento.metodo_pago]}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Motivo de la anulación</Label>
              <textarea
                className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                rows={2}
                placeholder="Ej: se registró dos veces"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>Cancelar</Button>
              <Button
                variant="destructive"
                onClick={handleAnular}
                disabled={!motivo.trim() || anularGasto.isPending}
              >
                {anularGasto.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Anular gasto
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
