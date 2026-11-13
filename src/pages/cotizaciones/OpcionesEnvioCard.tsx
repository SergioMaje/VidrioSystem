import { Copy, Layers, Plus, Star, Trash2, Ungroup } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { IconoTipoCategoria } from '@/components/shared/IconoTipoCategoria'
import {
  MAX_OPCIONES, rangoTotales, TIPO_CATEGORIA_CONFIG, TIPOS_CATEGORIA, type TipoCategoria,
} from '@/lib/cotizaciones'
import { cn, formatCOP } from '@/lib/utils'

/** Una parte del envío mientras se arma (p. ej. "Puerta principal"). */
export interface CategoriaForm {
  nombre: string
  tipo: TipoCategoria
}

/** Lo que se muestra de cada opción del envío en la tarjeta. */
export interface ResumenOpcion {
  /** Código visible: "B", o "2B" con categorías. */
  codigo: string
  nombre: string
  total: number
  cantidadItems: number
  /** Índice de su categoría; null si el envío no está dividido. */
  categoria: number | null
  recomendada: boolean
}

interface OpcionesEnvioCardProps {
  categorias: CategoriaForm[]
  opciones: ResumenOpcion[]
  activa: number
  onSeleccionar: (idx: number) => void
  /** Opción vacía; con categorías, en la indicada. */
  onAgregarVacia: (categoria?: number) => void
  onDuplicar: () => void
  onEliminar: () => void
  onDividir: () => void
  onQuitarDivision: () => void
  onAgregarCategoria: () => void
  onEliminarCategoria: (idx: number) => void
  onCambiarCategoria: (idx: number, cambio: Partial<CategoriaForm>) => void
}

/**
 * Las opciones del envío en el formulario. Sin categorías, una tira de
 * pestañas A, B, C; con categorías, un bloque por parte con sus opciones.
 */
export function OpcionesEnvioCard({
  categorias,
  opciones,
  activa,
  onSeleccionar,
  onAgregarVacia,
  onDuplicar,
  onEliminar,
  onDividir,
  onQuitarDivision,
  onAgregarCategoria,
  onEliminarCategoria,
  onCambiarCategoria,
}: OpcionesEnvioCardProps) {
  const porCategoria = categorias.length > 0
  const actual = opciones[activa]
  const variasOpciones = opciones.length > 1
  const hermanasActual = opciones.filter((o) => o.categoria === actual.categoria)
  const llenaActual = hermanasActual.length >= MAX_OPCIONES
  // Con categorías, una categoría no se queda sin opciones: se elimina la categoría.
  const puedeEliminar = porCategoria ? hermanasActual.length > 1 : variasOpciones

  const chip = (o: ResumenOpcion, idx: number) => (
    <button
      key={idx}
      type="button"
      role="tab"
      aria-selected={idx === activa}
      onClick={() => onSeleccionar(idx)}
      className={cn(
        'flex flex-col items-start rounded-md border bg-background px-2.5 py-1.5 text-left text-xs transition-colors',
        idx === activa ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted',
        o.cantidadItems === 0 && idx !== activa && 'border-dashed'
      )}
    >
      <span className="flex items-center gap-1 font-semibold">
        Opción {o.codigo}
        {o.recomendada && <Star className="h-3 w-3 fill-amber-400 text-amber-500" aria-label="Recomendada" />}
        {o.nombre && <span className="font-normal text-muted-foreground"> · {o.nombre}</span>}
      </span>
      <span className="font-mono text-muted-foreground">
        {o.cantidadItems === 0 ? 'Sin ítems' : formatCOP(o.total)}
      </span>
    </button>
  )

  const rango = porCategoria
    ? rangoTotales(categorias.map((_, c) => opciones.filter((o) => o.categoria === c && o.cantidadItems > 0).map((o) => o.total)))
    : null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="h-4 w-4" />
          Opciones del envío
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {porCategoria
            ? 'El cliente elige una opción de cada categoría (o ninguna). Su elección se cobra como un solo pedido.'
            : variasOpciones
              ? 'El cliente elige una. Al cobrar su anticipo, las demás quedan descartadas.'
              : 'Agrega otra opción para que el cliente compare (p. ej. otro vidrio o color).'}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {porCategoria ? (
          <div className="space-y-2.5">
            {categorias.map((cat, c) => {
              const cfg = TIPO_CATEGORIA_CONFIG[cat.tipo]
              const deEsta = opciones.map((o, idx) => [o, idx] as const).filter(([o]) => o.categoria === c)
              return (
                <div
                  key={c}
                  className="space-y-2 rounded-md border border-l-4 p-2.5"
                  style={{ borderLeftColor: cfg.color, backgroundColor: `${cfg.fondo}66` }}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="w-4 text-center text-xs font-bold text-muted-foreground">{c + 1}</span>
                    <Input
                      value={cat.nombre}
                      onChange={(e) => onCambiarCategoria(c, { nombre: e.target.value })}
                      placeholder="Ej.: Puerta principal"
                      maxLength={60}
                      aria-label={`Nombre de la categoría ${c + 1}`}
                      className={cn('h-8 flex-1 bg-background text-sm', !cat.nombre.trim() && 'border-dashed')}
                    />
                    <Select value={cat.tipo} onValueChange={(v) => onCambiarCategoria(c, { tipo: v as TipoCategoria })}>
                      <SelectTrigger className="h-8 w-[118px] bg-background text-xs" aria-label="Tipo de la categoría">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIPOS_CATEGORIA.map((t) => (
                          <SelectItem key={t} value={t}>
                            <span className="flex items-center gap-1.5">
                              <IconoTipoCategoria tipo={t} className="h-3.5 w-3.5" />
                              {TIPO_CATEGORIA_CONFIG[t].label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {categorias.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                        title="Eliminar la categoría con sus opciones"
                        aria-label={`Eliminar la categoría ${cat.nombre || c + 1}`}
                        onClick={() => onEliminarCategoria(c)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={`Opciones de ${cat.nombre || `la categoría ${c + 1}`}`}>
                    {deEsta.map(([o, idx]) => chip(o, idx))}
                    <button
                      type="button"
                      onClick={() => onAgregarVacia(c)}
                      disabled={deEsta.length >= MAX_OPCIONES}
                      title="Opción vacía en esta categoría"
                      aria-label="Agregar opción vacía en esta categoría"
                      className="flex items-center rounded-md border border-dashed bg-background px-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Opciones del envío">
            {opciones.map((o, idx) => chip(o, idx))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDuplicar}
            disabled={llenaActual || actual.cantidadItems === 0}
            title="Crea otra opción con una copia de los ítems de esta"
          >
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            Duplicar {variasOpciones || porCategoria ? `opción ${actual.codigo}` : 'como opción B'}
          </Button>
          {!porCategoria && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onAgregarVacia()} disabled={llenaActual}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Opción vacía
            </Button>
          )}
          {puedeEliminar && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={onEliminar}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Eliminar opción {actual.codigo}
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {porCategoria ? (
            <>
              <Button type="button" variant="outline" size="sm" onClick={onAgregarCategoria}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Agregar categoría
              </Button>
              {categorias.length === 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={onQuitarDivision}
                  title="Vuelve a un envío de opciones simples, donde el cliente elige una sola"
                >
                  <Ungroup className="mr-1.5 h-3.5 w-3.5" />
                  Quitar categorías
                </Button>
              )}
            </>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onDividir}
              title="Para cotizar varias partes en el mismo envío, p. ej. una puerta y una ventana, cada una con sus opciones"
            >
              <Layers className="mr-1.5 h-3.5 w-3.5" />
              Dividir por categorías
            </Button>
          )}
        </div>

        {rango && rango.max > 0 && (
          <p className="text-xs text-muted-foreground">
            Si toma todas las partes:{' '}
            <span className="font-mono text-foreground">
              {rango.min === rango.max ? formatCOP(rango.min) : `${formatCOP(rango.min)} a ${formatCOP(rango.max)}`}
            </span>
          </p>
        )}
      </CardContent>
    </Card>
  )
}
