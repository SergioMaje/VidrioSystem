import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { TipoCategoriaEnvio } from '@/types/database'

const CLAVE = ['tipos_categoria_envio'] as const

/** El índice único de nombre por vidriería; se traduce a un mensaje claro. */
function errorDeTipo(error: { code?: string; message: string }): Error {
  if (error.code === '23505') return new Error('Ya existe un tipo con ese nombre')
  return new Error(error.message)
}

/**
 * Tipos de categoría propios de la vidriería, activos y archivados, por nombre.
 * Al armar un envío se ofrecen solo los activos.
 */
export function useTiposCategoria() {
  return useQuery({
    queryKey: CLAVE,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tipos_categoria_envio')
        .select('*')
        .order('nombre')
      if (error) throw error
      return data as TipoCategoriaEnvio[]
    },
    staleTime: 5 * 60_000,
  })
}

/** Crea un tipo propio. Cualquiera de la vidriería puede hacerlo desde la cotización. */
export function useCrearTipoCategoria() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { nombre: string; color: string }) => {
      const { data, error } = await supabase
        .from('tipos_categoria_envio')
        .insert({ nombre: input.nombre.trim(), color: input.color.toLowerCase() })
        .select()
        .single()
      if (error) throw errorDeTipo(error)
      return data as TipoCategoriaEnvio
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CLAVE }),
  })
}

/** Renombra, cambia el color o archiva/reactiva un tipo propio. Solo admin (RLS). */
export function useActualizarTipoCategoria() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...cambio }: { id: string } & Partial<Pick<TipoCategoriaEnvio, 'nombre' | 'color' | 'activo'>>) => {
      const fila = {
        ...cambio,
        ...(cambio.nombre !== undefined && { nombre: cambio.nombre.trim() }),
        ...(cambio.color !== undefined && { color: cambio.color.toLowerCase() }),
      }
      const { data, error } = await supabase
        .from('tipos_categoria_envio')
        .update(fila)
        .eq('id', id)
        .select()
      if (error) throw errorDeTipo(error)
      // Con RLS, un update sin permiso no falla: simplemente no toca filas.
      if (!data || data.length === 0) throw new Error('No tienes permiso para editar este tipo')
      return data[0] as TipoCategoriaEnvio
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLAVE })
      // Los envíos que lo usan muestran el nombre y el color nuevos.
      queryClient.invalidateQueries({ queryKey: ['categorias_envio'] })
      queryClient.invalidateQueries({ queryKey: ['eleccion_pedido'] })
    },
  })
}
