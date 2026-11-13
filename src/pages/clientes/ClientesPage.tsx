import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Plus, Building2, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { EmptyState } from '@/components/shared/EmptyState'
import { ClienteFormDialog } from './ClienteFormDialog'
import { useClientes } from '@/hooks/useClientes'
import type { Cliente } from '@/types/database'
import { FILA_NAVEGABLE, filaNavegableClase } from '@/lib/navegacionTeclado'

export function ClientesPage() {
  const navigate = useNavigate()
  const [busqueda, setBusqueda] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editCliente, setEditCliente] = useState<Cliente | null>(null)

  const { data: clientes, isLoading } = useClientes()

  const filtrados = clientes?.filter((c) => {
    const q = busqueda.toLowerCase()
    return (
      c.nombre.toLowerCase().includes(q) ||
      c.apellido.toLowerCase().includes(q) ||
      (c.empresa?.toLowerCase().includes(q) ?? false) ||
      (c.documento?.toLowerCase().includes(q) ?? false)
    )
  }) ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            data-busqueda
            placeholder="Buscar cliente..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={() => { setEditCliente(null); setFormOpen(true) }}>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo cliente
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <LoadingSpinner className="py-12" />
          ) : filtrados.length === 0 ? (
            <EmptyState title="No hay clientes" description="Agrega tu primer cliente" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3">Cliente</th>
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3">Documento</th>
                    <th className="px-4 py-3">Teléfono</th>
                    <th className="px-4 py-3">Correo</th>
                    <th className="px-4 py-3">Ciudad</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((cliente) => (
                    <tr
                      key={cliente.id}
                      {...FILA_NAVEGABLE}
                      className={`cursor-pointer border-b transition-colors hover:bg-muted/30 ${filaNavegableClase}`}
                      onClick={() => navigate(`/clientes/${cliente.id}`)}
                      title="Ver historial del cliente"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {cliente.tipo === 'juridico' ? <Building2 className="h-4 w-4 text-muted-foreground" /> : <User className="h-4 w-4 text-muted-foreground" />}
                          <div>
                            <p className="font-medium">{cliente.nombre} {cliente.apellido}</p>
                            {cliente.empresa && <p className="text-xs text-muted-foreground">{cliente.empresa}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className="capitalize">{cliente.tipo}</Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{cliente.documento ?? '—'}</td>
                      <td className="px-4 py-3">{cliente.telefono ?? '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{cliente.email ?? '—'}</td>
                      <td className="px-4 py-3">{cliente.ciudad ?? '—'}</td>
                      <td className="px-4 py-3">
                        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setEditCliente(cliente); setFormOpen(true) }}>
                          Editar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <ClienteFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        cliente={editCliente}
      />
    </div>
  )
}
