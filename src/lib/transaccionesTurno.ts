import type { VentaConCotizacion } from '@/hooks/useVentasCaja'
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
import { formatHora } from '@/lib/utils'
import type { CategoriaGasto, MetodoPago, MovimientoCajaConUsuario } from '@/types/database'

/**
 * Las transacciones de un turno de caja agrupadas como se leen en el arqueo.
 * La usan la pantalla del cierre (con filtros) y el documento impreso (sin
 * filtros), para que las dos cuenten lo mismo.
 */

export type SeccionTurno = 'ventas' | 'gastos' | 'retiros' | 'devoluciones'

export const SECCIONES_TURNO: { id: SeccionTurno; nombre: string }[] = [
  { id: 'ventas', nombre: 'Ventas' },
  { id: 'gastos', nombre: 'Gastos' },
  { id: 'retiros', nombre: 'Retiros' },
  { id: 'devoluciones', nombre: 'Devoluciones' },
]

export const TODOS = 'todos'

/** Una fila de cualquier sección, ya traducida a lo que se muestra. */
export type FilaTurno = {
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

export type GrupoTurno = { titulo: string; filas: FilaTurno[]; pie: { etiqueta: string; valor: number }[] }

export type FiltroTurno = { metodo: MetodoPago | typeof TODOS; cajero: string }

const SIN_FILTRO: FiltroTurno = { metodo: TODOS, cajero: TODOS }

export const nombrePersona = (u: { nombre: string; apellido: string } | null | undefined) =>
  u ? `${u.nombre} ${u.apellido}` : '—'

function filaVenta(v: VentaConCotizacion): FilaTurno {
  const origen = origenDeVenta(v)
  return {
    id: v.id,
    hora: formatHora(v.created_at),
    documento: origen.numero,
    cotizacionId: v.cotizacion_id,
    detalle: `${origen.cliente} · ${TIPO_PAGO_LABEL[v.tipo]}`,
    metodo: v.metodo_pago,
    cajero: nombrePersona(v.usuario),
    monto: v.monto,
    anulada: esVentaAnulada(v),
    motivoAnulacion: v.motivo_anulacion,
    venta: v,
  }
}

function filaMovimiento(m: MovimientoCajaConUsuario): FilaTurno {
  return {
    id: m.id,
    hora: formatHora(m.created_at),
    documento: m.concepto,
    cotizacionId: m.venta?.cotizacion_id,
    detalle: CATEGORIA_GASTO_LABEL[m.categoria],
    metodo: m.metodo_pago,
    cajero: nombrePersona(m.usuario),
    monto: m.monto,
    anulada: !esGastoVivo(m),
    motivoAnulacion: m.motivo_anulacion,
    nota: m.afecta_efectivo === false ? 'Sin salida de efectivo' : undefined,
  }
}

/** Quienes registraron algo en el turno, para el filtro por cajero. */
export function cajerosDelTurno(ventas: VentaConCotizacion[], movimientos: MovimientoCajaConUsuario[]) {
  const todos = new Set<string>()
  for (const v of ventas) todos.add(nombrePersona(v.usuario))
  for (const m of movimientos) todos.add(nombrePersona(m.usuario))
  return [...todos].sort()
}

export function agruparTransacciones(
  ventas: VentaConCotizacion[],
  movimientos: MovimientoCajaConUsuario[],
  { metodo, cajero }: FiltroTurno = SIN_FILTRO,
): Record<SeccionTurno, GrupoTurno[]> {
  const pasaFiltro = (f: { metodo: MetodoPago; cajero: string }) =>
    (metodo === TODOS || f.metodo === metodo) && (cajero === TODOS || f.cajero === cajero)
  const movPasaFiltro = (m: MovimientoCajaConUsuario) =>
    pasaFiltro({ metodo: m.metodo_pago, cajero: nombrePersona(m.usuario) })

  const ventasFiltradas = ventas.map(filaVenta).filter(pasaFiltro)
  const gruposVentas = (Object.keys(METODO_PAGO_LABEL) as MetodoPago[])
    .map((met): GrupoTurno => {
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
  const gruposGastos = categorias.map((cat): GrupoTurno => {
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
}
