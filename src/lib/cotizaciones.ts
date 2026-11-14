import type { Cotizacion, CotizacionItem, EnvioCategoria } from '@/types/database'

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

/**
 * "Opción B · Templado 5 mm", o "Opción B" si no tiene nombre. Null si es suelta.
 * Con categoría: "Puerta principal · Opción B · Templado 5 mm".
 */
export function textoOpcion(
  cot: Pick<Cotizacion, 'opcion_etiqueta' | 'opcion_nombre'>,
  categoria?: Pick<EnvioCategoria, 'nombre'> | null,
): string | null {
  if (!cot.opcion_etiqueta) return null
  const base = cot.opcion_nombre ? `Opción ${cot.opcion_etiqueta} · ${cot.opcion_nombre}` : `Opción ${cot.opcion_etiqueta}`
  return categoria ? `${categoria.nombre} · ${base}` : base
}

/**
 * Número del envío sin el sufijo de la opción: COT-00018-B y COT-00018-2B →
 * COT-00018. Sirve igual con el formato anterior (COT-1794…-B → COT-1794…).
 */
export const numeroBaseEnvio = (numero: string) => numero.replace(/-[0-9]*[A-Z]$/, '')

/**
 * El consecutivo que busca el usuario: "18", "cot18", "COT-00018" o "COT-00018-B"
 * → 18. Null si lo escrito no es un número de cotización.
 */
export function consecutivoBuscado(texto: string): number | null {
  const m = texto.trim().toLowerCase().match(/^(?:cot)?[-\s]*0*(\d{1,12})(?:-\d*[a-z])?$/)
  if (!m) return null
  const n = Number(m[1])
  return n > 0 ? n : null
}

/** Código corto de una opción con categoría: la B de la segunda categoría es "2B". */
export const codigoOpcion = (orden: number, etiqueta: string) => `${orden + 1}${etiqueta}`

export type TipoCategoria = EnvioCategoria['tipo']

/**
 * Nombre y colores de cada tipo de categoría. Los colores son suaves para que
 * el documento se imprima bien; el texto siempre va en negro.
 */
export const TIPO_CATEGORIA_CONFIG: Record<TipoCategoria, { label: string; color: string; fondo: string }> = {
  puerta: { label: 'Puerta', color: '#b45309', fondo: '#fef3c7' },
  ventana: { label: 'Ventana', color: '#1d4ed8', fondo: '#dbeafe' },
  division: { label: 'División', color: '#0f766e', fondo: '#ccfbf1' },
  espejo: { label: 'Espejo', color: '#475569', fondo: '#e2e8f0' },
  otro: { label: 'Otro', color: '#6d28d9', fondo: '#ede9fe' },
}

export const TIPOS_CATEGORIA = Object.keys(TIPO_CATEGORIA_CONFIG) as TipoCategoria[]

/**
 * Lo que puede costar un envío por categorías si el cliente toma todas las
 * partes: la suma de la opción más barata de cada una y la de la más cara.
 */
export function rangoTotales(totalesPorCategoria: number[][]) {
  const conOpciones = totalesPorCategoria.filter((t) => t.length > 0)
  return {
    min: conOpciones.reduce((s, t) => s + Math.min(...t), 0),
    max: conOpciones.reduce((s, t) => s + Math.max(...t), 0),
  }
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
