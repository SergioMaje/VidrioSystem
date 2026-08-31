import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { PlantillaComponente, PlantillaProducto, TipoProducto } from '@/types/database'
import { altoNominal, anchoNominal, calcularMateriales, type Medidas } from '@/lib/produccion'

export function usePlantillas() {
  return useQuery({
    queryKey: ['plantillas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plantillas_producto')
        .select(
          '*, tipo_producto:tipos_producto(*), componentes:plantilla_componentes(*, item:items_inventario(*, categoria:categorias(*), unidad_medida:unidades_medida(*)))'
        )
        .eq('activa', true)
        .order('nombre')
      if (error) throw error
      return data as PlantillaProducto[]
    },
  })
}

export function useTiposProducto() {
  return useQuery({
    queryKey: ['tipos_producto'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tipos_producto')
        .select('*')
        .eq('activo', true)
      if (error) throw error
      return data as TipoProducto[]
    },
  })
}

export function useCalcularMateriales(plantillaId: string | null, medidas: Medidas) {
  const anchoCm = anchoNominal(medidas)
  const altoCm = altoNominal(medidas)

  return useQuery({
    queryKey: ['calcular_materiales', plantillaId, medidas],
    queryFn: async () => {
      if (!plantillaId || !anchoCm || !altoCm) return []
      const { data, error } = await supabase
        .from('plantilla_componentes')
        .select('*, item:items_inventario(*, unidad_medida:unidades_medida(*))')
        .eq('plantilla_id', plantillaId)
      if (error) throw error

      // La formula vive en lib/produccion: es la misma que usan el configurador y
      // las fichas de produccion, y no debe divergir de ellas.
      return calcularMateriales(data as PlantillaComponente[], medidas)
    },
    enabled: !!plantillaId && anchoCm > 0 && altoCm > 0,
  })
}

type PlantillaInput = {
  nombre: string
  descripcion?: string
  tipo_producto_id: string
  requiere_medidas: boolean
  componentes: {
    item_id: string
    formula: 'area' | 'perimetro' | 'ancho' | 'alto' | 'fijo'
    cantidad_fija?: number | null
    desperdicio_pct: number
    obligatorio: boolean
  }[]
}

export function useEliminarPlantilla() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('plantillas_producto').update({ activa: false }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plantillas'] }),
  })
}

export function useEditarPlantilla() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, input }: { id: string; input: PlantillaInput }) => {
      const { error } = await supabase
        .from('plantillas_producto')
        .update({
          nombre: input.nombre,
          descripcion: input.descripcion ?? null,
          tipo_producto_id: input.tipo_producto_id,
          requiere_medidas: input.requiere_medidas,
        })
        .eq('id', id)
      if (error) throw error

      await supabase.from('plantilla_componentes').delete().eq('plantilla_id', id)

      if (input.componentes.length > 0) {
        const { error: compError } = await supabase.from('plantilla_componentes').insert(
          input.componentes.map((c) => ({ ...c, plantilla_id: id }))
        )
        if (compError) throw compError
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plantillas'] }),
  })
}

export function useCrearPlantilla() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: PlantillaInput) => {
      const { data: plantilla, error } = await supabase
        .from('plantillas_producto')
        .insert({
          nombre: input.nombre,
          descripcion: input.descripcion ?? null,
          tipo_producto_id: input.tipo_producto_id,
          requiere_medidas: input.requiere_medidas,
          activa: true,
        })
        .select()
        .single()
      if (error) throw error

      if (input.componentes.length > 0) {
        const { error: compError } = await supabase.from('plantilla_componentes').insert(
          input.componentes.map((c) => ({ ...c, plantilla_id: plantilla.id }))
        )
        if (compError) throw compError
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plantillas'] }),
  })
}
