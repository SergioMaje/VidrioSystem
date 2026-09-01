import { useState, useEffect } from 'react'
import { ShoppingCart, Check, Pencil, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { formatCOP } from '@/lib/utils'
import type { EdicionItem } from './ConfiguradorProducto'
import type { ItemCotizacion } from './PanelCotizacion'

interface ItemLibreFormProps {
  onAgregarItem: (item: ItemCotizacion) => void
  edicion?: EdicionItem | null
  onActualizarItem?: (idx: number, item: ItemCotizacion) => void
  onCancelarEdicion?: () => void
}

/**
 * Alta de un ítem cotizado a mano, sin referencia ni plantilla detrás.
 *
 * Existe para poder cotizar mientras el catálogo (inventario → plantillas →
 * referencias) se termina de cargar. A diferencia del ConfiguradorProducto, aquí
 * no hay costo calculable: el vendedor escribe el precio de venta final, y el ítem
 * viaja a la orden de trabajo marcado como manual, sin despiece ni materiales.
 *
 * Color de perfil, opciones y lados se omiten a propósito: solo tienen sentido
 * cuando hay una referencia que los interprete en producción.
 */
export function ItemLibreForm({
  onAgregarItem,
  edicion,
  onActualizarItem,
  onCancelarEdicion,
}: ItemLibreFormProps) {
  const [descripcion, setDescripcion] = useState('')
  const [anchoCm, setAnchoCm] = useState('')
  const [altoCm, setAltoCm] = useState('')
  const [cantidad, setCantidad] = useState('1')
  const [precioUnitario, setPrecioUnitario] = useState('')
  const [notas, setNotas] = useState('')

  const limpiar = () => {
    setDescripcion('')
    setAnchoCm('')
    setAltoCm('')
    setCantidad('1')
    setPrecioUnitario('')
    setNotas('')
  }

  // Al entrar en edición se precarga el ítem; al salir, el formulario vuelve a
  // quedar limpio para el siguiente alta.
  useEffect(() => {
    if (!edicion) {
      limpiar()
      return
    }
    const { item } = edicion
    setDescripcion(item.descripcion)
    setAnchoCm(item.ancho_cm != null ? String(item.ancho_cm) : '')
    setAltoCm(item.alto_cm != null ? String(item.alto_cm) : '')
    setCantidad(String(item.cantidad))
    setPrecioUnitario(String(item.precio_unitario))
    setNotas(item.notas ?? '')
  }, [edicion])

  const ancho = parseFloat(anchoCm) || 0
  const alto = parseFloat(altoCm) || 0
  const unidades = Math.max(1, Math.floor(parseFloat(cantidad) || 1))
  const precio = Math.max(0, parseFloat(precioUnitario) || 0)

  const conMedidas = ancho > 0 && alto > 0
  const areaM2 = conMedidas ? (ancho / 100) * (alto / 100) : null
  const total = unidades * precio

  const puedeGuardar = descripcion.trim().length > 0 && precio > 0

  const construirItem = (): ItemCotizacion => ({
    plantilla_id: null,
    referencia_id: null,
    descripcion: descripcion.trim(),
    ancho_cm: ancho > 0 ? ancho : null,
    alto_cm: alto > 0 ? alto : null,
    area_m2: areaM2,
    // Un ítem a mano no tiene despiece que calcular, así que no pide medidas por lado:
    // si el vano es irregular, quien cotiza lo escribe en la descripción.
    medidas_irregulares: false,
    ancho_sup_cm: null,
    ancho_inf_cm: null,
    alto_izq_cm: null,
    alto_der_cm: null,
    cantidad: unidades,
    precio_unitario: precio,
    precio_total: total,
    color_perfil: null,
    lado_medicion: null,
    lado_corredizo: null,
    opciones: [],
    notas: notas.trim() || null,
  })

  const guardarItem = () => {
    if (!puedeGuardar) return
    const item = construirItem()
    if (edicion && onActualizarItem) {
      onActualizarItem(edicion.idx, item)
    } else {
      onAgregarItem(item)
      limpiar()
    }
  }

  return (
    <div className="space-y-4">
      {edicion && (
        <div className="flex items-center justify-between rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm text-primary">
          <span className="flex items-center gap-1.5 font-medium">
            <Pencil className="h-3.5 w-3.5" />
            Editando ítem {edicion.idx + 1}
          </span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Ítem libre</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Ítem sin plantilla: se cotiza y se cobra normalmente, pero no genera despiece
              ni lista de materiales en la orden de trabajo.
            </span>
          </div>

          <div className="space-y-2">
            <Label htmlFor="descripcion-libre">
              Descripción <span className="text-destructive">*</span>
            </Label>
            <Input
              id="descripcion-libre"
              placeholder="Ventana corrediza 2 hojas en aluminio, vidrio 4mm"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Es lo que verá el cliente en la cotización y el taller en la orden. Sé
              específico: no hay referencia que complete el detalle.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="ancho-libre">Ancho (cm)</Label>
              <Input
                id="ancho-libre"
                type="number"
                min={0}
                placeholder="Opcional"
                value={anchoCm}
                onChange={(e) => setAnchoCm(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="alto-libre">Alto (cm)</Label>
              <Input
                id="alto-libre"
                type="number"
                min={0}
                placeholder="Opcional"
                value={altoCm}
                onChange={(e) => setAltoCm(e.target.value)}
              />
            </div>
          </div>
          {areaM2 != null && (
            <p className="text-xs text-muted-foreground">
              Área: <span className="font-mono text-foreground">{areaM2.toFixed(2)} m²</span>
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="cantidad-libre">Cantidad</Label>
              <Input
                id="cantidad-libre"
                type="number"
                min={1}
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="precio-libre">
                Precio unitario <span className="text-destructive">*</span>
              </Label>
              <Input
                id="precio-libre"
                type="number"
                min={0}
                placeholder="0"
                value={precioUnitario}
                onChange={(e) => setPrecioUnitario(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notas-libre">Especificaciones</Label>
            <textarea
              id="notas-libre"
              className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              rows={3}
              placeholder="Detalles de fabricación, acabados, observaciones..."
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Total {unidades > 1 && `(${unidades} und)`}
            </span>
            <span className="font-mono text-lg font-bold text-primary">{formatCOP(total)}</span>
          </div>

          {edicion ? (
            <div className="flex w-full gap-2">
              <Button variant="outline" className="flex-1" onClick={onCancelarEdicion}>
                Cancelar
              </Button>
              <Button className="flex-1" onClick={guardarItem} disabled={!puedeGuardar}>
                <Check className="mr-2 h-4 w-4" />
                Guardar cambios
              </Button>
            </div>
          ) : (
            <Button className="w-full" onClick={guardarItem} disabled={!puedeGuardar}>
              <ShoppingCart className="mr-2 h-4 w-4" />
              Agregar a cotización
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
