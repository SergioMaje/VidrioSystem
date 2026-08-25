import type { MetodoPago, TipoPago } from '@/types/database'

/** El cliente debe entregar al menos este porcentaje del total como anticipo. */
export const ANTICIPO_MIN_PCT = 0.5

/** Margen en pesos para absorber el redondeo del IVA al comparar montos. */
export const TOLERANCIA = 1

export const anticipoMinimo = (total: number) => Math.round(total * ANTICIPO_MIN_PCT)

export const cumpleAnticipoMinimo = (monto: number, total: number) =>
  monto + TOLERANCIA >= anticipoMinimo(total)

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
}

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
