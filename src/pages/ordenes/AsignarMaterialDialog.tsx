import { useEffect, useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Loader2 } from 'lucide-react'
import { useSugerenciasMaterial, useAsignarMaterial } from '@/hooks/useOrdenMateriales'
import { useProveedores } from '@/hooks/useInventario'
import { useToast } from '@/hooks/useToast'
import { ORIGEN_MATERIAL_LABELS } from '@/lib/materiales'
import type { OrdenMaterial, SugerenciaMaterial } from '@/types/database'

interface AsignarMaterialDialogProps {
  material: OrdenMaterial
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AsignarMaterialDialog({ material, open, onOpenChange }: AsignarMaterialDialogProps) {
  const { data: sugerencias, isLoading } = useSugerenciasMaterial(
    material.item_requerido_id ?? undefined,
    material.cantidad_requerida
  )
  const { data: proveedores } = useProveedores()
  const asignarMaterial = useAsignarMaterial()
  const { toast } = useToast()

  const [seleccion, setSeleccion] = useState<SugerenciaMaterial | null>(null)
  const [cantidad, setCantidad] = useState(material.cantidad_requerida)
  const [proveedorId, setProveedorId] = useState<string>('')

  useEffect(() => {
    if (open) {
      setSeleccion(null)
      setCantidad(material.cantidad_requerida)
      setProveedorId('')
    }
  }, [open, material.cantidad_requerida])

  const esSobrePedido = seleccion?.origen === 'sobre_pedido'

  const onConfirmar = async () => {
    if (!seleccion) return
    try {
      await asignarMaterial.mutateAsync({
        materialId: material.id,
        itemId: seleccion.item_id,
        origen: seleccion.origen,
        cantidad,
        proveedorId: esSobrePedido && proveedorId ? proveedorId : undefined,
      })
      toast({ title: 'Material asignado', variant: 'success' })
      onOpenChange(false)
    } catch (err) {
      toast({
        title: 'Error al asignar el material',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Elegir material para "{material.item_requerido?.nombre ?? '—'}"</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Se necesitan <span className="font-mono font-medium text-foreground">{material.cantidad_requerida}</span>{' '}
            {material.item_requerido?.unidad_medida?.simbolo}
          </p>

          {isLoading ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Buscando opciones...</p>
          ) : !sugerencias || sugerencias.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No hay opciones disponibles</p>
          ) : (
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {sugerencias.map((s) => (
                <button
                  key={s.item_id}
                  type="button"
                  onClick={() => { setSeleccion(s); setCantidad(material.cantidad_requerida) }}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    seleccion?.item_id === s.item_id ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{s.nombre}</span>
                    <Badge variant="outline" className="text-xs">{ORIGEN_MATERIAL_LABELS[s.origen]}</Badge>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {s.origen === 'sobre_pedido'
                        ? 'Se compra para esta orden'
                        : `Disponible: ${s.stock_actual}`}
                      {s.ancho_cm && s.alto_cm ? ` · ${s.ancho_cm} × ${s.alto_cm} cm` : ''}
                    </span>
                    {s.origen !== 'sobre_pedido' && (
                      <span className={s.cubre ? 'text-emerald-600' : 'text-destructive'}>
                        {s.cubre ? 'Alcanza' : 'No alcanza'}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {seleccion && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="space-y-1">
                <Label className="text-xs">
                  {esSobrePedido ? 'Cantidad real que se pidió' : 'Cantidad a asignar'}
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  value={cantidad}
                  onChange={(e) => setCantidad(parseFloat(e.target.value) || 0)}
                />
              </div>
              {esSobrePedido && (
                <div className="space-y-1">
                  <Label className="text-xs">Proveedor (opcional)</Label>
                  <Select value={proveedorId} onValueChange={setProveedorId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona..." />
                    </SelectTrigger>
                    <SelectContent>
                      {proveedores?.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">El costo se registra por aparte, antes de cerrar la producción.</p>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!seleccion || cantidad <= 0 || asignarMaterial.isPending}
            onClick={onConfirmar}
          >
            {asignarMaterial.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Asignar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
