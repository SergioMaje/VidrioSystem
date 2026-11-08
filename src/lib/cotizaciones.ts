import type { Cotizacion, CotizacionItem } from '@/types/database'

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'warning' | 'success' | 'outline'

export const ESTADOS_COTIZACION_CONFIG: Record<Cotizacion['estado'], { label: string; variant: BadgeVariant }> = {
  borrador: { label: 'Borrador', variant: 'secondary' },
  enviada: { label: 'Enviada', variant: 'default' },
  aprobada: { label: 'Aprobada', variant: 'success' },
  rechazada: { label: 'Rechazada', variant: 'destructive' },
  vencida: { label: 'Vencida', variant: 'warning' },
  vendida: { label: 'Vendida', variant: 'outline' },
  anulada: { label: 'Anulada', variant: 'destructive' },
  // El cliente eligió otra opción del mismo envío. No es un rechazo.
  descartada: { label: 'Descartada', variant: 'outline' },
}

/** Letras de las opciones de un envío: A, B, C… (el check de la base admite A–Z). */
export const MAX_OPCIONES = 26

export const etiquetaDeIndice = (idx: number) => String.fromCharCode(65 + idx)

/** La letra que sigue a las ya usadas en el envío. */
export function siguienteEtiqueta(usadas: (string | null)[]): string {
  const usadasSet = new Set(usadas)
  for (let i = 0; i < MAX_OPCIONES; i++) {
    if (!usadasSet.has(etiquetaDeIndice(i))) return etiquetaDeIndice(i)
  }
  throw new Error(`Un envío admite máximo ${MAX_OPCIONES} opciones`)
}

/** "Opción B · Templado 5 mm", o "Opción B" si no tiene nombre. Null si es suelta. */
export function textoOpcion(cot: Pick<Cotizacion, 'opcion_etiqueta' | 'opcion_nombre'>): string | null {
  if (!cot.opcion_etiqueta) return null
  return cot.opcion_nombre ? `Opción ${cot.opcion_etiqueta} · ${cot.opcion_nombre}` : `Opción ${cot.opcion_etiqueta}`
}

/**
 * Subtotal, descuento, IVA y total de una cotización. Es la fórmula que se
 * guarda en `cotizaciones.total`: el formulario, la creación y la edición
 * deben calcular igual.
 */
export function calcularTotales(
  items: Pick<CotizacionItem, 'precio_total'>[],
  descuentoPct: number,
  ivaPct: number
) {
  const subtotal = items.reduce((s, i) => s + i.precio_total, 0)
  const descuento = subtotal * (descuentoPct / 100)
  const base = subtotal - descuento
  const iva = base * (ivaPct / 100)
  return { subtotal, descuento, iva, total: base + iva }
}
