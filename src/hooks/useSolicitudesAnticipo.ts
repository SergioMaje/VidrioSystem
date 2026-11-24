import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { SolicitudAnticipoDetalle } from '@/types/database'

// Dos FK a `usuarios` (solicitado_por y resuelto_por): sin el hint PostgREST
// responde 300 (PGRST201).
const SELECT_DETALLE =
  '*, solicitante:usuarios!solicitudes_anticipo_solicitado_por_fkey(nombre, apellido), resolutor:usuarios!solicitudes_anticipo_resuelto_por_fkey(nombre, apellido), cotizacion:cotizaciones(numero)'

// Mientras se espera una respuesta, se vuelve a preguntar solo: el vendedor y
// el admin suelen estar en equipos distintos.
const REFRESCO_MS = 15_000

/**
 * La solicitud que importa para cobrar: la viva (pendiente o aprobada) o, si no
 * hay, la última rechazada para mostrar su motivo. Usadas y canceladas no.
 */
export function useSolicitudAnticipo(cotizacionId: string | undefined, activo = true) {
  return useQuery({
    queryKey: ['solicitud-anticipo', cotizacionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('solicitudes_anticipo')
        .select(SELECT_DETALLE)
        .eq('cotizacion_id', cotizacionId!)
        .in('estado', ['pendiente', 'aprobada', 'rechazada'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data as unknown as SolicitudAnticipoDetalle | null
    },
    enabled: !!cotizacionId && activo,
    refetchInterval: (query) => (query.state.data?.estado === 'pendiente' ? REFRESCO_MS : false),
  })
}

/** Pendientes de toda la vidriería, para el aviso del admin. */
export function useSolicitudesPendientes() {
  const { usuario } = useAuth()
  return useQuery({
    queryKey: ['solicitudes-anticipo-pendientes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('solicitudes_anticipo')
        .select(SELECT_DETALLE)
        .eq('estado', 'pendiente')
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as SolicitudAnticipoDetalle[]
    },
    enabled: usuario?.rol === 'admin',
    refetchInterval: REFRESCO_MS * 2,
  })
}

function invalidar(qc: ReturnType<typeof useQueryClient>, cotizacionId: string) {
  qc.invalidateQueries({ queryKey: ['solicitud-anticipo', cotizacionId] })
  qc.invalidateQueries({ queryKey: ['solicitudes-anticipo-pendientes'] })
}

export function useSolicitarAutorizacion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ cotizacionId, monto, motivo }: { cotizacionId: string; monto: number; motivo: string }) => {
      const { error } = await supabase.rpc('solicitar_autorizacion_anticipo', {
        p_cotizacion_id: cotizacionId,
        p_monto: monto,
        p_motivo: motivo.trim(),
      })
      if (error) throw error
    },
    onSettled: (_d, _e, v) => invalidar(qc, v.cotizacionId),
  })
}

export function useResolverSolicitud() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      solicitudId,
      aprobar,
      motivoRechazo,
    }: {
      solicitudId: string
      cotizacionId: string
      aprobar: boolean
      motivoRechazo?: string
    }) => {
      const { error } = await supabase.rpc('resolver_solicitud_anticipo', {
        p_solicitud_id: solicitudId,
        p_aprobar: aprobar,
        p_motivo_rechazo: aprobar ? null : motivoRechazo?.trim() || null,
      })
      if (error) throw error
    },
    onSettled: (_d, _e, v) => invalidar(qc, v.cotizacionId),
  })
}
