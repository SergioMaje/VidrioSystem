import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { ItemInventario, MovimientoInventario, Proveedor, ProveedorCuentaPago } from '@/types/database'

export function useItems() {
  return useQuery({
    queryKey: ['items'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('items_inventario')
        // El origen del recorte se embebe por el nombre de la COLUMNA FK, no por el
        // de la constraint: en una relación auto-referencial PostgREST resuelve el
        // nombre de tabla hacia los hijos (una lista de recortes) y solo la columna
        // apunta al padre, que es lo que aquí interesa.
        .select(
          '*, categoria:categorias(*), unidad_medida:unidades_medida(*), proveedor:proveedores(*), ' +
          'item_origen:item_origen_id(*)'
        )
        .eq('activo', true)
        .order('nombre')
      if (error) throw error
      return data as ItemInventario[]
    },
  })
}

export function useItem(id: string) {
  return useQuery({
    queryKey: ['item', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('items_inventario')
        .select('*, categoria:categorias(*), unidad_medida:unidades_medida(*), proveedor:proveedores(*)')
        .eq('id', id)
        .single()
      if (error) throw error
      return data as ItemInventario
    },
    enabled: !!id,
  })
}

export function useMovimientos(itemId: string) {
  return useQuery({
    queryKey: ['movimientos', itemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('movimientos_inventario')
        .select('*')
        .eq('item_id', itemId)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data as MovimientoInventario[]
    },
    enabled: !!itemId,
  })
}

export function useCategorias() {
  return useQuery({
    queryKey: ['categorias'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categorias')
        .select('*')
        .eq('activa', true)
        .order('nombre')
      if (error) throw error
      return data
    },
  })
}

export function useUnidadesMedida() {
  return useQuery({
    queryKey: ['unidades_medida'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('unidades_medida')
        .select('*')
        .order('nombre')
      if (error) throw error
      return data
    },
  })
}

export function useProveedores() {
  return useQuery({
    queryKey: ['proveedores'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('proveedores')
        .select('*')
        .eq('activo', true)
        .order('nombre')
      if (error) throw error
      return data
    },
  })
}

export function useProveedor(id: string) {
  return useQuery({
    queryKey: ['proveedor', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('proveedores')
        .select('*')
        .eq('id', id)
        .single()
      if (error) throw error
      return data as Proveedor
    },
    enabled: !!id,
  })
}

export function useItemsPorProveedor(proveedorId: string) {
  return useQuery({
    queryKey: ['items', 'proveedor', proveedorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('items_inventario')
        .select('*')
        .eq('proveedor_id', proveedorId)
        .eq('activo', true)
        .order('nombre')
      if (error) throw error
      return data as ItemInventario[]
    },
    enabled: !!proveedorId,
  })
}

type ProveedorInput = Omit<Proveedor, 'id' | 'created_at' | 'updated_at'>

export function useCrearProveedor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: ProveedorInput) => {
      const { error } = await supabase.from('proveedores').insert(data)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proveedores'] }),
  })
}

export function useEditarProveedor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ProveedorInput> }) => {
      const { error } = await supabase.from('proveedores').update(data).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proveedores'] }),
  })
}

export function useEliminarProveedor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('proveedores').update({ activo: false }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proveedores'] }),
  })
}

export function useCuentasPago(proveedorId: string) {
  return useQuery({
    queryKey: ['cuentas_pago', proveedorId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('proveedor_cuentas_pago')
        .select('*')
        .eq('proveedor_id', proveedorId)
        .order('created_at')
      if (error) throw error
      return data as ProveedorCuentaPago[]
    },
    enabled: !!proveedorId,
  })
}

type CuentaPagoInput = Omit<ProveedorCuentaPago, 'id' | 'created_at' | 'updated_at'>

export function useCrearCuentaPago() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: CuentaPagoInput) => {
      const { error } = await supabase.from('proveedor_cuentas_pago').insert(data)
      if (error) throw error
    },
    onSuccess: (_data, variables) => qc.invalidateQueries({ queryKey: ['cuentas_pago', variables.proveedor_id] }),
  })
}

export function useEditarCuentaPago() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CuentaPagoInput> }) => {
      const { error } = await supabase.from('proveedor_cuentas_pago').update(data).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_data, variables) => {
      if (variables.data.proveedor_id) qc.invalidateQueries({ queryKey: ['cuentas_pago', variables.data.proveedor_id] })
      else qc.invalidateQueries({ queryKey: ['cuentas_pago'] })
    },
  })
}

export function useEliminarCuentaPago() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id }: { id: string; proveedorId: string }) => {
      const { error } = await supabase.from('proveedor_cuentas_pago').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: (_data, variables) => qc.invalidateQueries({ queryKey: ['cuentas_pago', variables.proveedorId] }),
  })
}

type ItemInput = Omit<
  ItemInventario,
  | 'id'
  | 'created_at'
  | 'updated_at'
  | 'categoria'
  | 'unidad_medida'
  | 'proveedor'
  | 'item_origen'
  | 'clase_inventario'
  | 'item_origen_id'
  | 'ancho_cm'
  | 'alto_cm'
> &
  Partial<Pick<ItemInventario, 'clase_inventario' | 'item_origen_id' | 'ancho_cm' | 'alto_cm'>>

export function useCrearItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: ItemInput) => {
      const { error } = await supabase.from('items_inventario').insert(data)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['items'] }),
  })
}

export function useCrearItemsMasivo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: ItemInput[]) => {
      const { error } = await supabase.from('items_inventario').insert(data)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['items'] }),
  })
}

export function useEditarItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ItemInput> }) => {
      const { error } = await supabase.from('items_inventario').update(data).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['items'] }),
  })
}

export function useEliminarItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('items_inventario').update({ activo: false }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['items'] }),
  })
}

interface MovimientoInput {
  item_id: string
  tipo: 'entrada' | 'salida' | 'ajuste' | 'produccion'
  cantidad: number
  motivo?: string
  referencia?: string
  usuario_id: string
}

export interface EntradaMasivaInput {
  item_id: string
  cantidad: number
  motivo?: string | null
}

export function useRegistrarMovimiento() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: MovimientoInput) => {
      const { data: item, error: itemError } = await supabase
        .from('items_inventario')
        .select('stock_actual')
        .eq('id', input.item_id)
        .single()
      if (itemError || !item) throw new Error('Item no encontrado')

      const anterior = item.stock_actual
      let posterior = anterior
      if (input.tipo === 'entrada') posterior = anterior + input.cantidad
      else if (input.tipo === 'salida' || input.tipo === 'produccion') posterior = anterior - input.cantidad
      else posterior = input.cantidad

      // Sólo se inserta el movimiento: stock_actual lo pone trg_actualizar_stock a
      // partir de cantidad_posterior. Escribirlo también desde aquí era una
      // segunda escritura del mismo dato que podía quedar fuera de sincronía si
      // el UPDATE fallaba después del INSERT.
      const { error: movError } = await supabase.from('movimientos_inventario').insert({
        item_id: input.item_id,
        tipo: input.tipo,
        cantidad: input.cantidad,
        cantidad_anterior: anterior,
        cantidad_posterior: posterior,
        motivo: input.motivo ?? null,
        referencia: input.referencia ?? null,
        usuario_id: input.usuario_id,
      })
      if (movError) throw movError
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['items'] })
      qc.invalidateQueries({ queryKey: ['movimientos', variables.item_id] })
    },
  })
}

/**
 * Carga masiva de stock: el equivalente de useRegistrarMovimiento para muchas
 * filas a la vez, con tipo 'entrada'. Va por RPC y no por N inserts porque una
 * carga a medias deja el inventario en un estado que nadie puede reconstruir;
 * dentro de la función entra todo o no entra nada. El usuario lo resuelve el
 * servidor con auth.uid(), así que aquí no se manda.
 */
export function useRegistrarEntradasMasivas() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ entradas, referencia }: { entradas: EntradaMasivaInput[]; referencia?: string }) => {
      const { data, error } = await supabase.rpc('registrar_entradas_inventario', {
        p_entradas: entradas,
        p_referencia: referencia ?? null,
      })
      if (error) throw error
      return data as number
    },
    // Se invalida en onSettled: si la red se cae después del commit el stock ya
    // se movió, y la tabla tiene que reflejarlo igual.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['items'] })
      qc.invalidateQueries({ queryKey: ['movimientos'] })
    },
  })
}

interface RegistrarRecorteInput {
  itemOrigenId: string
  anchoCm: number
  altoCm: number
  cantidad?: number
  referencia?: string
  notas?: string
}

/**
 * Registra un recorte como item hijo del origen. No descuenta el origen: ese
 * material ya se dio de baja en el movimiento de producción que dejó el retal.
 */
export function useRegistrarRecorte() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: RegistrarRecorteInput) => {
      const { data, error } = await supabase.rpc('registrar_recorte', {
        p_item_origen_id: input.itemOrigenId,
        p_ancho_cm: input.anchoCm,
        p_alto_cm: input.altoCm,
        p_cantidad: input.cantidad ?? null,
        p_referencia: input.referencia ?? null,
        p_notas: input.notas ?? null,
      })
      if (error) throw error
      return data as ItemInventario
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['items'] })
      qc.invalidateQueries({ queryKey: ['movimientos'] })
    },
  })
}
