import type { TipoPago } from '@/types/database'

/** El cliente debe entregar al menos este porcentaje del total como anticipo. */
export const ANTICIPO_MIN_PCT = 0.5

/** Margen en pesos para absorber el redondeo del IVA al comparar montos. */
export const TOLERANCIA = 1

export const anticipoMinimo = (total: number) => Math.round(total * ANTICIPO_MIN_PCT)

export const cumpleAnticipoMinimo = (monto: number, total: number) =>
  monto + TOLERANCIA >= anticipoMinimo(total)

export const estaLiquidada = (saldo: number) => saldo <= TOLERANCIA

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
}
