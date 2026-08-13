import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCrearCuentaPago, useEditarCuentaPago } from '@/hooks/useInventario'
import { useToast } from '@/hooks/useToast'
import type { ProveedorCuentaPago } from '@/types/database'

const schema = z.object({
  alias: z.string().optional(),
  banco: z.string().min(1, 'El banco es requerido'),
  tipo_cuenta: z.string().min(1, 'El tipo de cuenta es requerido'),
  numero_cuenta: z.string().min(1, 'El número de cuenta es requerido'),
  titular: z.string().min(1, 'El titular es requerido'),
})

type FormData = z.infer<typeof schema>

interface CuentaPagoFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  proveedorId: string
  cuenta?: ProveedorCuentaPago | null
}

export function CuentaPagoFormDialog({ open, onOpenChange, proveedorId, cuenta }: CuentaPagoFormDialogProps) {
  const crearCuenta = useCrearCuentaPago()
  const editarCuenta = useEditarCuentaPago()
  const { toast } = useToast()

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    if (open) {
      if (cuenta) {
        reset({
          alias: cuenta.alias ?? '',
          banco: cuenta.banco,
          tipo_cuenta: cuenta.tipo_cuenta,
          numero_cuenta: cuenta.numero_cuenta,
          titular: cuenta.titular,
        })
      } else {
        reset({ alias: '', banco: '', tipo_cuenta: '', numero_cuenta: '', titular: '' })
      }
    }
  }, [open, cuenta, reset])

  const onSubmit = async (data: FormData) => {
    try {
      const payload = {
        proveedor_id: proveedorId,
        alias: data.alias || null,
        banco: data.banco,
        tipo_cuenta: data.tipo_cuenta,
        numero_cuenta: data.numero_cuenta,
        titular: data.titular,
      }
      if (cuenta) {
        await editarCuenta.mutateAsync({ id: cuenta.id, data: payload })
        toast({ title: 'Cuenta actualizada', variant: 'success' })
      } else {
        await crearCuenta.mutateAsync(payload)
        toast({ title: 'Cuenta agregada', variant: 'success' })
      }
      onOpenChange(false)
    } catch {
      toast({ title: 'Error al guardar', variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{cuenta ? 'Editar cuenta de pago' : 'Nueva cuenta de pago'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <Label>Nombre / alias (opcional)</Label>
              <Input placeholder="Cuenta principal, Nequi..." {...register('alias')} />
            </div>
            <div className="space-y-1">
              <Label>Banco</Label>
              <Input placeholder="Bancolombia" {...register('banco')} />
              {errors.banco && <p className="text-xs text-destructive">{errors.banco.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>Tipo de cuenta</Label>
              <Input placeholder="Ahorros, Corriente..." {...register('tipo_cuenta')} />
              {errors.tipo_cuenta && <p className="text-xs text-destructive">{errors.tipo_cuenta.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>Número de cuenta</Label>
              <Input placeholder="1234567890" {...register('numero_cuenta')} />
              {errors.numero_cuenta && <p className="text-xs text-destructive">{errors.numero_cuenta.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>Titular</Label>
              <Input placeholder="Nombre del titular" {...register('titular')} />
              {errors.titular && <p className="text-xs text-destructive">{errors.titular.message}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {cuenta ? 'Guardar cambios' : 'Agregar cuenta'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
