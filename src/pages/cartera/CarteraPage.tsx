import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Handshake, Search } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { EmptyState } from '@/components/shared/EmptyState'
import { AccionesCuentaCobro } from '@/components/shared/AccionesCuentaCobro'
import type { OrigenNavegacion } from '@/components/shared/EnlaceDocumento'
import { useCartera } from '@/hooks/useCartera'
import { ESTADO_CARTERA_CONFIG, tramoMora } from '@/lib/pagos'
import { ESTADOS_ORDEN_CONFIG } from '@/lib/estadosOrden'
import { cn, formatCOP, formatFecha } from '@/lib/utils'
import { FILA_NAVEGABLE, filaNavegableClase } from '@/lib/navegacionTeclado'
import type { EstadoCartera, FilaCartera } from '@/types/database'

const nombreCliente = (f: FilaCartera) => f.cliente_empresa ?? `${f.cliente_nombre} ${f.cliente_apellido}`

/** Lo que importa para cobrar va primero: lo vencido, luego lo que vence pronto. */
const ORDEN_ESTADO: Record<EstadoCartera, number> = { vencida: 0, pendiente: 1, parcial: 2, sin_emitir: 3, pagada: 4 }

/**
 * Cartera: lo que deben los clientes con crédito (ventas a crédito). Muestra
 * cada venta con su cuenta de cobro, el vencimiento y la mora. Los pagos se
 * registran como abonos desde la cotización.
 */
export function CarteraPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { data: filas, isLoading } = useCartera()
  const [busqueda, setBusqueda] = useState('')
  const [estado, setEstado] = useState<'abiertas' | EstadoCartera | 'todas'>('abiertas')

  const abiertas = useMemo(() => (filas ?? []).filter((f) => f.estado !== 'pagada'), [filas])

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return (filas ?? [])
      .filter((f) =>
        estado === 'todas' ? true : estado === 'abiertas' ? f.estado !== 'pagada' : f.estado === estado
      )
      .filter((f) =>
        !q ||
        nombreCliente(f).toLowerCase().includes(q) ||
        f.cotizacion_numero.toLowerCase().includes(q) ||
        (f.cuenta_cobro_numero ?? '').toLowerCase().includes(q) ||
        (f.orden_compra ?? '').toLowerCase().includes(q)
      )
      .sort((a, b) => ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado] || b.dias_mora - a.dias_mora)
  }, [filas, busqueda, estado])

  // Antigüedad de lo que se debe: solo cuentas emitidas con saldo.
  const resumen = useMemo(() => {
    const tramos = new Map<string, number>()
    let total = 0
    let vencido = 0
    let sinEmitir = 0
    for (const f of abiertas) {
      total += f.saldo
      if (f.estado === 'sin_emitir') {
        sinEmitir += f.saldo
        continue
      }
      if (f.estado === 'vencida') vencido += f.saldo
      const tramo = tramoMora(f.dias_mora)
      tramos.set(tramo, (tramos.get(tramo) ?? 0) + f.saldo)
    }
    return { total, vencido, sinEmitir, tramos }
  }, [abiertas])

  const origen: OrigenNavegacion = { desde: location.pathname, desdeEtiqueta: 'Cartera' }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Resumen titulo="Por cobrar" valor={formatCOP(resumen.total)} detalle={`${abiertas.length} venta${abiertas.length === 1 ? '' : 's'} a crédito`} />
        <Resumen titulo="Vencido" valor={formatCOP(resumen.vencido)} destacado={resumen.vencido > 0} />
        <Resumen
          titulo="Por vencer"
          valor={formatCOP(resumen.total - resumen.vencido - resumen.sinEmitir)}
          detalle="Cuentas de cobro al día"
        />
        <Resumen titulo="En producción" valor={formatCOP(resumen.sinEmitir)} detalle="Aún sin cuenta de cobro" />
      </div>

      {resumen.tramos.size > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {['Al día', '1–30 días', '31–60 días', 'Más de 60 días'].filter((t) => resumen.tramos.has(t)).map((t) => (
            <span key={t} className={cn('rounded-full border px-3 py-1', t !== 'Al día' && 'border-destructive/40 text-destructive')}>
              {t}: <span className="font-mono font-medium">{formatCOP(resumen.tramos.get(t)!)}</span>
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            data-busqueda
            placeholder="Buscar por cliente, número u orden de compra..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={estado} onValueChange={(v) => setEstado(v as typeof estado)}>
          <SelectTrigger className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="abiertas">Por cobrar</SelectItem>
            {Object.entries(ESTADO_CARTERA_CONFIG).map(([key, { label }]) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
            ))}
            <SelectItem value="todas">Todas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <LoadingSpinner className="py-12" />
          ) : visibles.length === 0 ? (
            <EmptyState
              icon={Handshake}
              title={(filas ?? []).length === 0 ? 'No hay ventas a crédito' : 'Nada en este filtro'}
              description="Habilita el crédito en la ficha de un cliente y aprueba sus cotizaciones a crédito"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3">Cliente</th>
                    <th className="px-4 py-3">Cotización</th>
                    <th className="px-4 py-3">Cuenta de cobro</th>
                    <th className="px-4 py-3">Vence</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((f) => {
                    const cfg = ESTADO_CARTERA_CONFIG[f.estado]
                    return (
                      <tr
                        key={f.cotizacion_id}
                        {...FILA_NAVEGABLE}
                        className={`cursor-pointer border-b transition-colors hover:bg-muted/30 ${filaNavegableClase}`}
                        onClick={() => navigate(`/cotizaciones/${f.cotizacion_id}`, { state: origen })}
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium">{nombreCliente(f)}</div>
                          {f.cliente_documento && <div className="text-xs text-muted-foreground">{f.cliente_documento}</div>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-mono text-xs font-medium">{f.cotizacion_numero}</div>
                          <div className="text-xs text-muted-foreground">
                            {f.orden_compra && <>OC {f.orden_compra}</>}
                            {f.orden_compra && f.orden_numero && ' · '}
                            {f.orden_numero && f.orden_estado && <>{f.orden_numero} ({ESTADOS_ORDEN_CONFIG[f.orden_estado].label.toLowerCase()})</>}
                          </div>
                        </td>
                        {/* El menú de impresión no debe abrir la cotización. */}
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          {f.cuenta_cobro_id && f.cuenta_cobro_numero ? (
                            <AccionesCuentaCobro cuentaId={f.cuenta_cobro_id} numero={f.cuenta_cobro_numero} />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {f.fecha_vencimiento ? (
                            <>
                              <div>{formatFecha(f.fecha_vencimiento)}</div>
                              {f.dias_mora > 0 && <div className="text-xs text-destructive">{f.dias_mora} días de mora</div>}
                            </>
                          ) : (
                            <span className="text-muted-foreground">Al entregar</span>
                          )}
                        </td>
                        <td className="px-4 py-3"><Badge variant={cfg.variant}>{cfg.label}</Badge></td>
                        <td className="px-4 py-3 text-right font-mono text-xs">{formatCOP(f.total)}</td>
                        <td className="px-4 py-3 text-right font-mono font-medium">{formatCOP(f.saldo)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Resumen({ titulo, valor, detalle, destacado }: { titulo: string; valor: string; detalle?: string; destacado?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{titulo}</p>
        <p className={cn('mt-1 font-mono text-lg font-bold', destacado && 'text-destructive')}>{valor}</p>
        {detalle && <p className="text-xs text-muted-foreground">{detalle}</p>}
      </CardContent>
    </Card>
  )
}
