import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { CuentaPagoEmpresa } from '@/types/database'

const KEY = ['cuentas_pago_empresa']

/**
 * @param soloActivas para imprimir en la cotizacion; la pantalla de configuracion las
 * quiere todas, incluidas las retiradas.
 */
export function useCuentasPagoEmpresa(soloActivas = false) {
  return useQuery({
    queryKey: [...KEY, { soloActivas }],
    queryFn: async () => {
      let query = supabase.from('cuentas_pago_empresa').select('*')
      if (soloActivas) query = query.eq('activo', true)
      const { data, error } = await query.order('orden').order('created_at')
      if (error) throw error
      return data as CuentaPagoEmpresa[]
    },
  })
}

type CuentaPagoEmpresaInput = Omit<CuentaPagoEmpresa, 'id' | 'created_at' | 'updated_at'>

export function useCrearCuentaPagoEmpresa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: CuentaPagoEmpresaInput) => {
      const { error } = await supabase.from('cuentas_pago_empresa').insert(data)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useEditarCuentaPagoEmpresa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CuentaPagoEmpresaInput> }) => {
      const { error } = await supabase.from('cuentas_pago_empresa').update(data).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export function useEliminarCuentaPagoEmpresa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cuentas_pago_empresa').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}
