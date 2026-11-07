import type { CategoriaGasto, MetodoPago } from '@/types/database'
import { esGastoVivo, esReversoAnulacion, esVentaAnulada, totalGastosEfectivo } from './pagos'
import { formatCOP } from './utils'

// El día de caja se corta a medianoche hora Colombia, igual que
// `caja_es_del_dia` en Postgres: la base es la que bloquea, esto solo avisa antes.
const fechaBogota = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' })

/** La sesión se abrió en un día anterior y ya solo admite cerrarse. */
export function cajaVencida(openedAt: string): boolean {
  return fechaBogota.format(new Date(openedAt)) !== fechaBogota.format(new Date())
}

/**
 * Descuadre en pesos que se acepta sin explicación. Por encima, el cierre exige
 * una observación. Espejo de `v_tolerancia` en `cerrar_caja` (Postgres), que es
 * quien realmente lo hace cumplir: si cambia aquí, cambia allá.
 */
export const TOLERANCIA_CAJA = 2000

export type EstadoArqueo = 'cuadra' | 'tolerancia' | 'fuera'

export function estadoArqueo(diferencia: number): EstadoArqueo {
  const abs = Math.abs(Math.round(diferencia))
  if (abs === 0) return 'cuadra'
  return abs <= TOLERANCIA_CAJA ? 'tolerancia' : 'fuera'
}

export const requiereObservacion = (diferencia: number) => estadoArqueo(diferencia) === 'fuera'

/** "Cuadra", "Sobran $5.000" o "Faltan $12.000": el estado dicho en palabras. */
export function textoDiferencia(diferencia: number): string {
  const d = Math.round(diferencia)
  if (d === 0) return 'Cuadra'
  return d > 0 ? `Sobran ${formatCOP(d)}` : `Faltan ${formatCOP(-d)}`
}

/** Billetes y monedas en circulación, de mayor a menor. El 1.000 existe en las dos formas. */
export const DENOMINACIONES_COP: { valor: number; tipo: 'billete' | 'moneda' | 'ambos' }[] = [
  { valor: 100000, tipo: 'billete' },
  { valor: 50000, tipo: 'billete' },
  { valor: 20000, tipo: 'billete' },
  { valor: 10000, tipo: 'billete' },
  { valor: 5000, tipo: 'billete' },
  { valor: 2000, tipo: 'billete' },
  { valor: 1000, tipo: 'ambos' },
  { valor: 500, tipo: 'moneda' },
  { valor: 200, tipo: 'moneda' },
  { valor: 100, tipo: 'moneda' },
  { valor: 50, tipo: 'moneda' },
]

/** Cantidad de piezas por denominación, como texto de input ('' = vacío). */
export type Cantidades = Record<number, string>

export const totalDenominaciones = (cantidades: Cantidades) =>
  DENOMINACIONES_COP.reduce((s, d) => s + d.valor * Number(cantidades[d.valor] || 0), 0)

type VentaArqueo = { metodo_pago: MetodoPago; monto: number; anulado_at: string | null }
type MovimientoArqueo = {
  categoria: CategoriaGasto
  metodo_pago: MetodoPago
  monto: number
  anulado_at: string | null
  afecta_efectivo?: boolean
}

export type CifrasTurno = {
  /** Cobros vivos (sin anulados) por método. Es lo "esperado" de cada método. */
  porMetodo: Record<MetodoPago, number>
  numCobros: number
  /** Efectivo, tarjeta y transferencia: dinero que sí llegó a la caja o al banco. */
  dineroRecibido: number
  /** Crédito de financiera: el cliente quedó pagado pero el dinero aún no llega. */
  creditoFinanciera: number
  // Términos de la fórmula del efectivo esperado.
  fondo: number
  /** Todo el efectivo que entró, anulado o no: su reverso lo compensa como egreso. */
  ventasEfectivo: number
  gastos: number
  retiros: number
  reversos: number
  efectivoEsperado: number
}

/**
 * Las cifras del turno. Es la misma cuenta de `cerrar_caja` en Postgres:
 * fondo + cobros en efectivo − egresos en efectivo (gastos, retiros y reversos).
 * Los retiros son una categoría de gasto; aquí solo se separan para mostrarlos.
 */
export function calcularArqueo(
  ventas: VentaArqueo[] = [],
  movimientos: MovimientoArqueo[] = [],
  openingAmount: number
): CifrasTurno {
  const porMetodo: Record<MetodoPago, number> = { efectivo: 0, tarjeta: 0, transferencia: 0, financiera: 0 }
  const activas = ventas.filter((v) => !esVentaAnulada(v))
  for (const v of activas) porMetodo[v.metodo_pago] += v.monto

  const ventasEfectivo = ventas.reduce((s, v) => (v.metodo_pago === 'efectivo' ? s + v.monto : s), 0)
  const vivos = movimientos.filter(esGastoVivo)
  const reversos = totalGastosEfectivo(vivos.filter(esReversoAnulacion))
  const retiros = totalGastosEfectivo(vivos.filter((m) => m.categoria === 'retiro'))
  const gastos = totalGastosEfectivo(vivos.filter((m) => !esReversoAnulacion(m) && m.categoria !== 'retiro'))

  return {
    porMetodo,
    numCobros: activas.length,
    dineroRecibido: porMetodo.efectivo + porMetodo.tarjeta + porMetodo.transferencia,
    creditoFinanciera: porMetodo.financiera,
    fondo: openingAmount,
    ventasEfectivo,
    gastos,
    retiros,
    reversos,
    efectivoEsperado: openingAmount + ventasEfectivo - gastos - retiros - reversos,
  }
}
