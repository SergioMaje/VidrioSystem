import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { EmptyState } from '@/components/shared/EmptyState'
import { useCotizaciones } from '@/hooks/useCotizaciones'
import { useSaldos } from '@/hooks/useVentasCaja'
import { estaLiquidada } from '@/lib/pagos'
import { formatCOP, formatFecha } from '@/lib/utils'
import type { Cotizacion } from '@/types/database'

const estadoConfig: Record<Cotizacion['estado'], { label: string; variant: 'default' | 'secondary' | 'destructive' | 'warning' | 'success' | 'outline' }> = {
  borrador: { label: 'Borrador', variant: 'secondary' },
  enviada: { label: 'Enviada', variant: 'default' },
  aprobada: { label: 'Aprobada', variant: 'success' },
  rechazada: { label: 'Rechazada', variant: 'destructive' },
  vencida: { label: 'Vencida', variant: 'warning' },
  vendida: { label: 'Vendida', variant: 'outline' },
}

export function CotizacionesPage() {
  const navigate = useNavigate()
  const [busqueda, setBusqueda] = useState('')
  const [estadoFiltro, setEstadoFiltro] = useState('todos')

  const { data: cotizaciones, isLoading } = useCotizaciones()
  const { data: saldos } = useSaldos()

  const filtradas = cotizaciones?.filter((c) => {
    const cliente = c.cliente as { nombre: string; apellido: string } | undefined
    const q = busqueda.toLowerCase()
    const coincide = c.numero.toLowerCase().includes(q) || (cliente ? `${cliente.nombre} ${cliente.apellido}`.toLowerCase().includes(q) : false)
    const coincideEstado = estadoFiltro === 'todos' || c.estado === estadoFiltro
    return coincide && coincideEstado
  }) ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 gap-2">
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
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {Object.entries(estadoConfig).map(([key, { label }]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => navigate('/cotizaciones/nueva')}>
          <Plus className="mr-2 h-4 w-4" />
          Nueva cotización
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <LoadingSpinner className="py-12" />
          ) : filtradas.length === 0 ? (
            <EmptyState title="No hay cotizaciones" description="Crea tu primera cotización" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3">Número</th>
                    <th className="px-4 py-3">Cliente</th>
                    <th className="px-4 py-3">Fecha emisión</th>
                    <th className="px-4 py-3">Vencimiento</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Saldo</th>
                    <th className="px-4 py-3">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((cot) => {
                    const cliente = cot.cliente as { nombre: string; apellido: string } | undefined
                    const cfg = estadoConfig[cot.estado]
                    const saldo = saldos?.get(cot.id)
                    return (
                      <tr
                        key={cot.id}
                        className="cursor-pointer border-b transition-colors hover:bg-muted/30"
                        onClick={() => navigate(`/cotizaciones/${cot.id}`)}
                      >
                        <td className="px-4 py-3 font-mono text-xs font-medium">{cot.numero}</td>
                        <td className="px-4 py-3">{cliente ? `${cliente.nombre} ${cliente.apellido}` : '—'}</td>
                        <td className="px-4 py-3 text-muted-foreground">{formatFecha(cot.fecha_emision)}</td>
                        <td className="px-4 py-3 text-muted-foreground">{cot.fecha_vencimiento ? formatFecha(cot.fecha_vencimiento) : '—'}</td>
                        <td className="px-4 py-3 text-right font-mono font-medium">{formatCOP(cot.total)}</td>
                        <td className="px-4 py-3 text-right">
                          {cot.estado !== 'vendida' || !saldo ? (
                            <span className="text-muted-foreground">—</span>
                          ) : estaLiquidada(saldo.saldo) ? (
                            <span className="text-xs font-medium text-emerald-600">Pagada</span>
                          ) : (
                            <span className="font-mono text-destructive" title={`${Math.round(saldo.pct_abonado)}% abonado`}>
                              {formatCOP(saldo.saldo)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3"><Badge variant={cfg.variant}>{cfg.label}</Badge></td>
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
