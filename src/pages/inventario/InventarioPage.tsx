import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, Plus, Filter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { StockBadge } from '@/components/shared/StockBadge'
import { EmptyState } from '@/components/shared/EmptyState'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ItemFormDialog } from './ItemFormDialog'
import { ItemDetalleDrawer } from './ItemDetalleDrawer'
import { useItems, useCategorias } from '@/hooks/useInventario'
import { formatCOP } from '@/lib/utils'
import type { ItemInventario } from '@/types/database'

export function InventarioPage() {
  // El dashboard entra aquí con ?stock=bajo (y a veces ?q=<nombre>) al pulsar
  // sus tarjetas; los filtros arrancan en lo que traiga la URL.
  const [searchParams] = useSearchParams()
  const [busqueda, setBusqueda] = useState(searchParams.get('q') ?? '')
  const [categoriaFiltro, setCategoriaFiltro] = useState('todas')
  const [stockFiltro, setStockFiltro] = useState(searchParams.get('stock') ?? 'todos')
  const [itemSeleccionado, setItemSeleccionado] = useState<ItemInventario | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editItem, setEditItem] = useState<ItemInventario | null>(null)

  const { data: items, isLoading, isError, error } = useItems()
  const { data: categorias } = useCategorias()

  const filtrados = items?.filter((item) => {
    const coincideBusqueda =
      item.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
      item.codigo.toLowerCase().includes(busqueda.toLowerCase())
    const coincideCategoria = categoriaFiltro === 'todas' || item.categoria_id === categoriaFiltro
    // Mismo criterio que la métrica del dashboard: bajo es <= al mínimo.
    const coincideStock =
      stockFiltro === 'todos' ||
      (stockFiltro === 'bajo' && item.stock_actual <= item.stock_minimo) ||
      (stockFiltro === 'sin_stock' && item.stock_actual === 0)
    return coincideBusqueda && coincideCategoria && coincideStock
  }) ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre o código..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={categoriaFiltro} onValueChange={setCategoriaFiltro}>
            <SelectTrigger className="w-40">
              <Filter className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Categoría" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              {categorias?.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>{cat.nombre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={stockFiltro} onValueChange={setStockFiltro}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Stock" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todo el stock</SelectItem>
              <SelectItem value="bajo">Stock bajo</SelectItem>
              <SelectItem value="sin_stock">Sin stock</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => { setEditItem(null); setFormOpen(true) }}>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo item
        </Button>
      </div>

      {isError && (
        <Alert variant="destructive">
          <AlertDescription>
            Error al cargar el inventario: {error instanceof Error ? error.message : 'Error desconocido'}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <LoadingSpinner className="py-12" />
          ) : filtrados.length === 0 ? (
            <EmptyState
              title="No hay items"
              description={busqueda ? 'Ningún item coincide con la búsqueda' : 'Agrega tu primer item al inventario'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3">Código</th>
                    <th className="px-4 py-3">Nombre</th>
                    <th className="px-4 py-3">Categoría</th>
                    <th className="px-4 py-3 text-right">Stock</th>
                    <th className="px-4 py-3 text-right">Mínimo</th>
                    <th className="px-4 py-3">Unidad</th>
                    <th className="px-4 py-3 text-right">Precio costo</th>
                    <th className="px-4 py-3 text-right">Precio venta</th>
                    <th className="px-4 py-3">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((item) => (
                    <tr
                      key={item.id}
                      className="cursor-pointer border-b transition-colors hover:bg-muted/30"
                      onClick={() => setItemSeleccionado(item)}
                    >
                      <td className="px-4 py-3 font-mono text-xs">{item.codigo}</td>
                      <td className="px-4 py-3 font-medium">{item.nombre}</td>
                      <td className="px-4 py-3 text-muted-foreground">{item.categoria?.nombre ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-mono">{item.stock_actual}</td>
                      <td className="px-4 py-3 text-right font-mono text-muted-foreground">{item.stock_minimo}</td>
                      <td className="px-4 py-3">{item.unidad_medida?.simbolo ?? '—'}</td>
                      <td className="px-4 py-3 text-right">{formatCOP(item.precio_costo)}</td>
                      <td className="px-4 py-3 text-right">{formatCOP(item.precio_venta)}</td>
                      <td className="px-4 py-3">
                        <StockBadge stockActual={item.stock_actual} stockMinimo={item.stock_minimo} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ItemFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        item={editItem}
      />

      {itemSeleccionado && (
        <ItemDetalleDrawer
          item={itemSeleccionado}
          open={!!itemSeleccionado}
          onOpenChange={(open) => { if (!open) setItemSeleccionado(null) }}
          onEdit={(item) => { setEditItem(item); setFormOpen(true); setItemSeleccionado(null) }}
        />
      )}
    </div>
  )
}
