import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { OrdenMaterial, OrigenMaterial, SugerenciaMaterial } from '@/types/database'
import type { MaterialRequeridoInput } from '@/lib/materiales'

// Dos FK a items_inventario (el material usado y el que pidió el BOM), así que
// PostgREST necesita el nombre de la constraint para resolver cada embed —
// mismo caso que useMovimientosCaja con usuario/anulado_por.
const SELECT_MATERIALES = `
  *,
  item:items_inventario!orden_materiales_item_id_fkey(*, unidad_medida:unidades_medida(*)),
  item_requerido:items_inventario!orden_materiales_item_requerido_id_fkey(*),
  proveedor:proveedores(*)
`

export function useOrdenMateriales(ordenId: string | undefined) {
  return useQuery({
    queryKey: ['orden_materiales', ordenId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orden_materiales')
        .select(SELECT_MATERIALES)
        .eq('orden_id', ordenId)
        .order('created_at')
      if (error) throw error
      return data as unknown as OrdenMaterial[]
    },
    enabled: !!ordenId,
  })
}

export function useSugerenciasMaterial(itemId: string | undefined, cantidad: number | undefined) {
  return useQuery({
    queryKey: ['sugerencias_material', itemId, String(cantidad)],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('sugerir_materiales', {
        p_item_id: itemId,
        p_cantidad: cantidad,
      })
      if (error) throw error
      return data as SugerenciaMaterial[]
    },
    enabled: !!itemId && !!cantidad,
  })
}

export function useRegistrarMaterialesOrden() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ordenId, materiales }: { ordenId: string; materiales: MaterialRequeridoInput[] }) => {
      const { data, error } = await supabase.rpc('registrar_materiales_orden', {
        p_orden_id: ordenId,
        p_materiales: materiales,
      })
      if (error) throw error
      return data as number
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['orden_materiales', variables.ordenId] })
    },
  })
}

interface AsignarMaterialInput {
  materialId: string
  itemId: string
  origen: OrigenMaterial
  cantidad: number
  proveedorId?: string
  notas?: string
}

export function useAsignarMaterial() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: AsignarMaterialInput) => {
      const { data, error } = await supabase.rpc('asignar_material_orden', {
        p_material_id: input.materialId,
        p_item_id: input.itemId,
        p_origen: input.origen,
        p_cantidad: input.cantidad,
        p_proveedor_id: input.proveedorId ?? null,
        p_notas: input.notas ?? null,
      })
      if (error) throw error
      return data as OrdenMaterial
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['orden_materiales', data.orden_id] })
    },
  })
}

interface CapturarCostoInput {
  materialId: string
  ordenId: string
  costoUnitario: number
  proveedorId?: string
}

export function useCapturarCostoMaterial() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CapturarCostoInput) => {
      const { data, error } = await supabase.rpc('capturar_costo_material', {
        p_material_id: input.materialId,
        p_costo_unitario: input.costoUnitario,
        p_proveedor_id: input.proveedorId ?? null,
      })
      if (error) throw error
      return data as OrdenMaterial
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['orden_materiales', variables.ordenId] })
    },
  })
}

/**
 * Reemplaza el bucle de OrdenDetalle: descuenta stock normal/desperdicio,
 * registra la compra y el costo de lo sobre pedido, y pasa la orden a lista.
 * Se invalida en onSettled porque, si la red se cae después del commit, el
 * stock ya se movió y la vista tiene que reflejarlo igual.
 */
export function useCerrarProduccion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ordenId: string) => {
      const { data, error } = await supabase.rpc('cerrar_produccion_orden', { p_orden_id: ordenId })
      if (error) throw error
      return data as number
    },
    onSettled: (_data, _err, ordenId) => {
      qc.invalidateQueries({ queryKey: ['orden', ordenId] })
      qc.invalidateQueries({ queryKey: ['ordenes'] })
      qc.invalidateQueries({ queryKey: ['orden_materiales', ordenId] })
      qc.invalidateQueries({ queryKey: ['items'] })
      qc.invalidateQueries({ queryKey: ['movimientos'] })
      qc.invalidateQueries({ queryKey: ['dashboard_pipeline'] })
      qc.invalidateQueries({ queryKey: ['dashboard_entregas'] })
      qc.invalidateQueries({ queryKey: ['dashboard_stock_bajo'] })
      qc.invalidateQueries({ queryKey: ['dashboard_total_items'] })
    },
  })
}
