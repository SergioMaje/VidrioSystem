import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Lock, Plus, Search, ShoppingCart, Trash2, TriangleAlert } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { useToast } from '@/hooks/useToast'
import { useCajaActual } from '@/hooks/useCajaSesiones'
import { useItems } from '@/hooks/useInventario'
import { useClientes } from '@/hooks/useClientes'
import { useRegistrarVentaMostrador } from '@/hooks/useVentaMostrador'
import { formatCOP, mensajeError } from '@/lib/utils'
import type { ItemInventario, MetodoPago } from '@/types/database'

const METODO_LABEL: Record<MetodoPago, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
}

/** Sin cliente = venta a público general, así que el select necesita un valor vacío propio. */
const SIN_CLIENTE = 'sin-cliente'

type Linea = {
  item: ItemInventario
  cantidad: number
  precioUnitario: number
}

function CajaCerradaCard() {
  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lock className="h-4 w-4" />
          Caja cerrada
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Toda venta queda ligada a un turno de caja. Abre la caja para poder cobrar.
        </p>
        <Button asChild className="w-full">
          <Link to="/caja">Ir a Caja</Link>
        </Button>
      </CardContent>
    </Card>
  )
}

export function VentaDirectaPage() {
  const { toast } = useToast()
  const { data: sesion, isLoading: cargandoSesion } = useCajaActual()
  const { data: items, isLoading: cargandoItems } = useItems()
  const { data: clientes } = useClientes()
  const registrarVenta = useRegistrarVentaMostrador()

  const [busqueda, setBusqueda] = useState('')
  const [lineas, setLineas] = useState<Linea[]>([])
  const [clienteId, setClienteId] = useState<string>(SIN_CLIENTE)
  const [metodoPago, setMetodoPago] = useState<MetodoPago>('efectivo')

  if (cargandoSesion) return <LoadingSpinner className="py-20" />
  if (!sesion) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold">Venta directa</h2>
        <CajaCerradaCard />
      </div>
    )
  }

  const enCarrito = new Set(lineas.map((l) => l.item.id))
  const resultados = busqueda.trim()
    ? (items ?? [])
        .filter(
          (item) =>
            !enCarrito.has(item.id) &&
            (item.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
              item.codigo.toLowerCase().includes(busqueda.toLowerCase()))
        )
        .slice(0, 8)
    : []

  const agregar = (item: ItemInventario) => {
    setLineas((prev) => [...prev, { item, cantidad: 1, precioUnitario: item.precio_venta }])
    setBusqueda('')
  }

  const actualizar = (itemId: string, cambios: Partial<Omit<Linea, 'item'>>) =>
    setLineas((prev) => prev.map((l) => (l.item.id === itemId ? { ...l, ...cambios } : l)))

  const quitar = (itemId: string) => setLineas((prev) => prev.filter((l) => l.item.id !== itemId))

  const total = lineas.reduce((acc, l) => acc + l.cantidad * l.precioUnitario, 0)
  const sinStock = lineas.filter((l) => l.cantidad > l.item.stock_actual)
  const sinPrecio = lineas.filter((l) => l.precioUnitario <= 0)
  const puedeCobrar = lineas.length > 0 && sinStock.length === 0 && sinPrecio.length === 0

  const cobrar = async () => {
    if (!puedeCobrar) return
    try {
      const venta = await registrarVenta.mutateAsync({
        clienteId: clienteId === SIN_CLIENTE ? null : clienteId,
        metodoPago,
        items: lineas.map((l) => ({
          item_id: l.item.id,
          cantidad: l.cantidad,
          precio_unitario: l.precioUnitario,
        })),
      })
      toast({ title: `Venta ${venta.numero} registrada`, description: formatCOP(venta.total), variant: 'success' })
      setLineas([])
      setClienteId(SIN_CLIENTE)
      setMetodoPago('efectivo')
    } catch (err) {
      toast({ title: mensajeError(err, 'No se pudo registrar la venta'), variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">Venta directa</h2>
        <p className="text-sm text-muted-foreground">
          Productos que salen del inventario tal cual. Se cobra completo y el stock se descuenta al instante.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          {/* ── Buscador ──────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Agregar productos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nombre o código..."
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  className="pl-9"
                />
              </div>

              {cargandoItems ? (
                <LoadingSpinner className="py-6" />
              ) : busqueda.trim() && resultados.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No hay productos que coincidan
                </p>
              ) : (
                resultados.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => agregar(item)}
                    disabled={item.stock_actual <= 0}
                    className="flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{item.nombre}</p>
                      <p className="font-mono text-xs text-muted-foreground">{item.codigo}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-mono">{formatCOP(item.precio_venta)}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.stock_actual <= 0 ? 'Sin stock' : `Stock: ${item.stock_actual}`}
                      </p>
                    </div>
                    <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          {/* ── Carrito ───────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Productos de la venta</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {lineas.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                  <ShoppingCart className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">Busca un producto para empezar</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase text-muted-foreground">
                        <th className="px-4 py-3">Producto</th>
                        <th className="px-4 py-3 text-right">Cantidad</th>
                        <th className="px-4 py-3 text-right">Precio unit.</th>
                        <th className="px-4 py-3 text-right">Subtotal</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {lineas.map((linea) => {
                        const excede = linea.cantidad > linea.item.stock_actual
                        const faltaPrecio = linea.precioUnitario <= 0
                        return (
                          <tr key={linea.item.id} className="border-b last:border-0">
                            <td className="px-4 py-3">
                              <p className="font-medium">{linea.item.nombre}</p>
                              <p className="font-mono text-xs text-muted-foreground">
                                {linea.item.codigo} · Stock: {linea.item.stock_actual}
                              </p>
                              {excede && (
                                <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
                                  <TriangleAlert className="h-3 w-3" />
                                  Solo hay {linea.item.stock_actual} disponibles
                                </p>
                              )}
                              {faltaPrecio && (
                                <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
                                  <TriangleAlert className="h-3 w-3" />
                                  Este producto no tiene precio de venta: escríbelo
                                </p>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <Input
                                type="number"
                                min="0"
                                step="0.001"
                                value={linea.cantidad}
                                onChange={(e) =>
                                  actualizar(linea.item.id, { cantidad: Number(e.target.value) })
                                }
                                className={`ml-auto w-24 text-right ${excede ? 'border-destructive' : ''}`}
                              />
                            </td>
                            <td className="px-4 py-3 text-right">
                              <Input
                                type="number"
                                min="0"
                                step="1"
                                value={linea.precioUnitario}
                                onChange={(e) =>
                                  actualizar(linea.item.id, { precioUnitario: Number(e.target.value) })
                                }
                                className={`ml-auto w-32 text-right ${faltaPrecio ? 'border-destructive' : ''}`}
                              />
                            </td>
                            <td className="px-4 py-3 text-right font-semibold">
                              {formatCOP(linea.cantidad * linea.precioUnitario)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => quitar(linea.item.id)}
                                aria-label={`Quitar ${linea.item.nombre}`}
                              >
                                <Trash2 className="h-4 w-4 text-muted-foreground" />
                              </Button>
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

        {/* ── Cobro ───────────────────────────────────────────────── */}
        <Card className="h-fit lg:sticky lg:top-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Cobro</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Cliente (opcional)</Label>
              <Select value={clienteId} onValueChange={setClienteId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_CLIENTE}>Público general</SelectItem>
                  {(clientes ?? []).map((cliente) => (
                    <SelectItem key={cliente.id} value={cliente.id}>
                      {cliente.nombre} {cliente.apellido}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Método de pago</Label>
              <Select value={metodoPago} onValueChange={(v) => setMetodoPago(v as MetodoPago)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(METODO_LABEL) as MetodoPago[]).map((metodo) => (
                    <SelectItem key={metodo} value={metodo}>
                      {METODO_LABEL[metodo]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted-foreground">
                Total ({lineas.length} {lineas.length === 1 ? 'producto' : 'productos'})
              </span>
              <span className="text-2xl font-bold">{formatCOP(total)}</span>
            </div>

            <Button className="w-full" onClick={cobrar} disabled={!puedeCobrar || registrarVenta.isPending}>
              {registrarVenta.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Cobrar
            </Button>

            <p className="text-xs text-muted-foreground">
              El pago entra completo en el turno de caja abierto y el stock se descuenta al confirmar.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
