import type { BadgeProps } from '@/components/ui/badge'
import type { ClaseInventario, ItemInventario, OrigenMaterial, CotizacionItem, PlantillaComponente } from '@/types/database'
import { calcularMateriales, medidasDeItem } from '@/lib/produccion'
import { calcularOpciones, esComponenteDeVidrio } from '@/lib/opciones'

export const CLASE_INVENTARIO_LABELS: Record<ClaseInventario, string> = {
  stock_normal: 'Stock',
  desperdicio: 'Recorte',
  sobre_pedido: 'Sobre pedido',
}

export const CLASE_INVENTARIO_VARIANTS: Record<ClaseInventario, NonNullable<BadgeProps['variant']>> = {
  stock_normal: 'secondary',
  desperdicio: 'warning',
  sobre_pedido: 'outline',
}

export const ORIGEN_MATERIAL_LABELS: Record<OrigenMaterial, string> = {
  desperdicio: 'Recorte',
  stock_normal: 'Stock',
  sobre_pedido: 'Sobre pedido',
}

export function esRecorte(item: Pick<ItemInventario, 'clase_inventario'>): boolean {
  return item.clase_inventario === 'desperdicio'
}

/**
 * Medida física del item: en un recorte es la del retal, en una lámina la medida
 * estándar con que se compra. Null cuando el item no se maneja por pieza.
 */
export function medidasFisicas(item: Pick<ItemInventario, 'ancho_cm' | 'alto_cm'>): string | null {
  if (item.ancho_cm == null || item.alto_cm == null) return null
  return `${item.ancho_cm} × ${item.alto_cm} cm`
}

/**
 * Área de una pieza en m² a partir de sus centímetros. Es la misma conversión que
 * aplica registrar_recorte en la base (ancho * alto / 10000); se replica aquí solo
 * para previsualizar en el formulario, nunca para decidir lo que se guarda.
 */
export function m2DeMedidas(anchoCm: number, altoCm: number): number | null {
  if (!(anchoCm > 0) || !(altoCm > 0)) return null
  return (anchoCm * altoCm) / 10000
}

/**
 * El vidrio se almacena y se cobra por m² (precio_costo se multiplica por la
 * cantidad en la unidad del item), pero quien compra razona por lámina. Estas dos
 * funciones traducen entre ambas vistas del mismo precio; la unidad almacenada
 * sigue siendo el m².
 */
export function precioPorM2(precioPorPieza: number, m2PorPieza: number): number | null {
  if (!(m2PorPieza > 0)) return null
  return precioPorPieza / m2PorPieza
}

export function precioPorPieza(precioM2: number, m2PorPieza: number): number | null {
  if (!(m2PorPieza > 0)) return null
  return precioM2 * m2PorPieza
}

/**
 * Componentes estructurales de la plantilla. Si el ítem guardó un vidrio como opción,
 * el componente de vidrio del BOM se excluye para no contarlo dos veces (los ítems
 * cotizados antes de las opciones adicionales lo conservan).
 */
export function componentesEstructurales(item: CotizacionItem): PlantillaComponente[] {
  const tieneVidrioElegido = (item.opciones ?? []).some((o) => o.rol === 'vidrio')
  return (item.plantilla?.componentes ?? []).filter(
    (c) => !(tieneVidrioElegido && esComponenteDeVidrio(c))
  )
}

export interface MaterialRequeridoInput {
  item_requerido_id: string
  cantidad_requerida: number
}

/**
 * Suma el BOM de todas las líneas de la cotización, agregado por item: dos
 * ventanas iguales son una sola línea de material con la cantidad acumulada.
 */
export function materialesDeOrden(items: CotizacionItem[]): MaterialRequeridoInput[] {
  const acumulado = new Map<string, number>()

  for (const item of items) {
    if (!item.ancho_cm || !item.alto_cm) continue
    const medidas = medidasDeItem(item)

    const consumos = [
      ...calcularMateriales(componentesEstructurales(item), medidas, item.cantidad).map((m) => ({
        item_id: m.item_id,
        cantidad: m.cantidad_calculada,
      })),
      ...calcularOpciones(item.opciones, medidas, item.cantidad).map((o) => ({
        item_id: o.opcion.item_id,
        cantidad: o.cantidad_calculada,
      })),
    ]

    for (const consumo of consumos) {
      if (consumo.cantidad <= 0) continue
      acumulado.set(consumo.item_id, (acumulado.get(consumo.item_id) ?? 0) + consumo.cantidad)
    }
  }

  return Array.from(acumulado.entries()).map(([item_requerido_id, cantidad_requerida]) => ({
    item_requerido_id,
    cantidad_requerida,
  }))
}
