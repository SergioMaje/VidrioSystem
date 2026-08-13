import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { ItemInventario, MovimientoInventario, Proveedor, ProveedorCuentaPago } from '@/types/database'

export function useItems() {
  return useQuery({
    queryKey: ['items'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('items_inventario')
        .select('*, categoria:categorias(*), unidad_medida:unidades_medida(*), proveedor:proveedores(*)')
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

type ItemInput = Omit<ItemInventario, 'id' | 'created_at' | 'updated_at' | 'categoria' | 'unidad_medida' | 'proveedor'>

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

      const { error: updateError } = await supabase
        .from('items_inventario')
        .update({ stock_actual: posterior })
        .eq('id', input.item_id)
      if (updateError) throw updateError
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['items'] })
      qc.invalidateQueries({ queryKey: ['movimientos', variables.item_id] })
    },
  })
}
