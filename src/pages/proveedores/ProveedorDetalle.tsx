import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Truck, Package, Plus, Pencil, Trash2, Landmark } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { ProveedorFormDialog } from './ProveedorFormDialog'
import { CuentaPagoFormDialog } from './CuentaPagoFormDialog'
import { ImportarProductosExcel } from './ImportarProductosExcel'
import { useProveedor, useItemsPorProveedor, useCuentasPago, useEliminarCuentaPago } from '@/hooks/useInventario'
import { useToast } from '@/hooks/useToast'
import { formatCOP } from '@/lib/utils'
import type { ProveedorCuentaPago } from '@/types/database'

export function ProveedorDetalle() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()

  const { data: proveedor, isLoading: isLoadingProveedor } = useProveedor(id!)
  const { data: items, isLoading: isLoadingItems } = useItemsPorProveedor(id!)
  const { data: cuentas, isLoading: isLoadingCuentas } = useCuentasPago(id!)
  const eliminarCuenta = useEliminarCuentaPago()

  const [editarProveedorOpen, setEditarProveedorOpen] = useState(false)
  const [cuentaFormOpen, setCuentaFormOpen] = useState(false)
  const [editCuenta, setEditCuenta] = useState<ProveedorCuentaPago | null>(null)
  const [confirmarEliminarCuenta, setConfirmarEliminarCuenta] = useState<ProveedorCuentaPago | null>(null)

  if (isLoadingProveedor) return <LoadingSpinner className="py-12" />

  if (!proveedor) {
    return <EmptyState icon={Truck} title="Proveedor no encontrado" description="Vuelve a la lista de proveedores" />
  }

  const handleEliminarCuenta = async () => {
    if (!confirmarEliminarCuenta) return
    try {
      await eliminarCuenta.mutateAsync({ id: confirmarEliminarCuenta.id, proveedorId: proveedor.id })
      toast({ title: 'Cuenta eliminada' })
    } catch {
      toast({ title: 'Error al eliminar', variant: 'destructive' })
    }
    setConfirmarEliminarCuenta(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => navigate('/proveedores')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Volver
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-muted-foreground" />
            {proveedor.nombre}
            <Badge variant={proveedor.activo ? 'success' : 'secondary'}>
              {proveedor.activo ? 'Activo' : 'Inactivo'}
            </Badge>
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => setEditarProveedorOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Editar ficha
          </Button>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Contacto</p>
            <p>{proveedor.contacto ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Teléfono</p>
            <p>{proveedor.telefono ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Correo</p>
            <p>{proveedor.email ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">NIT</p>
            <p>{proveedor.nit ?? '—'}</p>
          </div>
          <div className="sm:col-span-2 lg:col-span-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Dirección</p>
            <p>{proveedor.direccion ?? '—'}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="h-4 w-4 text-muted-foreground" />
            Cuentas de pago
          </CardTitle>
          <Button size="sm" onClick={() => { setEditCuenta(null); setCuentaFormOpen(true) }}>
            <Plus className="mr-2 h-4 w-4" />
            Agregar cuenta
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {isLoadingCuentas ? (
            <LoadingSpinner className="py-12" />
          ) : !cuentas || cuentas.length === 0 ? (
            <EmptyState icon={Landmark} title="Sin cuentas de pago" description="Agrega las cuentas a las que se le paga a este proveedor" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3">Alias</th>
                    <th className="px-4 py-3">Banco</th>
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3">Número</th>
                    <th className="px-4 py-3">Titular</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {cuentas.map((cuenta) => (
                    <tr key={cuenta.id} className="border-b last:border-0">
                      <td className="px-4 py-3">{cuenta.alias ?? '—'}</td>
                      <td className="px-4 py-3">{cuenta.banco}</td>
                      <td className="px-4 py-3">{cuenta.tipo_cuenta}</td>
                      <td className="px-4 py-3 font-mono text-xs">{cuenta.numero_cuenta}</td>
                      <td className="px-4 py-3">{cuenta.titular}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="sm" onClick={() => { setEditCuenta(cuenta); setCuentaFormOpen(true) }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setConfirmarEliminarCuenta(cuenta)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Productos</CardTitle>
          <ImportarProductosExcel proveedor={proveedor} itemsExistentes={items ?? []} />
        </CardHeader>
        <CardContent className="p-0">
          {isLoadingItems ? (
            <LoadingSpinner className="py-12" />
          ) : !items || items.length === 0 ? (
            <EmptyState icon={Package} title="Sin productos" description="Este proveedor no tiene productos asociados" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3">Producto</th>
                    <th className="px-4 py-3 text-right">Precio de costo</th>
                    <th className="px-4 py-3 text-right">Precio de venta</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-b last:border-0">
                      <td className="px-4 py-3 font-medium">{item.nombre}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatCOP(item.precio_costo)}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatCOP(item.precio_venta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ProveedorFormDialog open={editarProveedorOpen} onOpenChange={setEditarProveedorOpen} proveedor={proveedor} />

      <CuentaPagoFormDialog
        open={cuentaFormOpen}
        onOpenChange={setCuentaFormOpen}
        proveedorId={proveedor.id}
        cuenta={editCuenta}
      />

      <ConfirmDialog
        open={!!confirmarEliminarCuenta}
        onOpenChange={(open) => { if (!open) setConfirmarEliminarCuenta(null) }}
        title="Eliminar cuenta de pago"
        description={`¿Estás seguro de eliminar la cuenta "${confirmarEliminarCuenta?.alias ?? confirmarEliminarCuenta?.banco}"?`}
        onConfirm={handleEliminarCuenta}
        loading={eliminarCuenta.isPending}
      />
    </div>
  )
}
