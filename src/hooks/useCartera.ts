import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { CuentaCobro, FilaCartera, OrdenTrabajo } from '@/types/database'

/**
 * Ventas a crédito vivas (vista `cartera`), con su cuenta de cobro vigente y el
 * estado derivado del saldo. Las más vencidas primero.
 */
export function useCartera(clienteId?: string) {
  return useQuery({
    queryKey: ['cartera', clienteId ?? 'todas'],
    queryFn: async () => {
      let q = supabase.from('cartera').select('*')
      if (clienteId) q = q.eq('cliente_id', clienteId)
      const { data, error } = await q
        .order('dias_mora', { ascending: false })
        .order('fecha_vencimiento', { ascending: true, nullsFirst: false })
      if (error) throw error
      return (data ?? []) as FilaCartera[]
    },
  })
}

/** La cuenta de cobro vigente de una cotización, o null si no tiene. */
export function useCuentaCobroVigente(cotizacionId: string | null | undefined) {
  return useQuery({
    queryKey: ['cuenta-cobro', cotizacionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cuentas_cobro')
        .select('*')
        .eq('cotizacion_id', cotizacionId!)
        .is('anulado_at', null)
        .maybeSingle()
      if (error) throw error
      return data as CuentaCobro | null
    },
    enabled: !!cotizacionId,
  })
}

function invalidarCredito(qc: ReturnType<typeof useQueryClient>, cotizacionId: string) {
  qc.invalidateQueries({ queryKey: ['cartera'] })
  qc.invalidateQueries({ queryKey: ['cuenta-cobro', cotizacionId] })
  qc.invalidateQueries({ queryKey: ['cotizacion', cotizacionId] })
  qc.invalidateQueries({ queryKey: ['cotizaciones'] })
  qc.invalidateQueries({ queryKey: ['orden_de_cotizacion', cotizacionId] })
  qc.invalidateQueries({ queryKey: ['orden'] })
  qc.invalidateQueries({ queryKey: ['ordenes'] })
  qc.invalidateQueries({ queryKey: ['dashboard_pipeline'] })
  qc.invalidateQueries({ queryKey: ['dashboard_entregas'] })
  qc.invalidateQueries({ queryKey: ['cliente'] })
}

/**
 * Venta a crédito: la cotización queda vendida y con su orden, sin cobro y sin
 * caja. Solo admin y con el crédito habilitado en el cliente; la garantía está
 * en el RPC `aprobar_cotizacion_credito`.
 */
export function useAprobarCredito() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      cotizacionId,
      fechaEntrega,
      ordenCompra,
    }: {
      cotizacionId: string
      fechaEntrega: string | null
      ordenCompra: string | null
    }) => {
      const { data, error } = await supabase.rpc('aprobar_cotizacion_credito', {
        p_cotizacion_id: cotizacionId,
        p_fecha_entrega: fechaEntrega,
        p_orden_compra: ordenCompra,
      })
      if (error) throw error
      return data as unknown as OrdenTrabajo
    },
    onSettled: (_data, _err, { cotizacionId }) => {
      invalidarCredito(qc, cotizacionId)
      qc.invalidateQueries({ queryKey: ['opciones_grupo'] })
    },
  })
}

/** Emite la cuenta de cobro por el saldo de hoy (antes de entregar, si la piden). */
export function useEmitirCuentaCobro() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (cotizacionId: string) => {
      const { data, error } = await supabase.rpc('emitir_cuenta_cobro', { p_cotizacion_id: cotizacionId })
      if (error) throw error
      return data as unknown as CuentaCobro
    },
    onSettled: (_data, _err, cotizacionId) => invalidarCredito(qc, cotizacionId),
  })
}

/**
 * Entrega una orden a crédito: emite la cuenta de cobro si queda saldo y aún no
 * existe, y marca la orden entregada, en una sola transacción. Devuelve la
 * cuenta de cobro, o null si ya estaba pagada.
 */
export function useEntregarOrdenCredito() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ordenId }: { ordenId: string; cotizacionId: string }) => {
      const { data, error } = await supabase.rpc('entregar_orden_credito', { p_orden_id: ordenId })
      if (error) throw error
      // Un tipo compuesto nulo llega como una fila con todos los campos en null.
      const cc = data as unknown as CuentaCobro | null
      return cc?.id ? cc : null
    },
    onSettled: (_data, _err, { cotizacionId }) => invalidarCredito(qc, cotizacionId),
  })
}

/** Anula la cuenta de cobro vigente para emitir otra. Solo admin. */
export function useAnularCuentaCobro() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ cuentaId, motivo }: { cuentaId: string; motivo: string; cotizacionId: string }) => {
      const { error } = await supabase.rpc('anular_cuenta_cobro', { p_cuenta_id: cuentaId, p_motivo: motivo })
      if (error) throw error
    },
    onSettled: (_data, _err, { cotizacionId }) => invalidarCredito(qc, cotizacionId),
  })
}
