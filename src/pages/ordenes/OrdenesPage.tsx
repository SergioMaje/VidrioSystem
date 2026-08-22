import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { EmptyState } from '@/components/shared/EmptyState'
import { supabase } from '@/lib/supabase'
import { useSaldos } from '@/hooks/useVentasCaja'
import { estaLiquidada, puedeIniciarProduccion } from '@/lib/pagos'
import { formatCOP, formatFecha } from '@/lib/utils'
import { ESTADOS_ORDEN_CONFIG as estadoConfig } from '@/lib/estadosOrden'
import type { OrdenTrabajo } from '@/types/database'

export function OrdenesPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [busqueda, setBusqueda] = useState('')
  const [estadoFiltro, setEstadoFiltro] = useState(searchParams.get('estado') ?? 'todos')

  const { data: ordenes, isLoading } = useQuery({
    queryKey: ['ordenes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ordenes_trabajo')
        .select('*, cliente:clientes(nombre, apellido)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as OrdenTrabajo[]
    },
  })

  // Los saldos vienen de una vista sin FK, así que se cruzan en memoria — igual
  // que en el listado de cotizaciones.
  const { data: saldos } = useSaldos()

  const filtradas = ordenes?.filter((o) => {
    const cliente = o.cliente as { nombre: string; apellido: string } | undefined
    const q = busqueda.toLowerCase()
    const coincide = o.numero.toLowerCase().includes(q) || (cliente ? `${cliente.nombre} ${cliente.apellido}`.toLowerCase().includes(q) : false)
    const coincideEstado = estadoFiltro === 'todos' || o.estado === estadoFiltro
    return coincide && coincideEstado
  }) ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por número o cliente..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={estadoFiltro} onValueChange={setEstadoFiltro}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los estados</SelectItem>
            {Object.entries(estadoConfig).map(([key, { label }]) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <LoadingSpinner className="py-12" />
          ) : filtradas.length === 0 ? (
            <EmptyState title="No hay órdenes" description="Las órdenes se crean al aprobar cotizaciones" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3">Número</th>
                    <th className="px-4 py-3">Cliente</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3">Fecha inicio</th>
                    <th className="px-4 py-3">Entrega estimada</th>
                    <th className="px-4 py-3 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((orden) => {
                    const cliente = orden.cliente as { nombre: string; apellido: string } | undefined
                    const cfg = estadoConfig[orden.estado]
                    const saldo = orden.cotizacion_id ? saldos?.get(orden.cotizacion_id) : undefined
                    // Sin el anticipo cobrado el taller no debería tomar la orden.
                    const sinAnticipo = !!saldo && !puedeIniciarProduccion(saldo.total_abonado, saldo.total)
                    return (
                      <tr
                        key={orden.id}
                        className="cursor-pointer border-b transition-colors hover:bg-muted/30"
                        onClick={() => navigate(`/ordenes/${orden.id}`)}
                      >
                        <td className="px-4 py-3 font-mono text-xs font-medium">{orden.numero}</td>
                        <td className="px-4 py-3">{cliente ? `${cliente.nombre} ${cliente.apellido}` : '—'}</td>
                        <td className="px-4 py-3"><Badge variant={cfg.variant}>{cfg.label}</Badge></td>
                        <td className="px-4 py-3 text-muted-foreground">{orden.fecha_inicio ? formatFecha(orden.fecha_inicio) : '—'}</td>
                        <td className="px-4 py-3 text-muted-foreground">{orden.fecha_entrega_estimada ? formatFecha(orden.fecha_entrega_estimada) : '—'}</td>
                        <td className="px-4 py-3 text-right">
                          {!saldo ? (
                            <span className="text-muted-foreground">—</span>
                          ) : sinAnticipo ? (
                            <Badge variant="destructive">Sin anticipo</Badge>
                          ) : estaLiquidada(saldo.saldo) ? (
                            <span className="font-mono text-xs text-emerald-600">Pagada</span>
                          ) : (
                            <span className="font-mono text-xs text-amber-700">{formatCOP(saldo.saldo)}</span>
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
    </div>
  )
}
