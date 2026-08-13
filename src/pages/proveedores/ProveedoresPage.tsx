import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Plus, Truck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { ProveedorFormDialog } from './ProveedorFormDialog'
import { useProveedores, useEliminarProveedor } from '@/hooks/useInventario'
import { useToast } from '@/hooks/useToast'
import type { Proveedor } from '@/types/database'

export function ProveedoresPage() {
  const navigate = useNavigate()
  const [busqueda, setBusqueda] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editProveedor, setEditProveedor] = useState<Proveedor | null>(null)
  const [confirmarEliminar, setConfirmarEliminar] = useState<Proveedor | null>(null)

  const { data: proveedores, isLoading } = useProveedores()
  const eliminarProveedor = useEliminarProveedor()
  const { toast } = useToast()

  const filtrados = proveedores?.filter((p) => {
    const q = busqueda.toLowerCase()
    return (
      p.nombre.toLowerCase().includes(q) ||
      (p.nit?.toLowerCase().includes(q) ?? false) ||
      (p.contacto?.toLowerCase().includes(q) ?? false)
    )
  }) ?? []

  const handleEliminar = async () => {
    if (!confirmarEliminar) return
    try {
      await eliminarProveedor.mutateAsync(confirmarEliminar.id)
      toast({ title: 'Proveedor eliminado' })
    } catch {
      toast({ title: 'Error al eliminar', variant: 'destructive' })
    }
    setConfirmarEliminar(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, NIT o contacto..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={() => { setEditProveedor(null); setFormOpen(true) }}>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo proveedor
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <LoadingSpinner className="py-12" />
          ) : filtrados.length === 0 ? (
            <EmptyState
              icon={Truck}
              title="No hay proveedores"
              description={busqueda ? 'Ningún proveedor coincide con la búsqueda' : 'Agrega tu primer proveedor'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3">Proveedor</th>
                    <th className="px-4 py-3">NIT</th>
                    <th className="px-4 py-3">Contacto</th>
                    <th className="px-4 py-3">Teléfono</th>
                    <th className="px-4 py-3">Correo</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((proveedor) => (
                    <tr
                      key={proveedor.id}
                      className="cursor-pointer border-b transition-colors hover:bg-muted/30"
                      onClick={() => navigate(`/proveedores/${proveedor.id}`)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Truck className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <div>
                            <p className="font-medium">{proveedor.nombre}</p>
                            {proveedor.direccion && (
                              <p className="text-xs text-muted-foreground">{proveedor.direccion}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {proveedor.nit ?? '—'}
                      </td>
                      <td className="px-4 py-3">{proveedor.contacto ?? '—'}</td>
                      <td className="px-4 py-3">{proveedor.telefono ?? '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{proveedor.email ?? '—'}</td>
                      <td className="px-4 py-3">
                        <Badge variant={proveedor.activo ? 'success' : 'secondary'}>
                          {proveedor.activo ? 'Activo' : 'Inactivo'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); setEditProveedor(proveedor); setFormOpen(true) }}
                          >
                            Editar
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={(e) => { e.stopPropagation(); setConfirmarEliminar(proveedor) }}
                          >
                            Eliminar
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

      <ProveedorFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        proveedor={editProveedor}
      />

      <ConfirmDialog
        open={!!confirmarEliminar}
        onOpenChange={(open) => { if (!open) setConfirmarEliminar(null) }}
        title="Eliminar proveedor"
        description={`¿Estás seguro de eliminar "${confirmarEliminar?.nombre}"? Los items asociados perderán el vínculo con este proveedor.`}
        onConfirm={handleEliminar}
        loading={eliminarProveedor.isPending}
      />
    </div>
  )
}
