import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Package, AlertTriangle, FileText, TrendingUp, Users, Factory, Truck, Wallet } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/hooks/useAuth'
import { expirarCotizacionesVencidas } from '@/hooks/useCotizaciones'
import { useCotizacionesMorosas } from '@/hooks/useVentasCaja'
import { supabase } from '@/lib/supabase'
import { getSaludo, formatFecha, formatCOP, diasHasta } from '@/lib/utils'
import { ESTADOS_ORDEN_CONFIG, ESTADOS_ACTIVOS } from '@/lib/estadosOrden'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import type { OrdenTrabajo } from '@/types/database'

const MESES_ESP = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

type StockBajoItem = { id: string; nombre: string; stock_actual: number; stock_minimo: number }
type PipelineConteo = Record<OrdenTrabajo['estado'], number> & { entregadasMes: number }

export function DashboardPage() {
  const navigate = useNavigate()
  const { usuario } = useAuth()

  const { data: totalItems } = useQuery({
    queryKey: ['dashboard_total_items'],
    queryFn: async () => {
      const { count } = await supabase.from('items_inventario').select('*', { count: 'exact', head: true }).eq('activo', true)
      return count ?? 0
    },
  })

  const { data: itemsStockBajo } = useQuery({
    queryKey: ['dashboard_stock_bajo'],
    queryFn: async () => {
      // PostgREST no soporta comparar dos columnas entre sí en el query string,
      // así que se filtra en el cliente sobre los items activos.
      const { data } = await supabase
        .from('items_inventario')
        .select('id, nombre, stock_actual, stock_minimo')
        .eq('activo', true)
      const bajos = (data ?? [] as StockBajoItem[])
        .filter((item) => item.stock_actual <= item.stock_minimo)
        .sort((a, b) => a.stock_actual - b.stock_actual)
        .slice(0, 5)
      return bajos
    },
  })

  const { data: cotizacionesPendientes } = useQuery({
    queryKey: ['dashboard_cotizaciones'],
    queryFn: async () => {
      await expirarCotizacionesVencidas()
      const { count } = await supabase.from('cotizaciones').select('*', { count: 'exact', head: true }).in('estado', ['borrador', 'enviada'])
      return count ?? 0
    },
  })

  const { data: pipeline } = useQuery({
    queryKey: ['dashboard_pipeline'],
    queryFn: async (): Promise<PipelineConteo> => {
      const inicioMes = new Date()
      inicioMes.setDate(1)
      const inicioMesStr = inicioMes.toISOString().split('T')[0]

      const [pendiente, enProduccion, lista, entregadasMes] = await Promise.all([
        supabase.from('ordenes_trabajo').select('*', { count: 'exact', head: true }).eq('estado', 'pendiente'),
        supabase.from('ordenes_trabajo').select('*', { count: 'exact', head: true }).eq('estado', 'en_produccion'),
        supabase.from('ordenes_trabajo').select('*', { count: 'exact', head: true }).eq('estado', 'lista'),
        supabase.from('ordenes_trabajo').select('*', { count: 'exact', head: true }).eq('estado', 'entregada').gte('fecha_entrega_real', inicioMesStr),
      ])

      return {
        pendiente: pendiente.count ?? 0,
        en_produccion: enProduccion.count ?? 0,
        lista: lista.count ?? 0,
        entregada: 0,
        cancelada: 0,
        entregadasMes: entregadasMes.count ?? 0,
      }
    },
  })

  const { data: entregas } = useQuery({
    queryKey: ['dashboard_entregas'],
    queryFn: async () => {
      const { data } = await supabase
        .from('ordenes_trabajo')
        .select('*, cliente:clientes(nombre, apellido)')
        .in('estado', ESTADOS_ACTIVOS)
        .order('fecha_entrega_estimada', { ascending: true, nullsFirst: false })
        .limit(6)
      return data as OrdenTrabajo[]
    },
  })

  const { data: datosGrafico } = useQuery({
    queryKey: ['dashboard_grafico'],
    queryFn: async () => {
      const hace5Meses = new Date()
      hace5Meses.setMonth(hace5Meses.getMonth() - 5)
      hace5Meses.setDate(1)
      const desde = hace5Meses.toISOString().split('T')[0]

      const [{ data: cots }, { data: ords }] = await Promise.all([
        supabase.from('cotizaciones').select('created_at').gte('created_at', desde),
        supabase.from('ordenes_trabajo').select('created_at').gte('created_at', desde),
      ])

      const meses: { mes: string; key: string; cotizaciones: number; ordenes: number }[] = []
      for (let i = 5; i >= 0; i--) {
        const d = new Date()
        d.setMonth(d.getMonth() - i)
        meses.push({
          mes: MESES_ESP[d.getMonth()],
          key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
          cotizaciones: 0,
          ordenes: 0,
        })
      }

      for (const cot of cots ?? []) {
        const key = (cot.created_at as string).slice(0, 7)
        const mes = meses.find((m) => m.key === key)
        if (mes) mes.cotizaciones++
      }
      for (const ord of ords ?? []) {
        const key = (ord.created_at as string).slice(0, 7)
        const mes = meses.find((m) => m.key === key)
        if (mes) mes.ordenes++
      }

      return meses
    },
  })

  const { data: topClientes } = useQuery({
    queryKey: ['dashboard_top_clientes'],
    queryFn: async () => {
      const { data } = await supabase
        .from('cotizaciones')
        .select('cliente_id, total, cliente:clientes(nombre, apellido)')
        .eq('estado', 'vendida')

      if (!data) return []

      const map = new Map<string, { nombre: string; total: number; cotizaciones: number }>()
      for (const cot of data) {
        const cliente = cot.cliente as unknown as { nombre: string; apellido: string } | null
        if (!cot.cliente_id || !cliente) continue
        const existing = map.get(cot.cliente_id)
        if (existing) {
          existing.total += cot.total ?? 0
          existing.cotizaciones++
        } else {
          map.set(cot.cliente_id, {
            nombre: `${cliente.nombre} ${cliente.apellido}`,
            total: cot.total ?? 0,
            cotizaciones: 1,
          })
        }
      }

      return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 5)
    },
  })

  const { data: morosas } = useCotizacionesMorosas()

  const carteraTotal = useMemo(
    () => (morosas ?? []).reduce((suma, m) => suma + m.saldo, 0),
    [morosas]
  )

  const saludo = usuario ? getSaludo(usuario.nombre) : 'Bienvenido'

  const metricas = [
    { label: 'Total items inventario', value: totalItems ?? 0, icon: Package, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Items con stock bajo', value: itemsStockBajo?.length ?? 0, icon: AlertTriangle, color: 'text-yellow-600', bg: 'bg-yellow-50' },
    { label: 'Cotizaciones pendientes', value: cotizacionesPendientes ?? 0, icon: FileText, color: 'text-purple-600', bg: 'bg-purple-50' },
    { label: 'Cotizaciones por cobrar', value: morosas?.length ?? 0, icon: Wallet, color: 'text-red-600', bg: 'bg-red-50' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{saludo}</h2>
        <p className="text-muted-foreground">Aquí tienes el resumen de hoy</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricas.map(({ label, value, icon: Icon, color, bg }) => (
          <Card key={label}>
            <CardContent className="flex items-center gap-4 p-6">
              <div className={`rounded-full p-3 ${bg}`}>
                <Icon className={`h-5 w-5 ${color}`} />
              </div>
              <div>
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Factory className="h-5 w-5" />
            Pipeline de producción
          </CardTitle>
          <CardDescription>Órdenes en taller por etapa — haz clic para ver el listado</CardDescription>
        </CardHeader>
        <CardContent>
          {!pipeline ? (
            <LoadingSpinner className="py-8" />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3">
                {ESTADOS_ACTIVOS.map((estado) => {
                  const cfg = ESTADOS_ORDEN_CONFIG[estado]
                  return (
                    <button
                      key={estado}
                      type="button"
                      onClick={() => navigate(`/ordenes?estado=${estado}`)}
                      className="flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-colors hover:bg-accent"
                    >
                      <span className="text-2xl font-bold">{pipeline[estado]}</span>
                      <Badge variant={cfg.variant} className="text-xs">{cfg.label}</Badge>
                    </button>
                  )
                })}
              </div>
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Entregadas este mes: <span className="font-semibold text-foreground">{pipeline.entregadasMes}</span>
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Actividad mensual
            </CardTitle>
            <CardDescription>Cotizaciones y órdenes de los últimos 6 meses</CardDescription>
          </CardHeader>
          <CardContent>
            {!datosGrafico ? (
              <LoadingSpinner className="py-8" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={datosGrafico}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="mes" className="text-xs" />
                  <YAxis className="text-xs" allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="cotizaciones" name="Cotizaciones" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="ordenes" name="Órdenes" fill="hsl(var(--primary) / 0.4)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-yellow-600">
              <AlertTriangle className="h-5 w-5" />
              Alertas de stock
            </CardTitle>
            <CardDescription>Items que requieren reabastecimiento</CardDescription>
          </CardHeader>
          <CardContent>
            {!itemsStockBajo ? (
              <LoadingSpinner />
            ) : itemsStockBajo.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Todo el inventario está en orden</p>
            ) : (
              <div className="space-y-3">
                {itemsStockBajo.map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded-md bg-yellow-50 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">{item.nombre}</p>
                      <p className="text-xs text-muted-foreground">
                        Stock: {item.stock_actual} / Mín: {item.stock_minimo}
                      </p>
                    </div>
                    <Badge variant={item.stock_actual === 0 ? 'destructive' : 'warning'}>
                      {item.stock_actual === 0 ? 'Sin stock' : 'Bajo'}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-600">
            <Wallet className="h-5 w-5" />
            Cuentas por cobrar
          </CardTitle>
          <CardDescription>Cotizaciones vendidas con saldo pendiente — haz clic para cobrar</CardDescription>
        </CardHeader>
        <CardContent>
          {!morosas ? (
            <LoadingSpinner />
          ) : morosas.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No hay saldos pendientes</p>
          ) : (
            <>
              <div className="divide-y">
                {morosas.slice(0, 6).map((m) => (
                  <div
                    key={m.cotizacion_id}
                    className="flex cursor-pointer items-center justify-between py-3 transition-colors hover:bg-muted/30"
                    onClick={() => navigate(`/cotizaciones/${m.cotizacion_id}`)}
                  >
                    <div>
                      <p className="text-sm font-medium">{m.numero}</p>
                      <p className="text-xs text-muted-foreground">
                        {m.cliente} · Abonado {formatCOP(m.total_abonado)} de {formatCOP(m.total)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-red-600">{formatCOP(m.saldo)}</p>
                      <Badge variant="destructive">{m.pct_abonado}%</Badge>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between text-xs">
                {morosas.length > 6 ? (
                  <button
                    type="button"
                    onClick={() => navigate('/cotizaciones')}
                    className="text-muted-foreground underline-offset-2 hover:underline"
                  >
                    +{morosas.length - 6} más
                  </button>
                ) : (
                  <span />
                )}
                <span className="text-muted-foreground">
                  Cartera pendiente: <span className="font-semibold text-foreground">{formatCOP(carteraTotal)}</span>
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Top clientes
          </CardTitle>
          <CardDescription>Clientes con mayor valor en cotizaciones vendidas</CardDescription>
        </CardHeader>
        <CardContent>
          {!topClientes ? (
            <LoadingSpinner />
          ) : topClientes.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No hay cotizaciones vendidas aún</p>
          ) : (
            <div className="divide-y">
              {topClientes.map((cliente, i) => (
                <div key={cliente.nombre} className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-sm font-medium">{cliente.nombre}</p>
                      <p className="text-xs text-muted-foreground">{cliente.cotizaciones} cotización{cliente.cotizaciones !== 1 ? 'es' : ''}</p>
                    </div>
                  </div>
                  <p className="text-sm font-semibold">{formatCOP(cliente.total)}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            Entregas próximas y atrasadas
          </CardTitle>
          <CardDescription>Órdenes activas ordenadas por fecha de entrega</CardDescription>
        </CardHeader>
        <CardContent>
          {!entregas ? (
            <LoadingSpinner />
          ) : entregas.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No hay órdenes activas</p>
          ) : (
            <div className="divide-y">
              {entregas.map((orden) => {
                const cliente = orden.cliente as { nombre: string; apellido: string } | undefined
                const cfg = ESTADOS_ORDEN_CONFIG[orden.estado]
                const dias = orden.fecha_entrega_estimada ? diasHasta(orden.fecha_entrega_estimada) : null
                return (
                  <div
                    key={orden.id}
                    className="flex cursor-pointer items-center justify-between py-3 transition-colors hover:bg-muted/30"
                    onClick={() => navigate(`/ordenes/${orden.id}`)}
                  >
                    <div>
                      <p className="text-sm font-medium">{orden.numero}</p>
                      <p className="text-xs text-muted-foreground">
                        {cliente ? `${cliente.nombre} ${cliente.apellido}` : '—'}
                        {orden.fecha_entrega_estimada && ` · Entrega: ${formatFecha(orden.fecha_entrega_estimada)}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={cfg.variant}>{cfg.label}</Badge>
                      {dias === null ? (
                        <span className="text-xs text-muted-foreground">Sin fecha</span>
                      ) : (
                        <Badge variant={dias < 0 ? 'destructive' : dias <= 3 ? 'warning' : 'outline'}>
                          {dias < 0 ? `Vencida ${Math.abs(dias)}d` : dias === 0 ? 'Hoy' : `En ${dias}d`}
                        </Badge>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
