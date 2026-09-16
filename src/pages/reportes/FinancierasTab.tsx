import { useMemo, useState } from 'react'
import { AlertTriangle, HandCoins, Landmark, Loader2, Percent } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { useCuentasPagoEmpresa } from '@/hooks/useCuentasPagoEmpresa'
import {
  useAnularDesembolso,
  useDesembolsos,
  useFinancieras,
  useRegistrarDesembolso,
  useVentasPorDesembolsar,
} from '@/hooks/useFinancieras'
import type { DesembolsoConDetalle } from '@/hooks/useFinancieras'
import { fechaISOLocal, formatCOP, formatFecha, formatMiles, mensajeError, soloDigitos } from '@/lib/utils'
import type { VentaPorDesembolsar } from '@/types/database'

const SIN_CUENTA = 'sin-cuenta'

/**
 * Lo que las financieras le deben a la vidriería y lo que ya pagaron. Aquí se
 * concilia: se marcan las ventas que cubre una transferencia y se anota lo que
 * llegó; la diferencia con lo vendido es la comisión real.
 */
export function FinancierasTab({ desde, hasta }: { desde: string; hasta: string }) {
  const { usuario } = useAuth()
  const esAdmin = usuario?.rol === 'admin'
  const { data: financieras } = useFinancieras()
  const { data: pendientes, isLoading: cargandoPendientes } = useVentasPorDesembolsar()
  const { data: desembolsos, isLoading: cargandoDesembolsos } = useDesembolsos(desde, hasta)

  const [filtro, setFiltro] = useState<string>('')
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [registrarOpen, setRegistrarOpen] = useState(false)
  const [aAnular, setAAnular] = useState<DesembolsoConDetalle | null>(null)

  // Una transferencia viene de una sola financiera: sin filtro no se concilia.
  const financieraId = filtro || null
  const visibles = (pendientes ?? []).filter((v) => !financieraId || v.financiera_id === financieraId)
  const seleccionadas = visibles.filter((v) => seleccion.has(v.venta_id))

  const porFinanciera = useMemo(() => {
    const mapa = new Map<string, { nombre: string; total: number; num: number; vencido: number; comision: number }>()
    for (const v of pendientes ?? []) {
      const fila = mapa.get(v.financiera_id) ?? { nombre: v.financiera, total: 0, num: 0, vencido: 0, comision: 0 }
      fila.total += v.monto
      fila.num += 1
      fila.comision += v.comision_estimada
      if (v.vencida) fila.vencido += v.monto
      mapa.set(v.financiera_id, fila)
    }
    return Array.from(mapa.entries())
  }, [pendientes])

  const vivos = (desembolsos ?? []).filter((d) => !d.anulado_at)
  const recibido = vivos.reduce((s, d) => s + d.monto_recibido, 0)
  const cubierto = vivos.reduce((s, d) => s + d.total_ventas, 0)
  const comisionReal = vivos.reduce((s, d) => s + d.comision_real, 0)
  const comisionEstimada = vivos.reduce((s, d) => s + d.comision_estimada, 0)

  const cambiarFiltro = (valor: string) => {
    setFiltro(valor === 'todas' ? '' : valor)
    setSeleccion(new Set())
  }

  // Marcar una venta sin filtro elige su financiera: cada desembolso viene de una
  // sola, y así no hay que adivinar que primero se filtra.
  const alternar = (venta: VentaPorDesembolsar) => {
    if (!financieraId) setFiltro(venta.financiera_id)
    setSeleccion((prev) => {
      const siguiente = new Set(prev)
      if (siguiente.has(venta.venta_id)) siguiente.delete(venta.venta_id)
      else siguiente.add(venta.venta_id)
      return siguiente
    })
  }

  const financierasVisibles = new Set(visibles.map((v) => v.financiera_id))
  const todasMarcadas = visibles.length > 0 && seleccionadas.length === visibles.length
  const alternarTodas = () => {
    if (!financieraId && financierasVisibles.size === 1) setFiltro(visibles[0].financiera_id)
    setSeleccion(todasMarcadas ? new Set() : new Set(visibles.map((v) => v.venta_id)))
  }

  return (
    <div className="space-y-4">
      {/* ── Lo que deben ─────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {porFinanciera.length === 0 ? (
          <Card className="sm:col-span-2 lg:col-span-3">
            <CardContent className="p-5 text-sm text-muted-foreground">
              {cargandoPendientes ? 'Cargando...' : 'Ninguna financiera tiene desembolsos pendientes.'}
            </CardContent>
          </Card>
        ) : (
          porFinanciera.map(([id, f]) => (
            <Card key={id}>
              <CardContent className="flex items-start gap-4 p-5">
                <HandCoins className="h-8 w-8 shrink-0 text-violet-600" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium uppercase text-muted-foreground">{f.nombre} — por desembolsar</p>
                  <p className="text-2xl font-bold">{formatCOP(f.total)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {f.num} {f.num === 1 ? 'venta' : 'ventas'} · recibirías aprox. {formatCOP(f.total - f.comision)}
                  </p>
                  {f.vencido > 0 && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
                      <AlertTriangle className="h-3 w-3" />
                      {formatCOP(f.vencido)} pasaron el plazo pactado
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* ── Conciliar ────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3 space-y-0 pb-3">
          <div>
            <CardTitle className="text-base">Ventas por desembolsar</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Cuando llegue una transferencia de la financiera, filtra por ella, marca las ventas que cubre y registra el desembolso.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Financiera</Label>
              <Select value={filtro || 'todas'} onValueChange={cambiarFiltro}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {(financieras ?? []).map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => setRegistrarOpen(true)} disabled={!financieraId || seleccionadas.length === 0}>
              <Landmark className="mr-2 h-4 w-4" />
              Registrar desembolso{seleccionadas.length > 0 ? ` (${seleccionadas.length})` : ''}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {visibles.length > 0 && seleccionadas.length === 0 && (
            <p className="border-y bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
              Marca las ventas que cubre la transferencia para habilitar "Registrar desembolso". Cada desembolso es de una sola financiera.
            </p>
          )}
          {cargandoPendientes ? (
            <LoadingSpinner className="py-12" />
          ) : visibles.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No hay ventas pendientes de desembolso</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase text-muted-foreground">
                    <th className="px-4 py-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        aria-label="Marcar todas"
                        disabled={!financieraId && financierasVisibles.size > 1}
                        checked={todasMarcadas}
                        onChange={alternarTodas}
                      />
                    </th>
                    <th className="px-4 py-3">Fecha venta</th>
                    <th className="px-4 py-3">Documento</th>
                    <th className="px-4 py-3">Cliente</th>
                    <th className="px-4 py-3">Financiera</th>
                    <th className="px-4 py-3">Referencia</th>
                    <th className="px-4 py-3 text-right">Días</th>
                    <th className="px-4 py-3 text-right">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((v) => (
                    <tr key={v.venta_id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          aria-label={`Marcar ${v.documento ?? 'venta'}`}
                          checked={seleccion.has(v.venta_id)}
                          onChange={() => alternar(v)}
                        />
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{formatFecha(v.created_at)}</td>
                      <td className="px-4 py-3 font-mono text-xs font-medium">{v.documento ?? '—'}</td>
                      <td className="px-4 py-3">{v.cliente ?? 'Público general'}</td>
                      <td className="px-4 py-3">{v.financiera}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{v.referencia_financiera ?? '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <Badge variant={v.vencida ? 'destructive' : 'outline'}>
                          {v.dias} / {v.dias_desembolso}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">{formatCOP(v.monto)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/50">
                    <td colSpan={7} className="px-4 py-3 text-right text-xs font-semibold uppercase text-muted-foreground">
                      Total por desembolsar
                    </td>
                    <td className="px-4 py-3 text-right font-bold">
                      {formatCOP(visibles.reduce((s, v) => s + v.monto, 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Lo que llegó en el período ───────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="flex items-start gap-4 p-5">
            <Landmark className="h-8 w-8 shrink-0 text-blue-600" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase text-muted-foreground">Desembolsos recibidos en el período</p>
              <p className="text-3xl font-bold">{formatCOP(recibido)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Por ventas de {formatCOP(cubierto)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start gap-4 p-5">
            <Percent className="h-8 w-8 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase text-muted-foreground">Comisión de financieras</p>
              <p className="text-3xl font-bold">{formatCOP(comisionReal)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Estimada {formatCOP(comisionEstimada)} · diferencia{' '}
                <span className={comisionReal > comisionEstimada ? 'text-destructive' : ''}>
                  {formatCOP(comisionReal - comisionEstimada)}
                </span>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Historial de desembolsos</CardTitle>
          <p className="text-sm text-muted-foreground">Por fecha de llegada al banco, dentro del período filtrado.</p>
        </CardHeader>
        <CardContent className="p-0">
          {cargandoDesembolsos ? (
            <LoadingSpinner className="py-12" />
          ) : !desembolsos || desembolsos.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No hay desembolsos en el período</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase text-muted-foreground">
                    <th className="px-4 py-3">Fecha</th>
                    <th className="px-4 py-3">Financiera</th>
                    <th className="px-4 py-3">Cuenta</th>
                    <th className="px-4 py-3">Referencia</th>
                    <th className="px-4 py-3 text-right">Ventas</th>
                    <th className="px-4 py-3 text-right">Vendido</th>
                    <th className="px-4 py-3 text-right">Recibido</th>
                    <th className="px-4 py-3 text-right">Comisión</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {desembolsos.map((d) => {
                    const anulado = !!d.anulado_at
                    return (
                      <tr key={d.id} className={`border-b last:border-0 ${anulado ? 'text-muted-foreground' : ''}`}>
                        <td className="px-4 py-3">{formatFecha(d.fecha + 'T00:00:00')}</td>
                        <td className="px-4 py-3">
                          {d.financiera?.nombre ?? '—'}
                          {anulado && (
                            <span className="ml-2 text-xs">
                              <Badge variant="destructive">Anulado</Badge> {d.motivo_anulacion}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">{d.cuenta ? d.cuenta.alias ?? d.cuenta.banco : '—'}</td>
                        <td className="px-4 py-3 font-mono text-xs">{d.referencia ?? '—'}</td>
                        <td className={`px-4 py-3 text-right font-mono ${anulado ? 'line-through' : ''}`}>{d.num_ventas}</td>
                        <td className={`px-4 py-3 text-right font-mono ${anulado ? 'line-through' : ''}`}>{formatCOP(d.total_ventas)}</td>
                        <td className={`px-4 py-3 text-right font-semibold ${anulado ? 'line-through' : ''}`}>{formatCOP(d.monto_recibido)}</td>
                        <td className={`px-4 py-3 text-right font-mono ${anulado ? 'line-through' : ''}`}>
                          {formatCOP(d.comision_real)}
                          {d.total_ventas > 0 && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              ({((d.comision_real / d.total_ventas) * 100).toFixed(1)}%)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {/* Gate cosmético: la garantía está en anular_desembolso_financiera. */}
                          {esAdmin && !anulado && (
                            <Button size="sm" variant="ghost" onClick={() => setAAnular(d)}>Anular</Button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {financieraId && (
        <RegistrarDesembolsoDialog
          open={registrarOpen}
          onOpenChange={setRegistrarOpen}
          financieraId={financieraId}
          financieraNombre={financieras?.find((f) => f.id === financieraId)?.nombre ?? ''}
          ventas={seleccionadas}
          onRegistrado={() => setSeleccion(new Set())}
        />
      )}
      <AnularDesembolsoDialog desembolso={aAnular} onClose={() => setAAnular(null)} />
    </div>
  )
}

function RegistrarDesembolsoDialog({
  open,
  onOpenChange,
  financieraId,
  financieraNombre,
  ventas,
  onRegistrado,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  financieraId: string
  financieraNombre: string
  ventas: VentaPorDesembolsar[]
  onRegistrado: () => void
}) {
  const { toast } = useToast()
  const registrar = useRegistrarDesembolso()
  const { data: cuentas } = useCuentasPagoEmpresa()

  const totalVentas = ventas.reduce((s, v) => s + v.monto, 0)
  const comisionEstimada = ventas.reduce((s, v) => s + v.comision_estimada, 0)

  const [fecha, setFecha] = useState(fechaISOLocal(new Date()))
  const [monto, setMonto] = useState('')
  const [cuentaId, setCuentaId] = useState(SIN_CUENTA)
  const [referencia, setReferencia] = useState('')
  const [notas, setNotas] = useState('')

  // Precarga lo esperado (ventas − comisión estimada) cada vez que se abre: lo
  // normal es corregirlo al valor exacto del extracto.
  const [abiertoCon, setAbiertoCon] = useState<string | null>(null)
  const firma = open ? ventas.map((v) => v.venta_id).join(',') : null
  if (firma !== abiertoCon) {
    setAbiertoCon(firma)
    if (open) {
      setFecha(fechaISOLocal(new Date()))
      setMonto(String(Math.round(totalVentas - comisionEstimada)))
      setCuentaId(SIN_CUENTA)
      setReferencia('')
      setNotas('')
    }
  }

  const montoNum = Number(monto) || 0
  const comisionReal = totalVentas - montoNum
  const excede = montoNum > totalVentas
  const puedeConfirmar = montoNum > 0 && !excede && !!fecha && ventas.length > 0 && !registrar.isPending

  const handleConfirmar = async () => {
    if (!puedeConfirmar) return
    try {
      await registrar.mutateAsync({
        financieraId,
        fecha,
        montoRecibido: montoNum,
        ventaIds: ventas.map((v) => v.venta_id),
        cuentaId: cuentaId === SIN_CUENTA ? null : cuentaId,
        referencia,
        notas,
      })
      toast({ title: `Desembolso de ${financieraNombre} registrado`, description: formatCOP(montoNum), variant: 'success' })
      onRegistrado()
      onOpenChange(false)
    } catch (err) {
      toast({ title: mensajeError(err, 'Error al registrar el desembolso'), variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Desembolso de {financieraNombre}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1 rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Ventas cubiertas</span>
              <span className="font-mono">{ventas.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total vendido</span>
              <span className="font-mono">{formatCOP(totalVentas)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Comisión estimada</span>
              <span className="font-mono">{formatCOP(comisionEstimada)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Fecha de llegada</Label>
              <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Monto recibido</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <Input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={monto === '' ? '' : formatMiles(Number(monto))}
                  onChange={(e) => setMonto(soloDigitos(e.target.value))}
                  className="pl-7 text-right font-mono"
                />
              </div>
            </div>
          </div>

          {excede ? (
            <p className="text-xs text-destructive">
              Lo recibido no puede superar lo vendido ({formatCOP(totalVentas)}). Revisa si faltan ventas por marcar.
            </p>
          ) : (
            <div className="flex justify-between rounded-md border px-3 py-2 text-sm">
              <span className="text-muted-foreground">Comisión real</span>
              <span className={`font-mono font-semibold ${comisionReal > comisionEstimada ? 'text-destructive' : ''}`}>
                {formatCOP(comisionReal)}
                {totalVentas > 0 && ` (${((comisionReal / totalVentas) * 100).toFixed(1)}%)`}
              </span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Cuenta donde llegó (opcional)</Label>
            <Select value={cuentaId} onValueChange={setCuentaId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={SIN_CUENTA}>Sin especificar</SelectItem>
                {(cuentas ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.alias ?? c.banco} · {c.numero_cuenta}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Referencia (opcional)</Label>
            <Input
              autoComplete="off"
              placeholder="N° de transferencia o de liquidación"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Notas (opcional)</Label>
            <Input autoComplete="off" value={notas} onChange={(e) => setNotas(e.target.value)} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={handleConfirmar} disabled={!puedeConfirmar}>
              {registrar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Registrar desembolso
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Mismo patrón que AnularGastoDialog: exige motivo y no borra el registro. */
function AnularDesembolsoDialog({
  desembolso,
  onClose,
}: {
  desembolso: DesembolsoConDetalle | null
  onClose: () => void
}) {
  const { toast } = useToast()
  const anular = useAnularDesembolso()
  const [motivo, setMotivo] = useState('')

  const handleClose = () => {
    setMotivo('')
    onClose()
  }

  const handleAnular = async () => {
    if (!desembolso || !motivo.trim()) return
    try {
      await anular.mutateAsync({ desembolsoId: desembolso.id, motivo: motivo.trim() })
      toast({ title: 'Desembolso anulado — sus ventas vuelven a pendientes', variant: 'success' })
      handleClose()
    } catch (err) {
      toast({ title: mensajeError(err, 'Error al anular el desembolso'), variant: 'destructive' })
    }
  }

  return (
    <Dialog open={!!desembolso} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Anular desembolso</DialogTitle>
        </DialogHeader>
        {desembolso && (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <div className="flex justify-between">
                <span>{desembolso.financiera?.nombre} · {formatFecha(desembolso.fecha + 'T00:00:00')}</span>
                <span className="font-mono">{formatCOP(desembolso.monto_recibido)}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Sus {desembolso.num_ventas} ventas volverán a quedar por desembolsar.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Motivo de la anulación</Label>
              <textarea
                className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                rows={2}
                placeholder="Ej: se marcaron ventas que no cubría"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>Cancelar</Button>
              <Button variant="destructive" onClick={handleAnular} disabled={!motivo.trim() || anular.isPending}>
                {anular.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Anular desembolso
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
