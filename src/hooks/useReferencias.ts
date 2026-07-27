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
