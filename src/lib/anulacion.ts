import { cajaVencida } from '@/lib/caja'
import { METODO_PAGO_LABEL } from '@/lib/pagos'
import { formatCOP, formatFecha } from '@/lib/utils'
import type { CashRegisterSession, TipoAnulacionCotizacion, Venta } from '@/types/database'

/** El mismo mínimo que exigen `anular_venta`, `anular_cotizacion` y el check de la tabla. */
export const MOTIVO_ANULACION_MIN = 10

export const TIPO_ANULACION_LABEL: Record<TipoAnulacionCotizacion, string> = {
  desistimiento: 'El cliente desistió',
  error: 'Error de registro',
}

/** Un efecto de la anulación, en palabras. `bloquea` impide confirmar. */
export type Efecto = { texto: string; bloquea?: boolean }

/** Lo que hace falta saber de las cajas para anunciar dónde cae un reverso. */
export type CajasDeCobro = {
  /** Caja donde entró el cobro. */
  cajaOriginal: Pick<CashRegisterSession, 'id' | 'status' | 'opened_at'> | null
  /** Caja abierta hoy, a donde iría el reverso si la original ya cerró. */
  cajaAbierta: Pick<CashRegisterSession, 'id' | 'opened_at'> | null
}

/**
 * Qué pasa en caja al anular un cobro. Es un espejo de las reglas de caja del
 * RPC `anular_venta`. La usan la anulación de un cobro y la de una cotización
 * completa, que por dentro anula cobro por cobro.
 */
export function efectoEnCaja(venta: Venta, cajas: CajasDeCobro): Efecto[] {
  const efectos: Efecto[] = []
  const monto = formatCOP(venta.monto)
  const metodo = METODO_PAGO_LABEL[venta.metodo_pago].toLowerCase()

  if (venta.metodo_pago === 'financiera') {
    if (venta.desembolso_id) {
      efectos.push({
        texto: 'La financiera ya desembolsó esta venta: la anulación requiere gestión manual con la financiera.',
        bloquea: true,
      })
    } else {
      efectos.push({
        texto: 'No hay egreso en caja: el dinero del crédito nunca entró. La venta sale de la cartera por desembolsar.',
      })
    }
  } else if (cajas.cajaOriginal?.status === 'open') {
    efectos.push({ texto: `Reverso de ${monto} en ${metodo} en la caja del cobro, que sigue abierta.` })
  } else if (!cajas.cajaAbierta) {
    efectos.push({
      texto: 'La caja de este cobro ya cerró y no hay una caja abierta. Abre la caja para registrar el reverso.',
      bloquea: true,
    })
  } else {
    efectos.push({
      texto: `La caja del cobro ya cerró (no se modifica). El reverso de ${monto} en ${metodo} va a la caja abierta de hoy.`,
    })
    if (cajaVencida(cajas.cajaAbierta.opened_at)) {
      efectos.push({
        texto: `La caja abierta es del ${formatFecha(cajas.cajaAbierta.opened_at)}: ciérrala y abre la de hoy primero.`,
        bloquea: true,
      })
    }
  }

  return efectos
}
