import { useEffect, useState } from 'react'
import { Check, Loader2, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { IconoTipoCategoria } from '@/components/shared/IconoTipoCategoria'
import { useConsolidarEleccion } from '@/hooks/useCotizaciones'
import { useConfiguracionEmpresa } from '@/hooks/useConfiguracionEmpresa'
import { useToast } from '@/hooks/useToast'
import { textoAnticipoSolicitado } from '@/lib/pagos'
import { codigoOpcion, ESTADOS_COTIZACION_CONFIG, TIPO_CATEGORIA_CONFIG } from '@/lib/cotizaciones'
import { cn, formatCOP, mensajeError } from '@/lib/utils'
import type { Cotizacion, EnvioCategoria } from '@/types/database'

/** Lo elegido en una categoría: el id de la opción, o null si el cliente no la toma. */
type Eleccion = Record<string, string | null>

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  grupoId: string
  categorias: EnvioCategoria[]
  opciones: Cotizacion[]
  /** Opción desde la que se abrió: queda preseleccionada en su categoría. */
  preseleccion?: string
  /** El pedido quedó armado; sigue el cobro del anticipo. */
  onPedidoCreado: (pedido: Cotizacion) => void
}

/**
 * El cliente dice qué opción toma de cada categoría, o que no toma alguna.
 * Al confirmar se arma el pedido con lo elegido y el resto queda descartado.
 */
export function ElegirOpcionesDialog({
  open, onOpenChange, grupoId, categorias, opciones, preseleccion, onPedidoCreado,
}: Props) {
  const { toast } = useToast()
  const consolidar = useConsolidarEleccion()
  const { data: empresa } = useConfiguracionEmpresa()
  const [eleccion, setEleccion] = useState<Eleccion>({})

  // Cada apertura empieza de cero, con la opción de origen ya marcada.
  useEffect(() => {
    if (!open) return
    const origen = opciones.find((o) => o.id === preseleccion)
    setEleccion(origen?.categoria_id ? { [origen.categoria_id]: origen.id } : {})
  }, [open, preseleccion, opciones])

  const elegidas = Object.values(eleccion).filter((v): v is string => !!v)
  const faltan = categorias.filter((c) => !(c.id in eleccion))
  const total = opciones.filter((o) => elegidas.includes(o.id)).reduce((s, o) => s + o.total, 0)
  const pct = empresa?.anticipo_solicitado_pct

  const confirmar = async () => {
    try {
      const pedido = await consolidar.mutateAsync({ grupoId, opciones: elegidas })
      toast({ title: `Pedido ${pedido.numero} armado con ${elegidas.length} ${elegidas.length === 1 ? 'opción' : 'opciones'}`, variant: 'success' })
      onPedidoCreado(pedido)
    } catch (err) {
      toast({ title: mensajeError(err, 'No se pudo registrar la elección'), variant: 'destructive' })
    }
  }

  const fila = (activo: boolean, contenido: React.ReactNode, onClick: () => void, deshabilitado = false, key?: string) => (
    <button
      key={key}
      type="button"
      role="radio"
      aria-checked={activo}
      disabled={deshabilitado}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors',
        activo ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/50',
        deshabilitado && 'cursor-not-allowed opacity-50 hover:bg-transparent'
      )}
    >
      <span className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
        activo && 'border-primary bg-primary text-primary-foreground'
      )}>
        {activo && <Check className="h-3 w-3" />}
      </span>
      {contenido}
    </button>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>¿Qué eligió el cliente?</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Una opción por categoría, o "No la toma". Con lo elegido se arma un solo pedido y se cobra un solo anticipo.
          </p>
        </DialogHeader>

        <div className="space-y-4">
          {categorias.map((cat) => {
            const cfg = TIPO_CATEGORIA_CONFIG[cat.tipo]
            const deEsta = opciones.filter((o) => o.categoria_id === cat.id && o.estado !== 'anulada')
            const actual = eleccion[cat.id]
            return (
              <div key={cat.id} role="radiogroup" aria-label={cat.nombre} className="space-y-1.5">
                <p className="flex items-center gap-2 border-l-4 pl-2 text-sm font-semibold" style={{ borderLeftColor: cfg.color }}>
                  <IconoTipoCategoria tipo={cat.tipo} className="h-4 w-4" />
                  {cat.nombre}
                </p>
                {deEsta.map((o) => {
                  const elegible = o.estado === 'enviada'
                  return fila(
                    actual === o.id,
                    <>
                      <span className="w-6 shrink-0 font-bold">{codigoOpcion(cat.orden, o.opcion_etiqueta ?? '')}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1">
                          {o.opcion_nombre || `Opción ${o.opcion_etiqueta}`}
                          {o.recomendada && <Star className="h-3 w-3 fill-amber-400 text-amber-500" aria-label="Recomendada" />}
                        </span>
                        {!elegible && (
                          <span className="block text-xs text-muted-foreground">{ESTADOS_COTIZACION_CONFIG[o.estado].label}</span>
                        )}
                      </span>
                      <span className="font-mono">{formatCOP(o.total)}</span>
                    </>,
                    () => setEleccion((prev) => ({ ...prev, [cat.id]: o.id })),
                    !elegible,
                    o.id,
                  )
                })}
                {fila(
                  actual === null,
                  <span className="text-muted-foreground">No la toma</span>,
                  () => setEleccion((prev) => ({ ...prev, [cat.id]: null })),
                )}
              </div>
            )
          })}
        </div>

        <div className="space-y-1 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <div className="flex justify-between font-semibold">
            <span>Total del pedido</span>
            <span className="font-mono">{formatCOP(total)}</span>
          </div>
          {pct && total > 0 && <p className="text-xs text-muted-foreground">{textoAnticipoSolicitado(pct, total)}</p>}
          <p className="text-xs text-muted-foreground">Las opciones que no se eligen quedan descartadas.</p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={confirmar} disabled={consolidar.isPending || faltan.length > 0 || elegidas.length === 0}>
            {consolidar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {faltan.length > 0
              ? `Falta: ${faltan.map((c) => c.nombre).join(', ')}`
              : elegidas.length === 0
                ? 'Elige al menos una opción'
                : 'Armar pedido y cobrar anticipo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
