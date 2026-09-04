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
import { useRegistrarRecorte } from '@/hooks/useInventario'
import { useToast } from '@/hooks/useToast'
import type { ItemInventario } from '@/types/database'

const schema = z.object({
  ancho_cm: z.coerce.number().positive('El ancho debe ser mayor a cero'),
  alto_cm: z.coerce.number().positive('El alto debe ser mayor a cero'),
  notas: z.string().optional(),
})
type FormData = z.infer<typeof schema>

interface RegistrarRecorteDialogProps {
  item: ItemInventario
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RegistrarRecorteDialog({ item, open, onOpenChange }: RegistrarRecorteDialogProps) {
  const registrarRecorte = useRegistrarRecorte()
  const { toast } = useToast()

  const { register, handleSubmit, watch, reset, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  useEffect(() => {
    if (open) reset({ ancho_cm: undefined, alto_cm: undefined, notas: '' })
  }, [open, reset])

  const ancho = watch('ancho_cm')
  const alto = watch('alto_cm')
  const esArea = item.unidad_medida?.tipo === 'area'
  const esLongitud = item.unidad_medida?.tipo === 'longitud'
  const cantidadEstimada =
    esArea && ancho > 0 && alto > 0
      ? (ancho * alto) / 10000
      : esLongitud && ancho > 0 && alto > 0
      ? Math.max(ancho, alto) / 100
      : null

  const onSubmit = async (data: FormData) => {
    try {
      const nuevo = await registrarRecorte.mutateAsync({
        itemOrigenId: item.id,
        anchoCm: data.ancho_cm,
        altoCm: data.alto_cm,
        notas: data.notas || undefined,
      })
      toast({ title: `Recorte ${nuevo.codigo} registrado`, variant: 'success' })
      onOpenChange(false)
    } catch (err) {
      toast({
        title: 'Error al registrar el recorte',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar recorte de "{item.nombre}"</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Ancho (cm)</Label>
              <Input type="number" step="0.1" {...register('ancho_cm')} />
              {errors.ancho_cm && <p className="text-xs text-destructive">{errors.ancho_cm.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Alto (cm)</Label>
              <Input type="number" step="0.1" {...register('alto_cm')} />
              {errors.alto_cm && <p className="text-xs text-destructive">{errors.alto_cm.message}</p>}
            </div>
          </div>

          {cantidadEstimada !== null && (
            <p className="text-sm text-muted-foreground">
              Se recuperan aproximadamente <span className="font-medium">{cantidadEstimada.toFixed(2)}</span>{' '}
              {item.unidad_medida?.simbolo}
            </p>
          )}

          <div className="space-y-2">
            <Label>Notas (opcional)</Label>
            <Input placeholder="Ubicación, observaciones..." {...register('notas')} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Registrar recorte
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
