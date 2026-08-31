import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { ReferenciaProducto, FormulaCorte } from '@/types/database'

export function useReferencias() {
  return useQuery({
    queryKey: ['referencias'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('referencias_producto')
        .select(`
          *,
          tipo_producto:tipos_producto(*),
          plantilla:plantillas_producto(*),
          cortes:referencia_cortes(*)
        `)
        .eq('activa', true)
        .order('nombre')
      if (error) throw error
      return (data as ReferenciaProducto[]).map((r) => ({
        ...r,
        cortes: r.cortes?.sort((a, b) => a.orden - b.orden) ?? [],
      }))
    },
  })
}

export type ReferenciaCorteInput = {
  nombre_pieza: string
  formula: FormulaCorte
  margen_cm: number
  cantidad_fija_cm?: number
  cantidad_piezas: number
  orden: number
}

export type ReferenciaInput = {
  nombre: string
  descripcion?: string
  tipo_producto_id: string
  plantilla_id: string
  es_corrediza: boolean
  cortes: ReferenciaCorteInput[]
}

export function useCrearReferencia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: ReferenciaInput) => {
      const { data: referencia, error } = await supabase
        .from('referencias_producto')
        .insert({
          nombre: input.nombre,
          descripcion: input.descripcion ?? null,
          tipo_producto_id: input.tipo_producto_id,
          plantilla_id: input.plantilla_id,
          es_corrediza: input.es_corrediza,
          activa: true,
        })
        .select()
        .single()
      if (error) throw error

      if (input.cortes.length > 0) {
        const { error: cortesError } = await supabase
          .from('referencia_cortes')
          .insert(
            input.cortes.map((c) => ({
              referencia_id: referencia.id,
              nombre_pieza: c.nombre_pieza,
              formula: c.formula,
              margen_cm: c.margen_cm,
              cantidad_fija_cm: c.formula === 'fijo' ? (c.cantidad_fija_cm ?? 0) : null,
              cantidad_piezas: c.cantidad_piezas,
              orden: c.orden,
            }))
          )
        if (cortesError) throw cortesError
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['referencias'] }),
  })
}

export function useEditarReferencia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: ReferenciaInput }) => {
      const { error } = await supabase
        .from('referencias_producto')
        .update({
          nombre: input.nombre,
          descripcion: input.descripcion ?? null,
          tipo_producto_id: input.tipo_producto_id,
          plantilla_id: input.plantilla_id,
          es_corrediza: input.es_corrediza,
        })
        .eq('id', id)
      if (error) throw error

      await supabase.from('referencia_cortes').delete().eq('referencia_id', id)

      if (input.cortes.length > 0) {
        const { error: cortesError } = await supabase
          .from('referencia_cortes')
          .insert(
            input.cortes.map((c) => ({
              referencia_id: id,
              nombre_pieza: c.nombre_pieza,
              formula: c.formula,
              margen_cm: c.margen_cm,
              cantidad_fija_cm: c.formula === 'fijo' ? (c.cantidad_fija_cm ?? 0) : null,
              cantidad_piezas: c.cantidad_piezas,
              orden: c.orden,
            }))
          )
        if (cortesError) throw cortesError
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['referencias'] }),
  })
}

export function useEliminarReferencia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('referencias_producto')
        .update({ activa: false })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['referencias'] }),
  })
}

/**
 * Cuántos ítems ya cotizados usan esta referencia.
 *
 * Importa porque OrdenDetalle calcula el despiece con un join vivo a
 * referencia_cortes, y useEditarReferencia los borra y reinserta: editar los cortes
 * de una referencia ya usada cambia retroactivamente las medidas de corte de esas
 * órdenes. Con este dato el diálogo avisa antes de que ocurra.
 */
export function useUsosReferencia(referenciaId?: string) {
  return useQuery({
    queryKey: ['usos_referencia', referenciaId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('cotizacion_items')
        .select('id', { count: 'exact', head: true })
        .eq('referencia_id', referenciaId!)
      if (error) throw error
      return count ?? 0
    },
    enabled: !!referenciaId,
  })
}

export interface ItemLibreAgrupado {
  descripcion: string
  veces: number
  monto_total: number
}

/**
 * Ítems cotizados a mano, agrupados por descripción.
 *
 * Es el backlog priorizado de referencias por crear: lo que más se cotiza sin
 * plantilla es lo que más urge modelar. La lista se vacía sola a medida que el
 * catálogo crece. Se agrupa en cliente porque durante la fase de carga el volumen
 * de cotizacion_items es de cientos de filas, no de millones.
 */
export function useItemsLibres() {
  return useQuery({
    queryKey: ['items_libres'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cotizacion_items')
        .select('descripcion, precio_total')
        .is('referencia_id', null)
      if (error) throw error

      const porDescripcion = new Map<string, ItemLibreAgrupado>()
      for (const item of data as { descripcion: string; precio_total: number }[]) {
        const clave = item.descripcion.trim()
        const acumulado = porDescripcion.get(clave)
        if (acumulado) {
          acumulado.veces += 1
          acumulado.monto_total += item.precio_total
        } else {
          porDescripcion.set(clave, { descripcion: clave, veces: 1, monto_total: item.precio_total })
        }
      }
      return [...porDescripcion.values()].sort(
        (a, b) => b.veces - a.veces || b.monto_total - a.monto_total
      )
    },
  })
}
