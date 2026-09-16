import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { HandCoins, Loader2, Pencil, Plus } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { useFinancieras, useGuardarFinanciera } from '@/hooks/useFinancieras'
import { useToast } from '@/hooks/useToast'
import { mensajeError } from '@/lib/utils'
import type { Financiera } from '@/types/database'

/**
 * Addi, Sistecrédito y cualquier otra que dé crédito al cliente. Sin eliminar:
 * las ventas viejas apuntan a la financiera, así que se desactiva.
 */
export function FinancierasCard({ esAdmin }: { esAdmin: boolean }) {
  const { data: financieras, isLoading } = useFinancieras()
  const [formOpen, setFormOpen] = useState(false)
  const [editar, setEditar] = useState<Financiera | null>(null)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <HandCoins className="h-4 w-4 text-muted-foreground" />
            Financieras
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Crédito al cliente (Addi, Sistecrédito). La comisión es un estimado: la real sale de cada desembolso.
          </p>
        </div>
        {esAdmin && (
          <Button size="sm" onClick={() => { setEditar(null); setFormOpen(true) }}>
            <Plus className="mr-2 h-4 w-4" />
            Agregar
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <LoadingSpinner className="py-12" />
        ) : !financieras || financieras.length === 0 ? (
          <EmptyState
            icon={HandCoins}
            title="Sin financieras"
            description="Agrega las financieras con las que tienes convenio"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3">Nombre</th>
                  <th className="px-4 py-3 text-right">Comisión estimada</th>
                  <th className="px-4 py-3 text-right">Plazo de desembolso</th>
                  <th className="px-4 py-3">Estado</th>
                  {esAdmin && <th className="px-4 py-3"></th>}
                </tr>
              </thead>
              <tbody>
                {financieras.map((f) => (
                  <tr key={f.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">{f.nombre}</td>
                    <td className="px-4 py-3 text-right font-mono">{f.comision_pct}%</td>
                    <td className="px-4 py-3 text-right font-mono">{f.dias_desembolso} días</td>
                    <td className="px-4 py-3">
                      <Badge variant={f.activa ? 'success' : 'secondary'}>{f.activa ? 'Activa' : 'Inactiva'}</Badge>
                    </td>
                    {esAdmin && (
                      <td className="px-4 py-3">
                        <Button variant="ghost" size="sm" onClick={() => { setEditar(f); setFormOpen(true) }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <FinancieraFormDialog open={formOpen} onOpenChange={setFormOpen} financiera={editar} />
    </Card>
  )
}

const schema = z.object({
  nombre: z.string().trim().min(1, 'El nombre es requerido'),
  comision_pct: z.coerce.number().min(0, 'No puede ser negativa').max(99.99, 'Debe ser menor a 100'),
  dias_desembolso: z.coerce.number().int('Días enteros').min(0, 'No puede ser negativo'),
  activa: z.boolean(),
})

type FormData = z.infer<typeof schema>

function FinancieraFormDialog({
  open,
  onOpenChange,
  financiera,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  financiera: Financiera | null
}) {
  const guardar = useGuardarFinanciera()
  const { toast } = useToast()

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    if (!open) return
    reset(
      financiera
        ? {
            nombre: financiera.nombre,
            comision_pct: financiera.comision_pct,
            dias_desembolso: financiera.dias_desembolso,
            activa: financiera.activa,
          }
        : { nombre: '', comision_pct: 0, dias_desembolso: 30, activa: true }
    )
  }, [open, financiera, reset])

  const onSubmit = async (data: FormData) => {
    try {
      await guardar.mutateAsync({ id: financiera?.id, data })
      toast({ title: financiera ? 'Financiera actualizada' : 'Financiera agregada', variant: 'success' })
      onOpenChange(false)
    } catch (err) {
      toast({ title: mensajeError(err, 'Error al guardar'), variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{financiera ? 'Editar financiera' : 'Nueva financiera'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <Label>Nombre</Label>
              <Input placeholder="Addi, Sistecrédito..." {...register('nombre')} />
              {errors.nombre && <p className="text-xs text-destructive">{errors.nombre.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>Comisión estimada (%)</Label>
              <Input type="number" step="0.01" min={0} {...register('comision_pct')} />
              {errors.comision_pct && <p className="text-xs text-destructive">{errors.comision_pct.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>Plazo de desembolso (días)</Label>
              <Input type="number" min={0} {...register('dias_desembolso')} />
              {errors.dias_desembolso && <p className="text-xs text-destructive">{errors.dias_desembolso.message}</p>}
            </div>
            <div className="col-span-2 flex items-center gap-2">
              <input id="financiera-activa" type="checkbox" className="h-4 w-4" {...register('activa')} />
              <Label htmlFor="financiera-activa" className="font-normal">Disponible para vender</Label>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Cambiar el % no modifica las ventas ya registradas: cada una guarda la comisión estimada del día en que se vendió.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {financiera ? 'Guardar cambios' : 'Agregar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
