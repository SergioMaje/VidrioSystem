import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { VentaConCotizacion } from '@/hooks/useVentasCaja'
import { AccionesRecibo } from '@/components/shared/AccionesRecibo'
import { EnlaceDocumento } from '@/components/shared/EnlaceDocumento'
import { METODO_PAGO_LABEL } from '@/lib/pagos'
import {
  SECCIONES_TURNO,
  TODOS,
  agruparTransacciones,
  cajerosDelTurno,
  type GrupoTurno,
} from '@/lib/transaccionesTurno'
import { cn } from '@/lib/utils'
import type { MetodoPago, MovimientoCajaConUsuario } from '@/types/database'
import { BadgeAnulada } from '../AnularVentaDialog'
import type { SeccionDetalle } from './FormulaEfectivo'
import { Monto } from './Monto'

/**
 * Las transacciones detrás de cada cifra del arqueo, plegadas por defecto.
 * Los filtros son solo de pantalla: el documento impreso (imprimirCierreCaja)
 * lleva siempre todas.
 */
export function DetalleMovimientos({
  ventas,
  movimientos,
  abierto,
  onAbiertoChange,
  seccion,
  onSeccionChange,
  metodo,
  onMetodoChange,
  onAnular,
}: {
  ventas: VentaConCotizacion[]
  movimientos: MovimientoCajaConUsuario[]
  abierto: boolean
  onAbiertoChange: (abierto: boolean) => void
  seccion: SeccionDetalle
  onSeccionChange: (s: SeccionDetalle) => void
  metodo: MetodoPago | typeof TODOS
  onMetodoChange: (m: MetodoPago | typeof TODOS) => void
  /** Solo para admin: abre el diálogo de anulación de un cobro. */
  onAnular?: (v: VentaConCotizacion) => void
}) {
  const [cajero, setCajero] = useState<string>(TODOS)
  const cajeros = useMemo(() => cajerosDelTurno(ventas, movimientos), [ventas, movimientos])
  const grupos = useMemo(
    () => agruparTransacciones(ventas, movimientos, { metodo, cajero }),
    [ventas, movimientos, metodo, cajero]
  )

  const conteo = (s: SeccionDetalle) => grupos[s].reduce((n, g) => n + g.filas.length, 0)

  return (
    <div className="min-w-0 rounded-md border">
      <button
        type="button"
        onClick={() => onAbiertoChange(!abierto)}
        aria-expanded={abierto}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-muted/50"
      >
        <span>Ver transacciones del turno</span>
        <ChevronDown className={cn('h-4 w-4 transition-transform', abierto && 'rotate-180')} aria-hidden />
      </button>

      <div className={cn('space-y-3 border-t p-3', !abierto && 'hidden')}>
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" className="flex flex-wrap gap-1 rounded-md bg-muted p-1">
            {SECCIONES_TURNO.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={seccion === s.id}
                onClick={() => onSeccionChange(s.id)}
                className={cn(
                  'rounded-sm px-3 py-1 text-sm font-medium text-muted-foreground',
                  seccion === s.id && 'bg-background text-foreground shadow-sm'
                )}
              >
                {s.nombre} <span className="tabular-nums">({conteo(s.id)})</span>
              </button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Select value={metodo} onValueChange={(v) => onMetodoChange(v as MetodoPago | typeof TODOS)}>
              <SelectTrigger className="h-9 w-40" aria-label="Filtrar por método">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos los métodos</SelectItem>
                {(Object.keys(METODO_PAGO_LABEL) as MetodoPago[]).map((m) => (
                  <SelectItem key={m} value={m}>{METODO_PAGO_LABEL[m]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {cajeros.length > 1 && (
              <Select value={cajero} onValueChange={setCajero}>
                <SelectTrigger className="h-9 w-44" aria-label="Filtrar por cajero">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODOS}>Todos los cajeros</SelectItem>
                  {cajeros.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {SECCIONES_TURNO.map((s) => (
          <section key={s.id} className={cn(seccion !== s.id && 'hidden')} aria-label={s.nombre}>
            <TablaGrupos grupos={grupos[s.id]} onAnular={s.id === 'ventas' ? onAnular : undefined} />
          </section>
        ))}
      </div>
    </div>
  )
}

function TablaGrupos({ grupos, onAnular }: { grupos: GrupoTurno[]; onAnular?: (v: VentaConCotizacion) => void }) {
  if (grupos.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">Nada que mostrar con estos filtros</p>
  }
  const columnas = onAnular ? 7 : 6
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase text-muted-foreground">
            <th className="px-3 py-2">Hora</th>
            <th className="px-3 py-2">Documento / concepto</th>
            <th className="px-3 py-2">Detalle</th>
            <th className="px-3 py-2">Método</th>
            <th className="px-3 py-2">Cajero</th>
            <th className="px-3 py-2 text-right">Monto</th>
            {onAnular && <th className="px-3 py-2" />}
          </tr>
        </thead>
        {grupos.map((g, i) => (
          <tbody key={g.titulo || i}>
            {g.titulo && (
              <tr className="border-b">
                <td colSpan={columnas} className="px-3 pb-1 pt-3 text-xs font-semibold text-muted-foreground">
                  {g.titulo}
                </td>
              </tr>
            )}
            {g.filas.map((f) => (
              <tr key={f.id} className={cn('border-b', f.anulada && 'text-muted-foreground')}>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{f.hora}</td>
                <td className="px-3 py-2">
                  <EnlaceDocumento
                    cotizacionId={f.cotizacionId}
                    className={cn(f.venta && 'whitespace-nowrap font-mono text-xs', f.anulada && 'line-through')}
                  >
                    {f.documento}
                  </EnlaceDocumento>
                  {f.anulada && <BadgeAnulada motivo={f.motivoAnulacion ?? null} />}
                  {f.venta?.numero_recibo && (
                    <AccionesRecibo
                      ventaId={f.venta.id}
                      numero={f.venta.numero_recibo}
                      anulado={f.anulada}
                      className="flex text-[11px]"
                    />
                  )}
                </td>
                <td className="px-3 py-2">
                  {f.detalle}
                  {f.nota && <span className="block text-xs text-muted-foreground">{f.nota}</span>}
                </td>
                <td className="px-3 py-2">{METODO_PAGO_LABEL[f.metodo]}</td>
                <td className="px-3 py-2">{f.cajero}</td>
                <td className={cn('px-3 py-2 text-right', f.anulada && 'line-through')}>
                  <Monto valor={f.monto} />
                </td>
                {onAnular && (
                  <td className="px-3 py-2 text-right">
                    {f.venta && !f.anulada && (
                      <Button size="sm" variant="ghost" onClick={() => onAnular(f.venta!)}>
                        Anular
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {g.pie.map((p) => (
              <tr key={p.etiqueta} className="border-b bg-muted/30 font-medium last:border-0">
                <td colSpan={5} className="px-3 py-2 text-right text-xs text-muted-foreground">{p.etiqueta}</td>
                <td className="px-3 py-2 text-right"><Monto valor={p.valor} /></td>
                {onAnular && <td />}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  )
}
