import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Cotizacion, Venta } from '@/types/database'

export type VentaConCotizacion = Venta & {
  cotizacion: { numero: string; cliente: { nombre: string; apellido: string } | null } | null
}

export function useVentasSesion(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['ventas-sesion', sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ventas')
        .select('*, cotizacion:cotizaciones(numero, cliente:clientes(nombre, apellido))')
        .eq('session_id', sessionId as string)
        .order('created_at')
      if (error) throw error
      return data as VentaConCotizacion[]
    },
    enabled: !!sessionId,
  })
}

export type VentaReporte = Venta & {
  cotizacion: { numero: string; cliente: { nombre: string; apellido: string } | null } | null
  usuario: { nombre: string; apellido: string } | null
}

/** Ventas de un rango de fechas, sin importar el turno de caja: base del reporte de ingresos. */
export function useVentasPeriodo(desde: string, hasta: string) {
  return useQuery({
    queryKey: ['ventas-periodo', desde, hasta],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ventas')
        .select(
          '*, cotizacion:cotizaciones(numero, cliente:clientes(nombre, apellido)), usuario:usuarios(nombre, apellido)'
        )
        .gte('created_at', desde)
        .lte('created_at', hasta + 'T23:59:59')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as VentaReporte[]
    },
    enabled: !!desde && !!hasta,
  })
}

/**
 * Cliente aprueba la cotización = se vende: en un solo paso se registra el cobro
 * dentro de la sesión de caja abierta, la cotización pasa directo a 'vendida'
 * (sin estado 'aprobada' intermedio) y se crea la orden de producción.
 */
export function useVenderCotizacion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      cotizacion,
      sessionId,
      metodoPago,
      usuarioId,
      fechaEntregaEstimada,
    }: {
      cotizacion: Cotizacion
      sessionId: string | undefined
      metodoPago: Venta['metodo_pago']
      usuarioId: string
      fechaEntregaEstimada?: string
    }) => {
      if (!sessionId) throw new Error('Debes abrir caja antes de vender')

      const { error: ventaError } = await supabase.from('ventas').insert({
        cotizacion_id: cotizacion.id,
        session_id: sessionId,
        metodo_pago: metodoPago,
        monto: cotizacion.total,
        usuario_id: usuarioId,
      })
      if (ventaError) throw ventaError

      const { error: cotizacionError } = await supabase
        .from('cotizaciones')
        .update({ estado: 'vendida' })
        .eq('id', cotizacion.id)
      if (cotizacionError) throw cotizacionError

      const numero = `OT-${Date.now()}`
      const { error: ordenError } = await supabase.from('ordenes_trabajo').insert({
        numero,
        cotizacion_id: cotizacion.id,
        cliente_id: cotizacion.cliente_id,
        estado: 'pendiente',
        fecha_entrega_estimada: fechaEntregaEstimada || null,
        notas: cotizacion.notas ?? null,
      })
      if (ordenError) throw ordenError
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['caja-actual'] })
      qc.invalidateQueries({ queryKey: ['ventas-sesion', variables.sessionId] })
      qc.invalidateQueries({ queryKey: ['ventas-periodo'] })
      qc.invalidateQueries({ queryKey: ['cotizaciones'] })
      qc.invalidateQueries({ queryKey: ['cotizacion', variables.cotizacion.id] })
      qc.invalidateQueries({ queryKey: ['ordenes'] })
    },
  })
}
