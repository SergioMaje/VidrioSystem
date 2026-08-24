import { useState } from 'react'
import { Landmark, Plus, Pencil, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/shared/EmptyState'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { CuentaEmpresaFormDialog } from './CuentaEmpresaFormDialog'
import { useCuentasPagoEmpresa, useEliminarCuentaPagoEmpresa } from '@/hooks/useCuentasPagoEmpresa'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import type { CuentaPagoEmpresa } from '@/types/database'

export function ConfiguracionPage() {
  const { usuario } = useAuth()
  const esAdmin = usuario?.rol === 'admin'
  const { data: cuentas, isLoading } = useCuentasPagoEmpresa()
  const eliminarCuenta = useEliminarCuentaPagoEmpresa()
  const { toast } = useToast()

  const [formOpen, setFormOpen] = useState(false)
  const [editCuenta, setEditCuenta] = useState<CuentaPagoEmpresa | null>(null)
  const [confirmarEliminar, setConfirmarEliminar] = useState<CuentaPagoEmpresa | null>(null)

  const handleEliminar = async () => {
    if (!confirmarEliminar) return
    try {
      await eliminarCuenta.mutateAsync(confirmarEliminar.id)
      toast({ title: 'Cuenta eliminada', variant: 'success' })
      setConfirmarEliminar(null)
    } catch {
      toast({ title: 'Error al eliminar', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Configuración</h2>
        <p className="text-sm text-muted-foreground">Datos de la vidriería que aparecen en los documentos</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Landmark className="h-4 w-4 text-muted-foreground" />
              Cuentas de pago
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Las cuentas activas se imprimen en la cotización para que el cliente sepa a dónde transferir.
            </p>
          </div>
          {esAdmin && (
            <Button size="sm" onClick={() => { setEditCuenta(null); setFormOpen(true) }}>
              <Plus className="mr-2 h-4 w-4" />
              Agregar cuenta
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <LoadingSpinner className="py-12" />
          ) : !cuentas || cuentas.length === 0 ? (
            <EmptyState
              icon={Landmark}
              title="Sin cuentas de pago"
              description="Agrega las cuentas a las que el cliente puede transferir"
            />
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
                    <th className="px-4 py-3">Estado</th>
                    {esAdmin && <th className="px-4 py-3"></th>}
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
                        <Badge variant={cuenta.activo ? 'success' : 'secondary'}>
                          {cuenta.activo ? 'Visible' : 'Oculta'}
                        </Badge>
                      </td>
                      {esAdmin && (
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" onClick={() => { setEditCuenta(cuenta); setFormOpen(true) }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setConfirmarEliminar(cuenta)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <CuentaEmpresaFormDialog open={formOpen} onOpenChange={setFormOpen} cuenta={editCuenta} />

      <ConfirmDialog
        open={!!confirmarEliminar}
        onOpenChange={(open) => { if (!open) setConfirmarEliminar(null) }}
        title="Eliminar cuenta de pago"
        description={`¿Estás seguro de eliminar la cuenta "${confirmarEliminar?.alias ?? confirmarEliminar?.banco}"? Si solo quieres dejar de mostrarla en las cotizaciones, edítala y desmarca "Mostrar en las cotizaciones".`}
        onConfirm={handleEliminar}
        loading={eliminarCuenta.isPending}
      />
    </div>
  )
}
