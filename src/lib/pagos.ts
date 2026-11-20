import type { CategoriaGasto, CondicionPago, EstadoCartera, MetodoPago, TipoPago } from '@/types/database'
import { formatCOP } from './utils'

/** El cliente debe entregar al menos este porcentaje del total como anticipo. */
export const ANTICIPO_MIN_PCT = 0.5

/** Margen en pesos para absorber el redondeo del IVA al comparar montos. */
export const TOLERANCIA = 1

export const anticipoMinimo = (total: number) => Math.round(total * ANTICIPO_MIN_PCT)

export const cumpleAnticipoMinimo = (monto: number, total: number) =>
  monto + TOLERANCIA >= anticipoMinimo(total)

/**
 * Lo que la vidriería le pide al cliente (Configuración), impreso en la
 * cotización. No es la regla de cobro: se sigue aceptando desde
 * `ANTICIPO_MIN_PCT`. Con el 100% no se repite el monto, porque es el total.
 */
export const anticipoSolicitado = (pct: number, total: number) => Math.round((total * pct) / 100)

export function textoAnticipoSolicitado(pct: number, total: number) {
  const texto = `Condiciones de pago: ${pct}% anticipado para envío a producción`
  return pct >= 100 ? texto : `${texto} (${formatCOP(anticipoSolicitado(pct, total))})`
}

export const estaLiquidada = (saldo: number) => saldo <= TOLERANCIA

/**
 * La producción arranca con el anticipo cobrado; el saldo se cobra durante la
 * producción y hasta el día de la entrega. Lo mismo valida el trigger
 * `validar_avance_orden` en Postgres.
 */
export const puedeIniciarProduccion = (abonado: number, total: number) =>
  cumpleAnticipoMinimo(abonado, total)

export const excedeSaldo = (monto: number, saldo: number) => monto > saldo + TOLERANCIA

/** El primer pago es el anticipo; el que liquida la cotización es el saldo final. */
export const tipoDePago = (abonado: number, monto: number, total: number): TipoPago => {
  if (abonado <= 0) return 'anticipo'
  return abonado + monto + TOLERANCIA >= total ? 'saldo_final' : 'abono'
}

export const TIPO_PAGO_LABEL: Record<TipoPago, string> = {
  anticipo: 'Anticipo',
  abono: 'Abono',
  saldo_final: 'Saldo final',
  contado: 'Contado',
}

/** El orden importa: es el que se usa para listar métodos en selects y tiles. */
export const METODO_PAGO_LABEL: Record<MetodoPago, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  financiera: 'Crédito financiera',
}

/** Un gasto sale de la caja o del banco, nunca del crédito de un cliente. */
export const METODOS_GASTO: MetodoPago[] = ['efectivo', 'tarjeta', 'transferencia']

/**
 * Venta a crédito de financiera: el cliente queda pagado, pero el dinero aún no
 * llega. Cubre el total y no se combina con otros medios; la garantía vive en el
 * trigger `validar_pago_cotizacion` (migración 20260916090100).
 */
export const esPagoFinanciera = (v: { metodo_pago: MetodoPago }) => v.metodo_pago === 'financiera'

/** Espejo del cálculo que hace el trigger al vender: round(monto × % / 100). */
export const comisionEstimada = (monto: number, pct: number) => Math.round((monto * pct) / 100)

/** A dónde va el dinero de un pago, para reportes y exportaciones. */
export const destinoDePago = (v: { metodo_pago: MetodoPago; desembolso_id: string | null }) => {
  if (v.metodo_pago === 'efectivo') return 'Caja'
  if (v.metodo_pago === 'financiera') return v.desembolso_id ? 'Desembolsado' : 'Por desembolsar'
  return 'Cuentas'
}

/** El orden importa: es el que se usa para listar categorías en el select de gastos. */
export const CATEGORIA_GASTO_LABEL: Record<CategoriaGasto, string> = {
  domicilio: 'Domicilio',
  transporte: 'Transporte',
  papeleria: 'Papelería',
  servicios: 'Servicios',
  refrigerio: 'Refrigerio',
  proveedor: 'Proveedor',
  retiro: 'Retiro de efectivo',
  otro: 'Otro',
  reverso_anulacion: 'Reverso de anulación',
}

/**
 * Las categorías que se pueden elegir al registrar un gasto a mano. El reverso
 * de anulación solo lo genera `anular_venta` (y `registrar_gasto_caja` lo
 * rechaza).
 */
export const CATEGORIAS_GASTO_MANUAL = (Object.keys(CATEGORIA_GASTO_LABEL) as CategoriaGasto[]).filter(
  (c) => c !== 'reverso_anulacion'
)

export const esReversoAnulacion = (m: { categoria: CategoriaGasto }) => m.categoria === 'reverso_anulacion'

/**
 * Un cobro anulado no cuenta como venta ni como abonado. En la caja sí sigue
 * sumando como ingreso, porque su reverso lo compensa como egreso.
 */
export const esVentaAnulada = (v: { anulado_at: string | null }) => v.anulado_at !== null

/** Un gasto anulado no salió del cajón: no cuenta para el arqueo. */
export const esGastoVivo = (m: { anulado_at: string | null }) => m.anulado_at === null

/**
 * Lo que los egresos del turno (gastos y reversos de anulación) sacaron del
 * cajón. Solo efectivo: un gasto pagado por transferencia se reporta, pero no
 * toca el arqueo, y tampoco un reverso marcado sin salida de efectivo. Espejo
 * en TS de lo que calcula `cerrar_caja` en Postgres.
 */
export const totalGastosEfectivo = (
  movimientos: {
    anulado_at: string | null
    metodo_pago: MetodoPago
    monto: number
    afecta_efectivo?: boolean
  }[] = []
) =>
  movimientos.reduce(
    (suma, m) =>
      esGastoVivo(m) && m.metodo_pago === 'efectivo' && m.afecta_efectivo !== false
        ? suma + m.monto
        : suma,
    0
  )

/** Un pago viene de una cotización o de una venta de mostrador, nunca de las dos. */
type VentaConOrigen = {
  cotizacion?: { numero: string; cliente?: { nombre: string; apellido: string } | null } | null
  venta_mostrador?: { numero: string; cliente?: { nombre: string; apellido: string } | null } | null
}

/** Número y cliente de un pago, venga del origen que venga. */
export function origenDeVenta(venta: VentaConOrigen): { numero: string; cliente: string } {
  const origen = venta.cotizacion ?? venta.venta_mostrador
  const cliente = origen?.cliente
  return {
    numero: origen?.numero ?? '—',
    cliente: cliente ? `${cliente.nombre} ${cliente.apellido}` : '—',
  }
}

// ── Venta a crédito ─────────────────────────────────────────────────────────

/**
 * Venta a crédito con la vidriería (empresas que pagan contra entrega): no
 * pide anticipo para producir y se entrega con cuenta de cobro. Las reglas
 * viven en `validar_avance_orden` y `validar_pago_cotizacion`.
 */
export const esVentaCredito = (c: { condicion_pago?: CondicionPago | null } | null | undefined) =>
  c?.condicion_pago === 'credito'

export const textoCondicionCredito = (dias: number) =>
  dias === 0 ? 'Crédito (pago a la entrega)' : `Crédito a ${dias} días`

/**
 * Vencimiento de una cuenta de cobro que aún no lo tiene: el plazo cuenta
 * desde la entrega (lo fija ordenes_fijar_vencimiento_cc al entregar).
 */
export const textoVenceTrasEntrega = (dias: number) =>
  dias === 0 ? 'Al entregar' : `${dias} días después de la entrega`

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'warning' | 'success' | 'outline'

/** El orden importa: es el de los filtros de la página de Cartera. */
export const ESTADO_CARTERA_CONFIG: Record<EstadoCartera, { label: string; variant: BadgeVariant }> = {
  vencida: { label: 'Vencida', variant: 'destructive' },
  pendiente: { label: 'Pendiente', variant: 'warning' },
  parcial: { label: 'Pago parcial', variant: 'default' },
  sin_emitir: { label: 'Sin cuenta de cobro', variant: 'secondary' },
  pagada: { label: 'Pagada', variant: 'success' },
}

/** Tramos de antigüedad de la cartera, por días de mora. */
export const tramoMora = (dias: number) =>
  dias <= 0 ? 'Al día' : dias <= 30 ? '1–30 días' : dias <= 60 ? '31–60 días' : 'Más de 60 días'
