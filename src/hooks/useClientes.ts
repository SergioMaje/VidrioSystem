import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Cliente } from '@/types/database'

export function useClientes() {
  return useQuery({
    queryKey: ['clientes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clientes')
        .select('*')
        .eq('activo', true)
        .order('nombre')
      if (error) throw error
      return data as Cliente[]
    },
  })
}

export function useCliente(id: string) {
  return useQuery({
    queryKey: ['cliente', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clientes')
        .select('*')
        .eq('id', id)
        .single()
      if (error) throw error
      return data as Cliente
    },
    enabled: !!id,
  })
}

type ClienteInput = Omit<Cliente, 'id' | 'created_at' | 'updated_at'>

export function useCrearCliente() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: ClienteInput) => {
      // Se devuelve la fila creada: quien viene de una cotización necesita su id
      // para dejarlo seleccionado al volver.
      const { data: creado, error } = await supabase.from('clientes').insert(data).select().single()
      if (error) throw error
      return creado as Cliente
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clientes'] }),
  })
}

export function useEditarCliente() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ClienteInput> }) => {
      const { error } = await supabase.from('clientes').update(data).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['clientes'] })
      // La ficha del cliente (`useCliente`) usa su propia clave.
      qc.invalidateQueries({ queryKey: ['cliente', id] })
    },
  })
}

export function useEliminarCliente() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('clientes').update({ activo: false }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clientes'] }),
  })
}
