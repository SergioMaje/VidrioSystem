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
import { useCategorias, useUnidadesMedida, useProveedores, useCrearItem, useEditarItem } from '@/hooks/useInventario'
import { useToast } from '@/hooks/useToast'
import { m2DeMedidas, precioPorPieza } from '@/lib/materiales'
import { formatCOP } from '@/lib/utils'
import type { ItemInventario } from '@/types/database'

/** Valor centinela: Radix no admite un SelectItem con value vacío. */
const NINGUNO = 'ninguno'

const ROLES: { value: string; label: string }[] = [
  { value: NINGUNO, label: 'No es una opción del configurador' },
  { value: 'vidrio', label: 'Vidrio' },
  { value: 'chapa', label: 'Chapa / cerradura' },
  { value: 'pelicula', label: 'Película de seguridad' },
]

// 'desperdicio' no se ofrece aquí: un recorte solo nace de "Registrar recorte"
// sobre un item existente, nunca se crea a mano desde este formulario.
const CLASES: { value: string; label: string }[] = [
  { value: 'stock_normal', label: 'Stock normal — se mantiene en bodega' },
  { value: 'sobre_pedido', label: 'Sobre pedido — se compra para cada orden' },
]

const schema = z.object({
  codigo: z.string().min(1, 'El código es requerido'),
  nombre: z.string().min(1, 'El nombre es requerido'),
  descripcion: z.string().optional(),
  categoria_id: z.string().min(1, 'Selecciona una categoría'),
  unidad_medida_id: z.string().min(1, 'Selecciona una unidad'),
  proveedor_id: z.string().optional(),
  clase_inventario: z.enum(['stock_normal', 'sobre_pedido']),
  // Medida estándar de la pieza con que se compra (la lámina). Se dejan como
  // texto para poder distinguir "vacío" de 0 sin que zod coaccione a NaN.
  ancho_cm: z.string().optional(),
  alto_cm: z.string().optional(),
  stock_actual: z.coerce.number().min(0),
  stock_minimo: z.coerce.number().min(0),
  precio_costo: z.coerce.number().min(0),
  precio_venta: z.coerce.number().min(0),
  rol_configurador: z.enum([NINGUNO, 'vidrio', 'chapa', 'pelicula']),
  vidrio_tipo: z.enum([NINGUNO, 'crudo', 'templado', 'laminado']),
  vidrio_calibre_mm: z.string().optional(),
  vidrio_acabado: z.string().optional(),
})

type FormData = z.infer<typeof schema>

interface ItemFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  item?: ItemInventario | null
}

export function ItemFormDialog({ open, onOpenChange, item }: ItemFormDialogProps) {
  const { data: categorias } = useCategorias()
  const { data: unidades } = useUnidadesMedida()
  const { data: proveedores } = useProveedores()
  const crearItem = useCrearItem()
  const editarItem = useEditarItem()
  const { toast } = useToast()

  const { register, handleSubmit, setValue, watch, reset, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const rolSeleccionado = watch('rol_configurador')
  const vidrioTipo = watch('vidrio_tipo')
  const claseSeleccionada = watch('clase_inventario')
  const unidadSeleccionada = watch('unidad_medida_id')
  const anchoTexto = watch('ancho_cm')
  const altoTexto = watch('alto_cm')
  const precioCostoActual = watch('precio_costo')
  const precioVentaActual = watch('precio_venta')

  // Las medidas solo tienen sentido en lo que se compra por pieza y se almacena
  // por área: una lámina de vidrio. Un tubo o un kilo no tienen "medida estándar".
  const unidad = unidades?.find((u) => u.id === unidadSeleccionada)
  const esPorArea = unidad?.tipo === 'area'
  const anchoNum = parseFloat((anchoTexto ?? '').replace(',', '.'))
  const altoNum = parseFloat((altoTexto ?? '').replace(',', '.'))
  const m2PorLamina = esPorArea ? m2DeMedidas(anchoNum, altoNum) : null

  useEffect(() => {
    if (open) {
      if (item) {
        reset({
          codigo: item.codigo,
          nombre: item.nombre,
          descripcion: item.descripcion ?? '',
          categoria_id: item.categoria_id,
          unidad_medida_id: item.unidad_medida_id,
          proveedor_id: item.proveedor_id ?? '',
          clase_inventario: item.clase_inventario === 'desperdicio' ? 'stock_normal' : item.clase_inventario,
          ancho_cm: item.ancho_cm != null ? String(item.ancho_cm) : '',
          alto_cm: item.alto_cm != null ? String(item.alto_cm) : '',
          stock_actual: item.stock_actual,
          stock_minimo: item.stock_minimo,
          precio_costo: item.precio_costo,
          precio_venta: item.precio_venta,
          rol_configurador: item.rol_configurador ?? NINGUNO,
          vidrio_tipo: item.vidrio_tipo ?? NINGUNO,
          vidrio_calibre_mm: item.vidrio_calibre_mm != null ? String(item.vidrio_calibre_mm) : '',
          vidrio_acabado: item.vidrio_acabado ?? '',
        })
      } else {
        reset({
          codigo: '', nombre: '', descripcion: '',
          clase_inventario: 'stock_normal',
          ancho_cm: '', alto_cm: '',
          stock_actual: 0, stock_minimo: 0, precio_costo: 0, precio_venta: 0,
          rol_configurador: NINGUNO, vidrio_tipo: NINGUNO, vidrio_calibre_mm: '', vidrio_acabado: '',
        })
      }
    }
  }, [open, item, reset])

  const onSubmit = async (data: FormData) => {
    try {
      const esVidrio = data.rol_configurador === 'vidrio'
      const calibre = parseFloat((data.vidrio_calibre_mm ?? '').replace(',', '.'))
      // Las medidas solo se guardan en lo que se almacena por área; en el resto
      // quedan en null para no dejar un dato que nadie sabría interpretar.
      const porArea = unidades?.find((u) => u.id === data.unidad_medida_id)?.tipo === 'area'
      const ancho = parseFloat((data.ancho_cm ?? '').replace(',', '.'))
      const alto = parseFloat((data.alto_cm ?? '').replace(',', '.'))
      const payload = {
        ...data,
        ancho_cm: porArea && ancho > 0 ? ancho : null,
        alto_cm: porArea && alto > 0 ? alto : null,
        descripcion: data.descripcion || null,
        proveedor_id: (data.proveedor_id && data.proveedor_id !== NINGUNO) ? data.proveedor_id : null,
        rol_configurador: data.rol_configurador === NINGUNO ? null : data.rol_configurador,
        vidrio_tipo: esVidrio && data.vidrio_tipo !== NINGUNO ? data.vidrio_tipo : null,
        vidrio_calibre_mm: esVidrio && Number.isFinite(calibre) ? calibre : null,
        vidrio_acabado: esVidrio && data.vidrio_acabado ? data.vidrio_acabado.trim() : null,
        // La cantidad real de un sobre pedido solo se define al elegirlo en una orden.
        stock_actual: data.clase_inventario === 'sobre_pedido' ? 0 : data.stock_actual,
        activo: true,
      }
      if (item) {
        await editarItem.mutateAsync({ id: item.id, data: payload })
        toast({ title: 'Item actualizado', variant: 'success' })
      } else {
        await crearItem.mutateAsync(payload)
        toast({ title: 'Item creado exitosamente', variant: 'success' })
      }
      onOpenChange(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      const esDuplicado = msg.includes('duplicate') || msg.includes('unique') || msg.includes('23505')
      toast({
        title: esDuplicado ? 'El código ya existe' : 'Error al guardar',
        description: esDuplicado ? 'Usa un código diferente, ese ya está registrado.' : msg || undefined,
        variant: 'destructive',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* El diálogo se acota a la pantalla y solo el cuerpo se desplaza: con vidrio
          aparecen dos bloques extra y el formulario supera el alto del viewport,
          que antes dejaba el botón de guardar fuera de alcance. */}
      <DialogContent className="flex max-h-[90dvh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>{item ? 'Editar item' : 'Nuevo item de inventario'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Código</Label>
                <Input placeholder="VID-001" {...register('codigo')} />
                {errors.codigo && <p className="text-xs text-destructive">{errors.codigo.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Nombre</Label>
                <Input placeholder="Vidrio templado 6mm" {...register('nombre')} />
                {errors.nombre && <p className="text-xs text-destructive">{errors.nombre.message}</p>}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Descripción (opcional)</Label>
              <Input placeholder="Descripción del producto" {...register('descripcion')} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Categoría</Label>
                <Select onValueChange={(v) => setValue('categoria_id', v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona..." />
                  </SelectTrigger>
                  <SelectContent>
                    {categorias?.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>{cat.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.categoria_id && <p className="text-xs text-destructive">{errors.categoria_id.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Unidad de medida</Label>
                <Select onValueChange={(v) => setValue('unidad_medida_id', v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona..." />
                  </SelectTrigger>
                  <SelectContent>
                    {unidades?.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.nombre} ({u.simbolo})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.unidad_medida_id && <p className="text-xs text-destructive">{errors.unidad_medida_id.message}</p>}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Clase de inventario</Label>
              <Select
                value={claseSeleccionada}
                onValueChange={(v) => setValue('clase_inventario', v as FormData['clase_inventario'])}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona..." />
                </SelectTrigger>
                <SelectContent>
                  {CLASES.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.clase_inventario && <p className="text-xs text-destructive">{errors.clase_inventario.message}</p>}
            </div>

            {/* Solo para lo que se almacena por área: la lámina se compra por pieza
                pero el stock y el precio viven en m², así que la medida estándar es
                lo que permite traducir entre las dos vistas. */}
            {esPorArea && (
              <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                <Label>Medida estándar de la lámina (opcional)</Label>
                <p className="text-xs text-muted-foreground">
                  Con la medida, el sistema calcula los m² por lámina, valida que un recorte
                  quepa en ella y te muestra a cuánto equivale el precio por lámina.
                </p>
                <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Ancho (cm)</Label>
                    <Input className="h-8 text-sm" placeholder="240" {...register('ancho_cm')} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Alto (cm)</Label>
                    <Input className="h-8 text-sm" placeholder="180" {...register('alto_cm')} />
                  </div>
                </div>
                {m2PorLamina && (
                  <p className="pt-1 text-sm">
                    <span className="font-medium">{m2PorLamina.toFixed(2)} m²</span>{' '}
                    <span className="text-muted-foreground">por lámina</span>
                  </p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label>Proveedor (opcional)</Label>
              <Select onValueChange={(v) => setValue('proveedor_id', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Sin proveedor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ninguno">Sin proveedor</SelectItem>
                  {proveedores?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Stock inicial</Label>
                <Input
                  type="number"
                  step="0.01"
                  disabled={claseSeleccionada === 'sobre_pedido'}
                  {...register('stock_actual')}
                />
                {claseSeleccionada === 'sobre_pedido' && (
                  <p className="text-xs text-muted-foreground">
                    La cantidad real se define al elegirlo en una orden de producción.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Stock mínimo</Label>
                <Input type="number" step="0.01" {...register('stock_minimo')} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Precio costo (COP{esPorArea ? ' por m²' : ''})</Label>
                <Input type="number" step="1" {...register('precio_costo')} />
                {/* El precio se almacena por unidad de medida — para el vidrio, por m² —
                    porque así lo multiplica el configurador. Este renglón traduce a la
                    vista con que se compra, para poder contrastarlo con la factura. */}
                {m2PorLamina && precioCostoActual > 0 && (
                  <p className="text-xs text-muted-foreground">
                    ≈ {formatCOP(precioPorPieza(precioCostoActual, m2PorLamina) ?? 0)} por lámina
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Precio venta (COP{esPorArea ? ' por m²' : ''})</Label>
                <Input type="number" step="1" {...register('precio_venta')} />
                {m2PorLamina && precioVentaActual > 0 && (
                  <p className="text-xs text-muted-foreground">
                    ≈ {formatCOP(precioPorPieza(precioVentaActual, m2PorLamina) ?? 0)} por lámina
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              <Label>Opción del configurador</Label>
              <p className="text-xs text-muted-foreground">
                Si se deja sin definir, el rol se deduce de la categoría y del nombre del item.
              </p>
              <Select
                value={rolSeleccionado}
                onValueChange={(v) => setValue('rol_configurador', v as FormData['rol_configurador'])}
              >
                <SelectTrigger>
                  <SelectValue placeholder="No es una opción del configurador" />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {rolSeleccionado === 'vidrio' && (
                <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Tipo</Label>
                    <Select
                      value={vidrioTipo}
                      onValueChange={(v) => setValue('vidrio_tipo', v as FormData['vidrio_tipo'])}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Sin especificar" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NINGUNO}>Sin especificar</SelectItem>
                        <SelectItem value="crudo">Crudo</SelectItem>
                        <SelectItem value="templado">Templado</SelectItem>
                        <SelectItem value="laminado">Laminado</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Calibre (mm)</Label>
                    <Input className="h-8 text-sm" placeholder="6" {...register('vidrio_calibre_mm')} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Color / acabado</Label>
                    <Input className="h-8 text-sm" placeholder="claro" {...register('vidrio_acabado')} />
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="border-t px-6 py-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {item ? 'Guardar cambios' : 'Crear item'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
