import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { finDeDia } from '@/lib/utils'
import type { MetodoPago, VentaMostrador } from '@/types/database'

/** Una línea del carrito, tal como la espera el RPC. */
export type LineaVenta = {
  item_id: string
  cantidad: number
  precio_unitario: number
}

/**
 * Registra la venta completa en una sola llamada: cobro, líneas y descuento de
 * stock. Todo vive en el RPC `registrar_venta_mostrador` para que sea atómico y
 * para que la validación de stock no se pueda esquivar desde el navegador.
 */
export function useRegistrarVentaMostrador() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      clienteId,
      metodoPago,
      items,
    }: {
      clienteId: string | null
      metodoPago: MetodoPago
      items: LineaVenta[]
    }) => {
      const { data, error } = await supabase.rpc('registrar_venta_mostrador', {
        p_cliente_id: clienteId,
        p_metodo_pago: metodoPago,
        p_items: items,
      })
      if (error) throw error
      return data as unknown as VentaMostrador
    },
    onSuccess: () => {
      // El cobro entra en caja y el descuento toca inventario: hay que refrescar
      // los dos mundos.
      qc.invalidateQueries({ queryKey: ['caja-actual'] })
      qc.invalidateQueries({ queryKey: ['ventas-sesion'] })
      qc.invalidateQueries({ queryKey: ['ventas-periodo'] })
      qc.invalidateQueries({ queryKey: ['resumen-sesiones'] })
      qc.invalidateQueries({ queryKey: ['ventas-mostrador'] })
      qc.invalidateQueries({ queryKey: ['items'] })
      qc.invalidateQueries({ queryKey: ['movimientos'] })
    },
  })
}

export type VentaMostradorDetalle = VentaMostrador & {
  cliente: { nombre: string; apellido: string } | null
  items: { id: string; descripcion: string; cantidad: number; precio_unitario: number; precio_total: number }[]
}

/** Historial de ventas de mostrador de un rango de fechas. */
export function useVentasMostradorPeriodo(desde: string, hasta: string) {
  return useQuery({
    queryKey: ['ventas-mostrador', desde, hasta],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ventas_mostrador')
        .select('*, cliente:clientes(nombre, apellido), items:ventas_mostrador_items(*)')
        .gte('created_at', desde)
        .lt('created_at', finDeDia(hasta))
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as VentaMostradorDetalle[]
    },
    enabled: !!desde && !!hasta,
  })
}
