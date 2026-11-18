import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { InputDinero } from '@/components/shared/InputDinero'
import { useCrearCliente, useEditarCliente } from '@/hooks/useClientes'
import { useToast } from '@/hooks/useToast'
import { useAuth } from '@/hooks/useAuth'
import { mensajeError } from '@/lib/utils'
import type { Cliente } from '@/types/database'

const schema = z.object({
  nombre: z.string().min(1, 'Requerido'),
  apellido: z.string().min(1, 'Requerido'),
  empresa: z.string().optional(),
  tipo: z.enum(['natural', 'juridico']),
  documento: z.string().optional(),
  telefono: z.string().optional(),
  email: z.string().email('Correo inválido').optional().or(z.literal('')),
  direccion: z.string().optional(),
  ciudad: z.string().optional(),
  dias_credito: z.coerce.number().int('Días enteros').min(0, 'Mínimo 0').max(365, 'Máximo 365'),
  /** Solo dígitos; vacío = sin tope. */
  cupo_credito: z.string(),
})

type FormData = z.infer<typeof schema>

interface ClienteFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  cliente?: Cliente | null
  /** Se llama solo al crear (no al editar), con el cliente ya guardado. */
  onCreado?: (cliente: Cliente) => void
}

export function ClienteFormDialog({ open, onOpenChange, cliente, onCreado }: ClienteFormDialogProps) {
  const crearCliente = useCrearCliente()
  const editarCliente = useEditarCliente()
  const { toast } = useToast()
  const { usuario } = useAuth()
  // Cosmético: el trigger clientes_proteger_credito rechaza el cambio si no es admin.
  const esAdmin = usuario?.rol === 'admin'

  const { register, handleSubmit, setValue, reset, control, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { tipo: 'natural', dias_credito: 30, cupo_credito: '' },
  })

  useEffect(() => {
    if (open) {
      if (cliente) {
        reset({
          nombre: cliente.nombre,
          apellido: cliente.apellido,
          empresa: cliente.empresa ?? '',
          tipo: cliente.tipo,
          documento: cliente.documento ?? '',
          telefono: cliente.telefono ?? '',
          email: cliente.email ?? '',
          direccion: cliente.direccion ?? '',
          ciudad: cliente.ciudad ?? '',
          dias_credito: cliente.dias_credito,
          cupo_credito: cliente.cupo_credito != null ? String(Math.round(cliente.cupo_credito)) : '',
        })
      } else {
        reset({ nombre: '', apellido: '', tipo: 'natural', dias_credito: 30, cupo_credito: '' })
      }
    }
  }, [open, cliente, reset])

  const onSubmit = async (data: FormData) => {
    try {
      const { dias_credito, cupo_credito, ...datos } = data
      // Solo el admin manda el crédito: así editar un cliente nunca lo toca por accidente.
      const credito = esAdmin
        ? { dias_credito, cupo_credito: cupo_credito ? Number(cupo_credito) : null }
        : {}
      const payload = {
        ...datos,
        ...credito,
        empresa: data.empresa || null,
        documento: data.documento || null,
        telefono: data.telefono || null,
        email: data.email || null,
        direccion: data.direccion || null,
        ciudad: data.ciudad || null,
        activo: true,
      }
      if (cliente) {
        await editarCliente.mutateAsync({ id: cliente.id, data: payload })
        toast({ title: 'Cliente actualizado', variant: 'success' })
      } else {
        const creado = await crearCliente.mutateAsync(payload)
        toast({ title: 'Cliente creado', variant: 'success' })
        onOpenChange(false)
        onCreado?.(creado)
        return
      }
      onOpenChange(false)
    } catch (err) {
      toast({ title: mensajeError(err, 'Error al guardar'), variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{cliente ? 'Editar cliente' : 'Nuevo cliente'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Nombre</Label>
              <Input {...register('nombre')} />
              {errors.nombre && <p className="text-xs text-destructive">{errors.nombre.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>Apellido</Label>
              <Input {...register('apellido')} />
              {errors.apellido && <p className="text-xs text-destructive">{errors.apellido.message}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Tipo</Label>
              <Select defaultValue="natural" onValueChange={(v) => setValue('tipo', v as 'natural' | 'juridico')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="natural">Persona natural</SelectItem>
                  <SelectItem value="juridico">Persona jurídica</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Documento</Label>
              <Input {...register('documento')} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Empresa (opcional)</Label>
            <Input {...register('empresa')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Teléfono</Label>
              <Input {...register('telefono')} />
            </div>
            <div className="space-y-1">
              <Label>Correo electrónico</Label>
              <Input type="email" {...register('email')} />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Dirección</Label>
              <Input {...register('direccion')} />
            </div>
            <div className="space-y-1">
              <Label>Ciudad</Label>
              <Input {...register('ciudad')} />
            </div>
          </div>
          {esAdmin && (
            <div className="space-y-3 rounded-md border p-3">
              <p className="text-sm font-medium">Cuenta de cobro (pago en $0)</p>
              <p className="text-xs text-muted-foreground">
                Si apruebas una cotización suya con un pago de $0, su cuenta de cobro vence a estos días
                contados desde la entrega. El cupo limita cuánto puede deber así.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Plazo (días)</Label>
                  <Input type="number" min={0} max={365} {...register('dias_credito')} />
                  {errors.dias_credito && <p className="text-xs text-destructive">{errors.dias_credito.message}</p>}
                </div>
                <div className="space-y-1">
                  <Label>Cupo (opcional)</Label>
                  <Controller
                    control={control}
                    name="cupo_credito"
                    render={({ field }) => (
                      <InputDinero value={field.value} onChange={field.onChange} placeholder="Sin tope" />
                    )}
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {cliente ? 'Guardar cambios' : 'Crear cliente'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
