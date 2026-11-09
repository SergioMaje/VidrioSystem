import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Cotizacion, CotizacionSaldo, OrdenTrabajo, VentaMostrador } from '@/types/database'

/*
 * Historial de un cliente para su ficha. Las consultas no usan el staleTime
 * global (5 min): la ficha se abre justo después de cobrar o entregar, y debe
 * mostrar ese cambio sin esperar.
 */

export function useCotizacionesDeCliente(clienteId: string) {
  return useQuery({
    queryKey: ['cliente', clienteId, 'cotizaciones'],
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cotizaciones')
        .select('*')
        .eq('cliente_id', clienteId)
        // Por la fecha que se muestra; created_at desempata dentro del mismo día.
        .order('fecha_emision', { ascending: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Cotizacion[]
    },
    enabled: !!clienteId,
  })
}

/** Saldos de un grupo de cotizaciones. La vista no tiene FK, así que se cruza en memoria. */
export function useSaldosDeCotizaciones(cotizacionIds: string[]) {
  return useQuery({
    queryKey: ['saldos', 'por-ids', cotizacionIds],
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cotizaciones_saldo')
        .select('*')
        .in('cotizacion_id', cotizacionIds)
      if (error) throw error
      const porCotizacion = new Map<string, CotizacionSaldo>()
      for (const fila of (data ?? []) as CotizacionSaldo[]) {
        porCotizacion.set(fila.cotizacion_id, fila)
      }
      return porCotizacion
    },
    enabled: cotizacionIds.length > 0,
  })
}

export type OrdenDeCliente = OrdenTrabajo & { cotizacion: { numero: string } | null }

export function useOrdenesDeCliente(clienteId: string) {
  return useQuery({
    queryKey: ['cliente', clienteId, 'ordenes'],
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ordenes_trabajo')
        .select('*, cotizacion:cotizaciones(numero)')
        .eq('cliente_id', clienteId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as OrdenDeCliente[]
    },
    enabled: !!clienteId,
  })
}

export function useVentasMostradorDeCliente(clienteId: string) {
  return useQuery({
    queryKey: ['cliente', clienteId, 'ventas-mostrador'],
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ventas_mostrador')
        .select('*')
        .eq('cliente_id', clienteId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as VentaMostrador[]
    },
    enabled: !!clienteId,
  })
}
