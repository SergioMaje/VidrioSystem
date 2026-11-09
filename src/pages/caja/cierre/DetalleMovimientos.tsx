import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { VentaConCotizacion } from '@/hooks/useVentasCaja'
import { AccionesRecibo } from '@/components/shared/AccionesRecibo'
import { EnlaceDocumento } from '@/components/shared/EnlaceDocumento'
import {
  CATEGORIA_GASTO_LABEL,
  METODO_PAGO_LABEL,
  TIPO_PAGO_LABEL,
  esGastoVivo,
  esReversoAnulacion,
  esVentaAnulada,
  origenDeVenta,
  totalGastosEfectivo,
} from '@/lib/pagos'
import { cn, formatHora } from '@/lib/utils'
import type { CategoriaGasto, MetodoPago, MovimientoCajaConUsuario } from '@/types/database'
import { BadgeAnulada } from '../AnularVentaDialog'
import type { SeccionDetalle } from './FormulaEfectivo'
import { Monto } from './Monto'

const SECCIONES: { id: SeccionDetalle; nombre: string }[] = [
  { id: 'ventas', nombre: 'Ventas' },
  { id: 'gastos', nombre: 'Gastos' },
  { id: 'retiros', nombre: 'Retiros' },
  { id: 'devoluciones', nombre: 'Devoluciones' },
]

const TODOS = 'todos'

/** Una fila de cualquier sección, ya traducida a lo que se muestra. */
type Fila = {
  id: string
  hora: string
  documento: string
  /** Cotización a la que enlaza el documento: cobros de cotización y sus reversos. */
  cotizacionId?: string | null
  detalle: string
  metodo: MetodoPago
  cajero: string
  monto: number
  /** No suma: cobro o gasto anulado. */
  anulada: boolean
  motivoAnulacion?: string | null
  nota?: string
  venta?: VentaConCotizacion
}

type Grupo = { titulo: string; filas: Fila[]; pie: { etiqueta: string; valor: number }[] }

const nombre = (u: { nombre: string; apellido: string } | null | undefined) =>
  u ? `${u.nombre} ${u.apellido}` : '—'

/**
 * Las transacciones detrás de cada cifra del arqueo, plegadas por defecto.
 * Al imprimir se despliegan todas las secciones, en el mismo orden.
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

  const filasVentas: Fila[] = useMemo(
    () =>
      ventas.map((v) => {
        const origen = origenDeVenta(v)
        return {
          id: v.id,
          hora: formatHora(v.created_at),
          documento: origen.numero,
          cotizacionId: v.cotizacion_id,
          detalle: `${origen.cliente} · ${TIPO_PAGO_LABEL[v.tipo]}`,
          metodo: v.metodo_pago,
          cajero: nombre(v.usuario),
          monto: v.monto,
          anulada: esVentaAnulada(v),
          motivoAnulacion: v.motivo_anulacion,
          venta: v,
        }
      }),
    [ventas]
  )

  const filaMovimiento = (m: MovimientoCajaConUsuario): Fila => ({
    id: m.id,
    hora: formatHora(m.created_at),
    documento: m.concepto,
    cotizacionId: m.venta?.cotizacion_id,
    detalle: CATEGORIA_GASTO_LABEL[m.categoria],
    metodo: m.metodo_pago,
    cajero: nombre(m.usuario),
    monto: m.monto,
    anulada: !esGastoVivo(m),
    motivoAnulacion: m.motivo_anulacion,
    nota: m.afecta_efectivo === false ? 'Sin salida de efectivo' : undefined,
  })

  const cajeros = useMemo(() => {
    const todos = new Set<string>()
    for (const v of ventas) todos.add(nombre(v.usuario))
    for (const m of movimientos) todos.add(nombre(m.usuario))
    return [...todos].sort()
  }, [ventas, movimientos])

  const pasaFiltro = (f: { metodo: MetodoPago; cajero: string }) =>
    (metodo === TODOS || f.metodo === metodo) && (cajero === TODOS || f.cajero === cajero)
  const movPasaFiltro = (m: MovimientoCajaConUsuario) =>
    pasaFiltro({ metodo: m.metodo_pago, cajero: nombre(m.usuario) })

  const grupos: Record<SeccionDetalle, Grupo[]> = useMemo(() => {
    const ventasFiltradas = filasVentas.filter(pasaFiltro)
    const gruposVentas = (Object.keys(METODO_PAGO_LABEL) as MetodoPago[])
      .map((met): Grupo => {
        const filas = ventasFiltradas.filter((f) => f.metodo === met)
        const vigente = filas.reduce((s, f) => (f.anulada ? s : s + f.monto), 0)
        const anulado = filas.reduce((s, f) => (f.anulada ? s + f.monto : s), 0)
        const pie = [{ etiqueta: `Subtotal ${METODO_PAGO_LABEL[met].toLowerCase()}`, valor: vigente }]
        // El arqueo cuenta el efectivo anulado como entrada: su reverso lo saca.
        if (met === 'efectivo' && anulado > 0) {
          pie.push({ etiqueta: 'Entró al cajón (incluye anulados)', valor: vigente + anulado })
        }
        return { titulo: METODO_PAGO_LABEL[met], filas, pie }
      })
      .filter((g) => g.filas.length > 0)

    const gastos = movimientos.filter((m) => !esReversoAnulacion(m) && m.categoria !== 'retiro' && movPasaFiltro(m))
    const categorias = [...new Set(gastos.map((m) => m.categoria))] as CategoriaGasto[]
    const gruposGastos = categorias.map((cat): Grupo => {
      const delGrupo = gastos.filter((m) => m.categoria === cat)
      return {
        titulo: CATEGORIA_GASTO_LABEL[cat],
        filas: delGrupo.map(filaMovimiento),
        pie: [{ etiqueta: 'Subtotal', valor: delGrupo.filter(esGastoVivo).reduce((s, m) => s + m.monto, 0) }],
      }
    })
    if (gruposGastos.length > 1) {
      gruposGastos.push({ titulo: '', filas: [], pie: [{ etiqueta: 'Salió del cajón (efectivo)', valor: totalGastosEfectivo(gastos) }] })
    } else if (gruposGastos.length === 1) {
      gruposGastos[0].pie.push({ etiqueta: 'Salió del cajón (efectivo)', valor: totalGastosEfectivo(gastos) })
    }

    const retiros = movimientos.filter((m) => m.categoria === 'retiro' && movPasaFiltro(m))
    const reversos = movimientos.filter((m) => esReversoAnulacion(m) && movPasaFiltro(m))

    return {
      ventas: gruposVentas,
      gastos: gruposGastos,
      retiros: retiros.length
        ? [{ titulo: '', filas: retiros.map(filaMovimiento), pie: [{ etiqueta: 'Salió del cajón (efectivo)', valor: totalGastosEfectivo(retiros) }] }]
        : [],
      devoluciones: reversos.length
        ? [{ titulo: '', filas: reversos.map(filaMovimiento), pie: [{ etiqueta: 'Salió del cajón (efectivo)', valor: totalGastosEfectivo(reversos) }] }]
        : [],
    }
    // filaMovimiento y los filtros dependen solo de estos valores.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filasVentas, movimientos, metodo, cajero])

  const conteo = (s: SeccionDetalle) => grupos[s].reduce((n, g) => n + g.filas.length, 0)

  return (
    <div className="min-w-0 rounded-md border">
      <button
        type="button"
        onClick={() => onAbiertoChange(!abierto)}
        aria-expanded={abierto}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-muted/50 print:hidden"
      >
        <span>Ver transacciones del turno</span>
        <ChevronDown className={cn('h-4 w-4 transition-transform', abierto && 'rotate-180')} aria-hidden />
      </button>
      <p className="hidden px-3 pt-2 text-xs font-medium uppercase text-muted-foreground print:block">
        Transacciones del turno
      </p>

      <div className={cn('space-y-3 border-t p-3', !abierto && 'hidden print:block')}>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <div role="tablist" className="flex flex-wrap gap-1 rounded-md bg-muted p-1">
            {SECCIONES.map((s) => (
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

        {SECCIONES.map((s) => (
          <section key={s.id} className={cn(seccion !== s.id && 'hidden print:block')} aria-label={s.nombre}>
            <h4 className="mb-1 hidden text-sm font-semibold print:block">{s.nombre}</h4>
            <TablaGrupos grupos={grupos[s.id]} onAnular={s.id === 'ventas' ? onAnular : undefined} />
          </section>
        ))}
      </div>
    </div>
  )
}

function TablaGrupos({ grupos, onAnular }: { grupos: Grupo[]; onAnular?: (v: VentaConCotizacion) => void }) {
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
            {onAnular && <th className="px-3 py-2 print:hidden" />}
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
                      className="flex text-[11px] print:text-muted-foreground print:no-underline"
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
                  <td className="px-3 py-2 text-right print:hidden">
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
                {onAnular && <td className="print:hidden" />}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  )
}
