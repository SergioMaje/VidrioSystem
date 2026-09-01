import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { finDeDia } from '@/lib/utils'
import type { CategoriaGasto, MetodoPago, MovimientoCaja, MovimientoCajaConUsuario } from '@/types/database'

// Hay dos FK a `usuarios` (quién registró y quién anuló), así que PostgREST no
// puede resolver el embed sin el nombre de la constraint — mismo caso que
// useHistorialCaja con opened_by/closed_by.
const SELECT_CON_USUARIOS = `
  *,
  usuario:usuarios!caja_movimientos_usuario_id_fkey(nombre, apellido),
  anulado_por_usuario:usuarios!caja_movimientos_anulado_por_fkey(nombre, apellido)
`

/** Gastos del turno, incluidos los anulados: la UI los muestra tachados. */
export function useMovimientosSesion(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['gastos-sesion', sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('caja_movimientos')
        .select(SELECT_CON_USUARIOS)
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as MovimientoCajaConUsuario[]
    },
    enabled: !!sessionId,
  })
}

/** Gastos de un rango de fechas, para reportes. */
export function useMovimientosPeriodo(desde: string, hasta: string) {
  return useQuery({
    queryKey: ['gastos-periodo', desde, hasta],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('caja_movimientos')
        .select(SELECT_CON_USUARIOS)
        .gte('created_at', desde)
        .lt('created_at', finDeDia(hasta))
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as MovimientoCajaConUsuario[]
    },
    enabled: !!desde && !!hasta,
  })
}

/**
 * Las dos mutaciones invalidan lo mismo porque mueven la misma cifra: el gasto
 * cambia el efectivo esperado del turno. Se invalida en `onSettled` y no en
 * `onSuccess` porque un fallo de red después del commit también movió la caja
 * (mismo criterio que useRegistrarAnticipo).
 */
function invalidarGastos(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['gastos-sesion'] })
  qc.invalidateQueries({ queryKey: ['gastos-periodo'] })
  qc.invalidateQueries({ queryKey: ['resumen-sesiones'] })
  qc.invalidateQueries({ queryKey: ['caja-actual'] })
}

/**
 * La sesión no se manda: el RPC resuelve la caja abierta y valida que el cajón
 * alcance. Registrar un gasto es cosa de cualquier usuario autenticado.
 */
export function useRegistrarGasto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      categoria,
      concepto,
      monto,
      metodoPago,
    }: {
      categoria: CategoriaGasto
      concepto: string
      monto: number
      metodoPago: MetodoPago
    }) => {
      const { data, error } = await supabase.rpc('registrar_gasto_caja', {
        p_categoria: categoria,
        p_concepto: concepto,
        p_monto: monto,
        p_metodo_pago: metodoPago,
      })
      if (error) throw error
      return data as unknown as MovimientoCaja
    },
    onSettled: () => invalidarGastos(qc),
  })
}

/** Anular es soft-delete y solo para admin; la garantía real está en el RPC. */
export function useAnularGasto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ movimientoId, motivo }: { movimientoId: string; motivo: string }) => {
      const { data, error } = await supabase.rpc('anular_movimiento_caja', {
        p_movimiento_id: movimientoId,
        p_motivo: motivo,
      })
      if (error) throw error
      return data as unknown as MovimientoCaja
    },
    onSettled: () => invalidarGastos(qc),
  })
}
