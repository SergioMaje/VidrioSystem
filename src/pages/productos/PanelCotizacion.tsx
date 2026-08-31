import { Loader2, Trash2, Pencil, ShoppingCart, FileText } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { useClientes } from '@/hooks/useClientes'
import { resumenOpciones } from '@/lib/opciones'
import { formatCOP, cn } from '@/lib/utils'
import { detalleMedidasPorLado, medidasDeItem, nombreColorPerfil } from '@/lib/produccion'
import { LADO_MEDICION_LABELS, textoLadoCorredizo } from '@/lib/lados'
import type { CotizacionItem } from '@/types/database'

export type ItemCotizacion = Omit<CotizacionItem, 'id' | 'cotizacion_id'>

interface PanelCotizacionProps {
  clienteId: string
  onClienteChange: (id: string) => void
  fechaVencimiento: string
  onFechaVencimientoChange: (v: string) => void
  notas: string
  onNotasChange: (v: string) => void
  items: ItemCotizacion[]
  onUpdateItem: (idx: number, field: 'cantidad' | 'precio_unitario', value: number) => void
  onRemoveItem: (idx: number) => void
  descuentoPct: number
  onDescuentoChange: (v: number) => void
  ivaPct: number
  onIvaChange: (v: number) => void
  onGuardar: (estado: 'borrador' | 'enviada') => void
  isPending: boolean
  modoEdicion?: boolean
  editandoIdx?: number | null
  onEditarItem?: (idx: number) => void
}

export function PanelCotizacion({
  clienteId,
  onClienteChange,
  fechaVencimiento,
  onFechaVencimientoChange,
  notas,
  onNotasChange,
  items,
  onUpdateItem,
  onRemoveItem,
  descuentoPct,
  onDescuentoChange,
  ivaPct,
  onIvaChange,
  onGuardar,
  isPending,
  modoEdicion = false,
  editandoIdx = null,
  onEditarItem,
}: PanelCotizacionProps) {
  const { data: clientes } = useClientes()

  const subtotal = items.reduce((s, i) => s + i.precio_total, 0)
  const descuento = subtotal * (descuentoPct / 100)
  const base = subtotal - descuento
  const iva = base * (ivaPct / 100)
  const total = base + iva

  const puedeGuardar = !!clienteId && items.length > 0 && !!fechaVencimiento

  return (
    <div className="flex flex-col gap-4 h-full">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShoppingCart className="h-4 w-4" />
            Cotización
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>Cliente</Label>
            <Select value={clienteId} onValueChange={onClienteChange}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona un cliente..." />
              </SelectTrigger>
              <SelectContent>
                {clientes?.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nombre} {c.apellido}{c.empresa ? ` — ${c.empresa}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Fecha de vencimiento <span className="text-destructive">*</span></Label>
            <Input
              type="date"
              value={fechaVencimiento}
              onChange={(e) => onFechaVencimientoChange(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Hasta cuándo es válido el precio cotizado.</p>
          </div>
        </CardContent>
      </Card>

      <Card className="flex-1">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Ítems{items.length > 0 && <span className="ml-2 text-sm font-normal text-muted-foreground">({items.length})</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <FileText className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                Configura un producto y haz clic en<br />"Agregar a cotización"
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item, idx) => (
                <div
                  key={idx}
                  className={cn(
                    'rounded-md border p-3 space-y-2',
                    editandoIdx === idx && 'border-primary ring-1 ring-primary'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <p className="text-sm font-medium leading-snug">{item.descripcion}</p>
                      {!item.referencia_id && (
                        <span className="inline-block rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                          Manual — sin plantilla
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-0.5">
                      {onEditarItem && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-primary"
                          onClick={() => onEditarItem(idx)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() => onRemoveItem(idx)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-0.5 text-xs text-muted-foreground">
                    {(item.ancho_cm || item.alto_cm) && (
                      <div className="flex justify-between">
                        <span>Medidas</span>
                        <span className="font-mono text-foreground">
                          {item.ancho_cm ?? '—'} × {item.alto_cm ?? '—'} cm
                          {item.area_m2 != null && ` (${item.area_m2.toFixed(2)} m²)`}
                        </span>
                      </div>
                    )}
                    {detalleMedidasPorLado(medidasDeItem(item)) && (
                      <p className="text-amber-700">{detalleMedidasPorLado(medidasDeItem(item))}</p>
                    )}
                    {item.color_perfil && (
                      <div className="flex items-center justify-between">
                        <span>Color</span>
                        <span className="flex items-center gap-1.5 text-foreground">
                          <span
                            className="h-2.5 w-2.5 rounded-full border"
                            style={{ backgroundColor: item.color_perfil }}
                          />
                          {nombreColorPerfil(item.color_perfil) ?? item.color_perfil}
                        </span>
                      </div>
                    )}
                    {item.lado_corredizo && (
                      <div className="flex justify-between">
                        <span>Medido desde</span>
                        <span className="text-foreground">{LADO_MEDICION_LABELS[item.lado_medicion ?? 'exterior']}</span>
                      </div>
                    )}
                    {item.lado_corredizo && (
                      <p className="text-foreground">
                        {textoLadoCorredizo(item.lado_corredizo, item.lado_medicion)}
                      </p>
                    )}
                  </div>
                  {item.opciones?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {resumenOpciones(item.opciones).map((etiqueta) => (
                        <span
                          key={etiqueta}
                          className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {etiqueta}
                        </span>
                      ))}
                    </div>
                  )}
                  {item.notas && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{item.notas}</p>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Cantidad</Label>
                      <Input
                        type="number"
                        min={1}
                        value={item.cantidad}
                        onChange={(e) => onUpdateItem(idx, 'cantidad', parseFloat(e.target.value) || 1)}
                        className="h-7 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Precio unit.</Label>
                      <Input
                        type="number"
                        min={0}
                        value={item.precio_unitario}
                        onChange={(e) => onUpdateItem(idx, 'precio_unitario', parseFloat(e.target.value) || 0)}
                        className="h-7 text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end text-xs font-mono font-semibold text-primary">
                    {formatCOP(item.precio_total)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-mono">{formatCOP(subtotal)}</span>
          </div>
          <div className="flex items-center justify-between text-sm gap-4">
            <span className="text-muted-foreground shrink-0">Descuento (%)</span>
            <Input
              type="number"
              min={0}
              max={100}
              value={descuentoPct}
              onChange={(e) => onDescuentoChange(parseFloat(e.target.value) || 0)}
              className="h-7 w-20 text-right font-mono text-sm"
            />
          </div>
          <div className="flex items-center justify-between text-sm gap-4">
            <span className="text-muted-foreground shrink-0">IVA (%)</span>
            <Input
              type="number"
              min={0}
              max={100}
              value={ivaPct}
              onChange={(e) => onIvaChange(parseFloat(e.target.value) || 0)}
              className="h-7 w-20 text-right font-mono text-sm"
            />
          </div>
          <Separator />
          <div className="flex items-center justify-between font-bold">
            <span>Total</span>
            <span className="font-mono text-primary">{formatCOP(total)}</span>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Notas</Label>
            <textarea
              className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              rows={2}
              placeholder="Notas para el cliente..."
              value={notas}
              onChange={(e) => onNotasChange(e.target.value)}
            />
          </div>

          <div className="flex gap-2 pt-1">
            {modoEdicion ? (
              <Button
                className="flex-1 text-sm"
                disabled={!puedeGuardar || isPending}
                onClick={() => onGuardar('enviada')}
              >
                {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Guardar cambios
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  className="flex-1 text-sm"
                  disabled={!puedeGuardar || isPending}
                  onClick={() => onGuardar('borrador')}
                >
                  {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Borrador
                </Button>
                <Button
                  className="flex-1 text-sm"
                  disabled={!puedeGuardar || isPending}
                  onClick={() => onGuardar('enviada')}
                >
                  Enviar
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
