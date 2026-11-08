import { useState } from 'react'
import { Loader2, Trash2, Pencil, ShoppingCart, FileText, UserPlus, Plus, Copy, Layers } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { InputDinero } from '@/components/shared/InputDinero'
import { ClienteFormDialog } from '@/pages/clientes/ClienteFormDialog'
import { useClientes } from '@/hooks/useClientes'
import { resumenOpciones } from '@/lib/opciones'
import { formatCantidad, formatCOP, cn } from '@/lib/utils'
import { calcularTotales, MAX_OPCIONES } from '@/lib/cotizaciones'
import { detalleMedidasPorLado, medidasDeItem, nombreColorPerfil } from '@/lib/produccion'
import { LADO_MEDICION_LABELS, textoLadoCorredizo } from '@/lib/lados'
import type { CotizacionItem } from '@/types/database'

export type ItemCotizacion = Omit<CotizacionItem, 'id' | 'cotizacion_id'>

/** Lo que se muestra de cada opción del envío en la tira de pestañas. */
export interface ResumenOpcion {
  etiqueta: string
  nombre: string
  total: number
  cantidadItems: number
}

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
  /**
   * Opciones del envío. Si viene, se muestra la tira de pestañas para armar
   * varias opciones; los ítems, descuento e IVA son los de `opcionActiva`.
   */
  opciones?: ResumenOpcion[]
  opcionActiva?: number
  onSeleccionarOpcion?: (idx: number) => void
  onAgregarOpcion?: () => void
  onDuplicarOpcion?: () => void
  onEliminarOpcion?: () => void
  nombreOpcion?: string
  onNombreOpcionChange?: (v: string) => void
  /**
   * Se trabaja una sola opción de un envío (editarla o agregarla): su letra, o
   * 'nueva'. Null en una cotización suelta.
   */
  etiquetaFija?: string | null
  /** Al agregar una opción, cliente, vencimiento y notas son del envío y no se tocan. */
  datosEnvioBloqueados?: boolean
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
  opciones,
  opcionActiva = 0,
  onSeleccionarOpcion,
  onAgregarOpcion,
  onDuplicarOpcion,
  onEliminarOpcion,
  nombreOpcion = '',
  onNombreOpcionChange,
  etiquetaFija = null,
  datosEnvioBloqueados = false,
}: PanelCotizacionProps) {
  const { data: clientes } = useClientes()
  // El cliente se crea aquí mismo, sin salir: navegar perdería los ítems ya cargados.
  const [nuevoClienteOpen, setNuevoClienteOpen] = useState(false)
  const sinClientes = !!clientes && clientes.length === 0

  const { subtotal, total } = calcularTotales(items, descuentoPct, ivaPct)

  const puedeGuardar = !!clienteId && items.length > 0 && !!fechaVencimiento
  const variasOpciones = !!opciones && opciones.length > 1
  // El nombre se pide cuando hay con qué compararlo: varias opciones, o una
  // opción de un envío ya existente.
  const pideNombre = variasOpciones || etiquetaFija !== null
  const etiquetaVisible = etiquetaFija ?? (variasOpciones ? opciones![opcionActiva].etiqueta : null)

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
            {sinClientes ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2">
                <span className="text-sm text-muted-foreground">Aún no hay clientes.</span>
                <Button type="button" size="sm" onClick={() => setNuevoClienteOpen(true)}>
                  <UserPlus className="mr-2 h-4 w-4" />
                  Crear cliente
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Select value={clienteId} onValueChange={onClienteChange} disabled={datosEnvioBloqueados}>
                  <SelectTrigger className="flex-1">
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
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  title="Nuevo cliente"
                  aria-label="Nuevo cliente"
                  disabled={datosEnvioBloqueados}
                  onClick={() => setNuevoClienteOpen(true)}
                >
                  <UserPlus className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Fecha de vencimiento <span className="text-destructive">*</span></Label>
            <Input
              type="date"
              value={fechaVencimiento}
              onChange={(e) => onFechaVencimientoChange(e.target.value)}
              disabled={datosEnvioBloqueados}
            />
            <p className="text-xs text-muted-foreground">
              {datosEnvioBloqueados
                ? 'Cliente, vencimiento y notas son los del envío.'
                : 'Hasta cuándo es válido el precio cotizado.'}
            </p>
          </div>
        </CardContent>
      </Card>

      {opciones && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4" />
              Opciones del envío
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {variasOpciones
                ? 'El cliente elige una. Al cobrar su anticipo, las demás quedan descartadas.'
                : 'Agrega otra opción para que el cliente compare (p. ej. otro vidrio o color).'}
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Opciones del envío">
              {opciones.map((o, idx) => (
                <button
                  key={o.etiqueta}
                  type="button"
                  role="tab"
                  aria-selected={idx === opcionActiva}
                  onClick={() => onSeleccionarOpcion?.(idx)}
                  className={cn(
                    'flex flex-col items-start rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors',
                    idx === opcionActiva
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'hover:bg-muted',
                    o.cantidadItems === 0 && idx !== opcionActiva && 'border-dashed'
                  )}
                >
                  <span className="font-semibold">
                    Opción {o.etiqueta}
                    {o.nombre && <span className="font-normal text-muted-foreground"> · {o.nombre}</span>}
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {o.cantidadItems === 0 ? 'Sin ítems' : formatCOP(o.total)}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onDuplicarOpcion}
                disabled={opciones.length >= MAX_OPCIONES || items.length === 0}
                title="Crea otra opción con una copia de los ítems de esta"
              >
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                Duplicar {variasOpciones ? `opción ${opciones[opcionActiva].etiqueta}` : 'como opción B'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onAgregarOpcion}
                disabled={opciones.length >= MAX_OPCIONES}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Opción vacía
              </Button>
              {variasOpciones && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={onEliminarOpcion}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Eliminar opción {opciones[opcionActiva].etiqueta}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="flex-1">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {etiquetaVisible
              ? etiquetaVisible === 'nueva' ? 'Ítems de la nueva opción' : `Ítems de la opción ${etiquetaVisible}`
              : 'Ítems'}
            {items.length > 0 && <span className="ml-2 text-sm font-normal text-muted-foreground">({items.length})</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {pideNombre && onNombreOpcionChange && (
            <div className="space-y-1">
              <Label className="text-xs">Nombre de la opción (lo ve el cliente)</Label>
              <Input
                value={nombreOpcion}
                onChange={(e) => onNombreOpcionChange(e.target.value)}
                placeholder="Ej.: Templado 5 mm, Aluminio negro…"
                maxLength={60}
                className="h-8 text-sm"
              />
            </div>
          )}
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
                          {item.area_m2 != null && ` (${formatCantidad(item.area_m2)} m²)`}
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
                      <InputDinero
                        value={item.precio_unitario ? String(item.precio_unitario) : ''}
                        onChange={(d) => onUpdateItem(idx, 'precio_unitario', Number(d) || 0)}
                        inputClassName="h-7 text-sm"
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
            <span>Total{etiquetaVisible && etiquetaVisible !== 'nueva' ? ` opción ${etiquetaVisible}` : ''}</span>
            <span className="font-mono text-primary">{formatCOP(total)}</span>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Notas</Label>
            <textarea
              className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              rows={2}
              placeholder={variasOpciones ? 'Notas para el cliente (aplican a todas las opciones)...' : 'Notas para el cliente...'}
              value={notas}
              onChange={(e) => onNotasChange(e.target.value)}
              disabled={datosEnvioBloqueados}
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
                  {variasOpciones ? `Enviar ${opciones!.length} opciones` : 'Enviar'}
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <ClienteFormDialog
        open={nuevoClienteOpen}
        onOpenChange={setNuevoClienteOpen}
        onCreado={(cliente) => onClienteChange(cliente.id)}
      />
    </div>
  )
}
