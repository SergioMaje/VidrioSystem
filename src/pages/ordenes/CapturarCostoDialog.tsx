import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useProveedores } from '@/hooks/useInventario'
import { useCapturarCostoMaterial } from '@/hooks/useOrdenMateriales'
import { useToast } from '@/hooks/useToast'
import type { OrdenMaterial } from '@/types/database'

const NINGUNO = 'ninguno'

const schema = z.object({
  costo_unitario: z.coerce.number().positive('El costo debe ser mayor a cero'),
  proveedor_id: z.string().optional(),
})
type FormData = z.infer<typeof schema>

interface CapturarCostoDialogProps {
  material: OrdenMaterial
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CapturarCostoDialog({ material, open, onOpenChange }: CapturarCostoDialogProps) {
  const { data: proveedores } = useProveedores()
  const capturarCosto = useCapturarCostoMaterial()
  const { toast } = useToast()

  const { register, handleSubmit, setValue, watch, reset, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    if (open) reset({ costo_unitario: undefined, proveedor_id: material.proveedor_id ?? NINGUNO })
  }, [open, material.proveedor_id, reset])

  const proveedorId = watch('proveedor_id')

  const onSubmit = async (data: FormData) => {
    try {
      await capturarCosto.mutateAsync({
        materialId: material.id,
        ordenId: material.orden_id,
        costoUnitario: data.costo_unitario,
        proveedorId: data.proveedor_id && data.proveedor_id !== NINGUNO ? data.proveedor_id : undefined,
      })
      toast({ title: 'Costo registrado', variant: 'success' })
      onOpenChange(false)
    } catch (err) {
      toast({
        title: 'Error al registrar el costo',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar costo de "{material.item?.nombre ?? '—'}"</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label>Costo unitario (COP)</Label>
            <Input type="number" step="1" {...register('costo_unitario')} />
            {errors.costo_unitario && <p className="text-xs text-destructive">{errors.costo_unitario.message}</p>}
          </div>

          <div className="space-y-2">
            <Label>Proveedor (opcional)</Label>
            <Select value={proveedorId} onValueChange={(v) => setValue('proveedor_id', v)}>
              <SelectTrigger>
                <SelectValue placeholder="Sin proveedor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NINGUNO}>Sin proveedor</SelectItem>
                {proveedores?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-xs text-muted-foreground">
            Este costo actualiza el precio de costo del catálogo al cerrar la producción.
          </p>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar costo
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
