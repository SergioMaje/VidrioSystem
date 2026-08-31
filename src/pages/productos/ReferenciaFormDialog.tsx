import { useEffect } from 'react'
import { useForm, useFieldArray, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Trash2, Loader2, AlertTriangle } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { useCrearReferencia, useEditarReferencia, useUsosReferencia } from '@/hooks/useReferencias'
import { usePlantillas, useTiposProducto } from '@/hooks/useProductos'
import { useToast } from '@/hooks/useToast'
import type { ReferenciaProducto } from '@/types/database'

const FORMULAS_CORTE = [
  { value: 'ancho',              label: 'Ancho (cm)' },
  { value: 'alto',               label: 'Alto (cm)' },
  { value: 'ancho_menos_margen', label: 'Ancho − descuento (cm)' },
  { value: 'alto_menos_margen',  label: 'Alto − descuento (cm)' },
  { value: 'mitad_ancho',        label: 'Mitad del ancho (cm)' },
  { value: 'mitad_alto',         label: 'Mitad del alto (cm)' },
  { value: 'fijo',               label: 'Valor fijo (cm)' },
]

const corteSchema = z.object({
  nombre_pieza:     z.string().min(1, 'Nombre requerido'),
  formula:          z.enum(['ancho', 'alto', 'ancho_menos_margen', 'alto_menos_margen', 'mitad_ancho', 'mitad_alto', 'fijo']),
  margen_cm:        z.coerce.number().min(0).default(0),
  cantidad_fija_cm: z.coerce.number().min(0).optional(),
  cantidad_piezas:  z.coerce.number().int().min(1).default(1),
  orden:            z.coerce.number().int().min(0),
})

const schema = z.object({
  nombre:           z.string().min(1, 'El nombre es requerido'),
  descripcion:      z.string().optional(),
  tipo_producto_id: z.string().min(1, 'Selecciona un tipo'),
  plantilla_id:     z.string().min(1, 'Selecciona una plantilla'),
  es_corrediza:     z.boolean(),
  cortes:           z.array(corteSchema).min(1, 'Agrega al menos un corte'),
})

type FormData = z.infer<typeof schema>

interface ReferenciaFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  referencia?: ReferenciaProducto | null
}

export function ReferenciaFormDialog({ open, onOpenChange, referencia }: ReferenciaFormDialogProps) {
  const crearReferencia = useCrearReferencia()
  const editarReferencia = useEditarReferencia()
  const { data: tipos } = useTiposProducto()
  const { data: todasPlantillas } = usePlantillas()
  const { data: usos } = useUsosReferencia(open && referencia ? referencia.id : undefined)
  const { toast } = useToast()

  const { register, control, handleSubmit, watch, reset, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      nombre: '',
      descripcion: '',
      tipo_producto_id: '',
      plantilla_id: '',
      es_corrediza: false,
      cortes: [{ nombre_pieza: '', formula: 'ancho', margen_cm: 0, cantidad_fija_cm: undefined, cantidad_piezas: 1, orden: 0 }],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'cortes' })
  const watchedCortes = watch('cortes')
  const tipoSeleccionado = watch('tipo_producto_id')

  const plantillasFiltradas = todasPlantillas?.filter(
    (p) => p.tipo_producto_id === tipoSeleccionado
  ) ?? []

  useEffect(() => {
    if (!open) return
    if (referencia) {
      reset({
        nombre: referencia.nombre,
        descripcion: referencia.descripcion ?? '',
        tipo_producto_id: referencia.tipo_producto_id,
        plantilla_id: referencia.plantilla_id,
        es_corrediza: referencia.es_corrediza,
        cortes: referencia.cortes?.map((c, i) => ({
          nombre_pieza: c.nombre_pieza,
          formula: c.formula,
          margen_cm: c.margen_cm,
          cantidad_fija_cm: c.cantidad_fija_cm ?? undefined,
          cantidad_piezas: c.cantidad_piezas,
          orden: i,
        })) ?? [],
      })
    } else {
      reset({
        nombre: '',
        descripcion: '',
        tipo_producto_id: '',
        plantilla_id: '',
        es_corrediza: false,
        cortes: [{ nombre_pieza: '', formula: 'ancho', margen_cm: 0, cantidad_fija_cm: undefined, cantidad_piezas: 1, orden: 0 }],
      })
    }
  }, [open, referencia, reset])

  const onSubmit = async (data: FormData) => {
    try {
      const payload = {
        ...data,
        descripcion: data.descripcion || undefined,
        cortes: data.cortes.map((c, i) => ({
          ...c,
          orden: i,
          cantidad_fija_cm: c.formula === 'fijo' ? (c.cantidad_fija_cm ?? 0) : undefined,
        })),
      }
      if (referencia) {
        await editarReferencia.mutateAsync({ id: referencia.id, input: payload })
        toast({ title: 'Referencia actualizada', variant: 'success' })
      } else {
        await crearReferencia.mutateAsync(payload)
        toast({ title: 'Referencia creada', variant: 'success' })
      }
      onOpenChange(false)
    } catch (err) {
      console.error('Error al guardar referencia:', err)
      const mensaje = err instanceof Error ? err.message : 'Error desconocido'
      toast({ title: 'Error al guardar la referencia', description: mensaje, variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{referencia ? 'Editar referencia' : 'Nueva referencia de producto'}</DialogTitle>
        </DialogHeader>

        {referencia && !!usos && usos > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Esta referencia ya se usó en <strong>{usos}</strong> {usos === 1 ? 'ítem cotizado' : 'ítems cotizados'}.
              Cambiar sus cortes también cambia el despiece que ven las órdenes de trabajo ya
              emitidas. Si el producto cambió de verdad, desactiva esta referencia y crea una
              versión nueva en vez de editarla.
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <Label>Nombre de la referencia</Label>
              <Input placeholder="Ej: Puerta 80-25, Ventana 100-40..." {...register('nombre')} />
              {errors.nombre && <p className="text-xs text-destructive">{errors.nombre.message}</p>}
            </div>

            <div className="space-y-1">
              <Label>Tipo de producto</Label>
              <Controller
                control={control}
                name="tipo_producto_id"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v)
                      setValue('plantilla_id', '')
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona..." />
                    </SelectTrigger>
                    <SelectContent>
                      {tipos?.map((t) => (
                        <SelectItem key={t.id} value={t.id} className="capitalize">{t.nombre}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.tipo_producto_id && <p className="text-xs text-destructive">{errors.tipo_producto_id.message}</p>}
            </div>

            <div className="space-y-1">
              <Label>Plantilla de materiales</Label>
              <Controller
                control={control}
                name="plantilla_id"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={!tipoSeleccionado}>
                    <SelectTrigger>
                      <SelectValue placeholder={tipoSeleccionado ? 'Selecciona...' : 'Elige un tipo primero'} />
                    </SelectTrigger>
                    <SelectContent>
                      {plantillasFiltradas.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.plantilla_id && <p className="text-xs text-destructive">{errors.plantilla_id.message}</p>}
            </div>

            <div className="col-span-2 space-y-1">
              <Label>Descripción (opcional)</Label>
              <Input placeholder="Descripción breve..." {...register('descripcion')} />
            </div>

            <div className="col-span-2 space-y-1">
              <div className="flex items-center gap-2">
                <input type="checkbox" id="es_corrediza" {...register('es_corrediza')} className="h-4 w-4" />
                <Label htmlFor="es_corrediza" className="cursor-pointer font-normal">
                  Es producto corredizo
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">
                El producto completo desliza (ventana, puerta o división corrediza). No afecta las medidas de corte.
              </p>
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Medidas de corte</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({
                  nombre_pieza: '',
                  formula: 'ancho',
                  margen_cm: 0,
                  cantidad_fija_cm: undefined,
                  cantidad_piezas: 1,
                  orden: fields.length,
                })}
              >
                <Plus className="mr-1 h-3 w-3" />
                Agregar pieza
              </Button>
            </div>

            {errors.cortes?.root && (
              <p className="text-xs text-destructive">{errors.cortes.root.message}</p>
            )}

            <div className="space-y-3">
              {fields.map((field, index) => {
                const formula = watchedCortes[index]?.formula
                const conDescuento = formula === 'ancho_menos_margen' || formula === 'alto_menos_margen'
                const esFijo = formula === 'fijo'

                return (
                  <div key={field.id} className="rounded-lg border p-3 space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="col-span-2 space-y-1">
                        <Label className="text-xs">Nombre de la pieza</Label>
                        <Input
                          placeholder="Ej: Jamba, Cabezal, Perfil inferior..."
                          className="h-8 text-sm"
                          {...register(`cortes.${index}.nombre_pieza`)}
                        />
                        {errors.cortes?.[index]?.nombre_pieza && (
                          <p className="text-xs text-destructive">{errors.cortes[index]?.nombre_pieza?.message}</p>
                        )}
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Fórmula de corte</Label>
                        <Controller
                          control={control}
                          name={`cortes.${index}.formula`}
                          render={({ field: f }) => (
                            <Select value={f.value} onValueChange={f.onChange}>
                              <SelectTrigger className="h-8 text-sm">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {FORMULAS_CORTE.map(({ value, label }) => (
                                  <SelectItem key={value} value={value}>{label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs">Cantidad de piezas</Label>
                        <Input
                          type="number"
                          min="1"
                          step="1"
                          className="h-8 text-sm"
                          {...register(`cortes.${index}.cantidad_piezas`)}
                        />
                      </div>

                      {conDescuento && (
                        <div className="col-span-2 space-y-1">
                          <Label className="text-xs">Descuento (cm)</Label>
                          <Input
                            type="number"
                            step="0.1"
                            min="0"
                            placeholder="Ej: 1.3"
                            className="h-8 text-sm"
                            {...register(`cortes.${index}.margen_cm`)}
                          />
                          <p className="text-xs text-muted-foreground">
                            Valor que se resta a la dimensión. Ej: si el alto es 215 cm y el descuento es 1.3, el corte será 213.7 cm.
                          </p>
                        </div>
                      )}

                      {esFijo && (
                        <div className="col-span-2 space-y-1">
                          <Label className="text-xs">Medida fija (cm)</Label>
                          <Input
                            type="number"
                            step="0.1"
                            min="0"
                            placeholder="Ej: 45.5"
                            className="h-8 text-sm"
                            {...register(`cortes.${index}.cantidad_fija_cm`)}
                          />
                        </div>
                      )}
                    </div>

                    {fields.length > 1 && (
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 text-destructive hover:text-destructive"
                          onClick={() => remove(index)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {referencia ? 'Guardar cambios' : 'Crear referencia'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
