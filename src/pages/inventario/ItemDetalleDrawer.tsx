import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Pencil, Trash2, Loader2, Scissors } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { StockBadge } from '@/components/shared/StockBadge'
import { ClaseBadge } from '@/components/shared/ClaseBadge'
import { RegistrarRecorteDialog } from './RegistrarRecorteDialog'
import { useMovimientos, useEliminarItem, useRegistrarMovimiento } from '@/hooks/useInventario'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { formatCOP, formatFecha } from '@/lib/utils'
import { medidasFisicas, m2DeMedidas } from '@/lib/materiales'
import type { ItemInventario } from '@/types/database'

const movSchema = z.object({
  tipo: z.enum(['entrada', 'salida', 'ajuste']),
  cantidad: z.coerce.number().positive('La cantidad debe ser positiva'),
  motivo: z.string().optional(),
})
type MovForm = z.infer<typeof movSchema>

interface ItemDetalleDrawerProps {
  item: ItemInventario
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit: (item: ItemInventario) => void
}

export function ItemDetalleDrawer({ item, open, onOpenChange, onEdit }: ItemDetalleDrawerProps) {
  const [confirmEliminar, setConfirmEliminar] = useState(false)
  const [recorteOpen, setRecorteOpen] = useState(false)
  const [numLaminas, setNumLaminas] = useState('')
  // Solo hay conversión láminas → m² si el item declara su medida estándar.
  const m2PorLamina =
    item.unidad_medida?.tipo === 'area' && item.ancho_cm != null && item.alto_cm != null
      ? m2DeMedidas(item.ancho_cm, item.alto_cm)
      : null
  const { data: movimientos } = useMovimientos(item.id)
  const eliminarItem = useEliminarItem()
  const registrarMovimiento = useRegistrarMovimiento()
  const { usuario } = useAuth()
  const { toast } = useToast()

  const { register, handleSubmit, setValue, reset, formState: { errors, isSubmitting } } = useForm<MovForm>({
    resolver: zodResolver(movSchema),
    defaultValues: { tipo: 'entrada', cantidad: 1 },
  })

  const onSubmitMovimiento = async (data: MovForm) => {
    if (!usuario) return
    try {
      await registrarMovimiento.mutateAsync({
        item_id: item.id,
        tipo: data.tipo,
        cantidad: data.cantidad,
        motivo: data.motivo,
        usuario_id: usuario.id,
      })
      reset()
      toast({ title: 'Movimiento registrado', variant: 'success' })
    } catch {
      toast({ title: 'Error al registrar movimiento', variant: 'destructive' })
    }
  }

  const handleEliminar = async () => {
    try {
      await eliminarItem.mutateAsync(item.id)
      toast({ title: 'Item eliminado' })
      onOpenChange(false)
    } catch {
      toast({ title: 'Error al eliminar', variant: 'destructive' })
    }
    setConfirmEliminar(false)
  }

  const tipoColors: Record<string, string> = {
    entrada: 'text-green-600',
    salida: 'text-red-600',
    ajuste: 'text-blue-600',
    produccion: 'text-orange-600',
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{item.nombre}</SheetTitle>
          </SheetHeader>

          <div className="mt-4 space-y-5">
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Código</span>
                <span className="font-mono text-sm">{item.codigo}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Categoría</span>
                <span className="text-sm">{item.categoria?.nombre ?? '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Clase</span>
                <ClaseBadge clase={item.clase_inventario} />
              </div>
              {medidasFisicas(item) && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Medidas</span>
                  <span className="text-sm">{medidasFisicas(item)}</span>
                </div>
              )}
              {item.item_origen && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Sale de</span>
                  <span className="text-sm">{item.item_origen.codigo} — {item.item_origen.nombre}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Unidad</span>
                <span className="text-sm">{item.unidad_medida?.simbolo ?? '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Stock actual</span>
                <div className="flex items-center gap-2">
                  <span className="font-bold">{item.stock_actual}</span>
                  <StockBadge
                    stockActual={item.stock_actual}
                    stockMinimo={item.stock_minimo}
                    clase={item.clase_inventario}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Precio costo</span>
                <span className="text-sm">{formatCOP(item.precio_costo)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Precio venta</span>
                <span className="text-sm font-medium">{formatCOP(item.precio_venta)}</span>
              </div>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => onEdit(item)}>
                <Pencil className="mr-2 h-4 w-4" />
                Editar
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setConfirmEliminar(true)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {(item.unidad_medida?.tipo === 'area' || item.unidad_medida?.tipo === 'longitud') &&
              item.clase_inventario !== 'sobre_pedido' && (
                <Button variant="outline" size="sm" className="w-full" onClick={() => setRecorteOpen(true)}>
                  <Scissors className="mr-2 h-4 w-4" />
                  Registrar recorte
                </Button>
            )}

            <Separator />

            <div>
              <h4 className="mb-3 font-medium">Registrar movimiento</h4>
              <form onSubmit={handleSubmit(onSubmitMovimiento)} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Tipo</Label>
                    <Select defaultValue="entrada" onValueChange={(v) => setValue('tipo', v as MovForm['tipo'])}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="entrada">Entrada</SelectItem>
                        <SelectItem value="salida">Salida</SelectItem>
                        <SelectItem value="ajuste">Ajuste</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Cantidad ({item.unidad_medida?.simbolo ?? 'und'})</Label>
                    <Input type="number" step="0.01" className="h-9" {...register('cantidad')} />
                    {errors.cantidad && <p className="text-xs text-destructive">{errors.cantidad.message}</p>}
                  </div>
                </div>
                {/* El stock vive en m², pero la compra llega en láminas. Esto solo
                    rellena el campo de cantidad; lo que se guarda sigue siendo m². */}
                {m2PorLamina && (
                  <div className="flex items-end gap-2 rounded-md border bg-muted/30 p-2">
                    <div className="flex-1 space-y-1">
                      <Label className="text-xs">N.º de láminas de {medidasFisicas(item)}</Label>
                      <Input
                        type="number"
                        step="1"
                        min="1"
                        className="h-8"
                        value={numLaminas}
                        onChange={(e) => setNumLaminas(e.target.value)}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!(parseFloat(numLaminas) > 0)}
                      onClick={() => {
                        const n = parseFloat(numLaminas)
                        if (n > 0) setValue('cantidad', Number((n * m2PorLamina).toFixed(3)))
                      }}
                    >
                      = {((parseFloat(numLaminas) || 0) * m2PorLamina).toFixed(2)} m²
                    </Button>
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs">Motivo (opcional)</Label>
                  <Input placeholder="Ej: Compra proveedor..." className="h-9" {...register('motivo')} />
                </div>
                <Button type="submit" size="sm" disabled={isSubmitting} className="w-full">
                  {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Registrar
                </Button>
              </form>
            </div>

            <Separator />

            <div>
              <h4 className="mb-3 font-medium">Historial de movimientos</h4>
              {!movimientos || movimientos.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-4">Sin movimientos registrados</p>
              ) : (
                <div className="space-y-2">
                  {movimientos.map((mov) => (
                    <div key={mov.id} className="flex items-start justify-between rounded-md border px-3 py-2 text-sm">
                      <div>
                        <span className={`font-medium capitalize ${tipoColors[mov.tipo]}`}>{mov.tipo}</span>
                        {mov.motivo && <p className="text-xs text-muted-foreground">{mov.motivo}</p>}
                        <p className="text-xs text-muted-foreground">{formatFecha(mov.created_at)}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono">{mov.tipo === 'entrada' ? '+' : mov.tipo === 'ajuste' ? '=' : '-'}{mov.cantidad}</p>
                        <p className="text-xs text-muted-foreground">{mov.cantidad_anterior} → {mov.cantidad_posterior}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirmEliminar}
        onOpenChange={setConfirmEliminar}
        title="Eliminar item"
        description={`¿Estás seguro de eliminar "${item.nombre}"? Esta acción no se puede deshacer.`}
        onConfirm={handleEliminar}
        loading={eliminarItem.isPending}
      />

      <RegistrarRecorteDialog item={item} open={recorteOpen} onOpenChange={setRecorteOpen} />
    </>
  )
}
