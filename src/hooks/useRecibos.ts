import { supabase } from '@/lib/supabase'
import type { Cliente, Cotizacion, OrdenTrabajo, Venta, VentaMostrador, VentaMostradorItem } from '@/types/database'

type Persona = { nombre: string; apellido: string }

/** Todo lo que imprime un recibo de pago. */
export interface DatosRecibo {
  venta: Venta & {
    usuario: Persona | null
    anulado_por_usuario: Persona | null
    financiera: { nombre: string } | null
  }
  /** Cobro de una cotización: el trabajo y cómo iba el saldo al momento del recibo. */
  cotizacion: {
    datos: Pick<Cotizacion, 'id' | 'numero' | 'total' | 'opcion_etiqueta' | 'opcion_nombre'> & { cliente: Cliente | null }
    orden: Pick<OrdenTrabajo, 'numero' | 'fecha_entrega_estimada'> | null
    /** Lo cobrado antes de este recibo, sin lo que ya estaba anulado en ese momento. */
    pagosAnteriores: number
  } | null
  /** Cobro de una venta de mostrador: los productos vendidos. */
  mostrador: (Pick<VentaMostrador, 'id' | 'numero' | 'total'> & {
    cliente: Cliente | null
    items: Pick<VentaMostradorItem, 'descripcion' | 'cantidad' | 'precio_total'>[]
  }) | null
}

/**
 * Reúne los datos del recibo de un cobro. Es una función y no un hook porque se
 * llama al hacer clic en "Imprimir recibo", no al pintar la pantalla.
 *
 * Las cifras se calculan al momento del cobro, no a hoy: reimprimir un recibo
 * viejo da siempre el mismo saldo.
 */
export async function obtenerDatosRecibo(ventaId: string): Promise<DatosRecibo> {
  const { data: venta, error } = await supabase
    .from('ventas')
    // El hint de FK es obligatorio: ventas tiene dos FK a usuarios.
    .select(
      '*, usuario:usuarios!ventas_usuario_id_fkey(nombre, apellido), anulado_por_usuario:usuarios!ventas_anulado_por_fkey(nombre, apellido), financiera:financieras(nombre)'
    )
    .eq('id', ventaId)
    .single()
  if (error) throw error
  const v = venta as unknown as DatosRecibo['venta']

  if (v.cotizacion_id) {
    const [cot, orden, previos] = await Promise.all([
      supabase
        .from('cotizaciones')
        .select('id, numero, total, opcion_etiqueta, opcion_nombre, cliente:clientes(*)')
        .eq('id', v.cotizacion_id)
        .single(),
      // La orden viva; si solo hay una cancelada, esa.
      supabase
        .from('ordenes_trabajo')
        .select('numero, fecha_entrega_estimada, estado, created_at')
        .eq('cotizacion_id', v.cotizacion_id)
        .order('created_at', { ascending: false }),
      supabase
        .from('ventas')
        .select('monto, anulado_at')
        .eq('cotizacion_id', v.cotizacion_id)
        .lt('created_at', v.created_at),
    ])
    if (cot.error) throw cot.error
    if (orden.error) throw orden.error
    if (previos.error) throw previos.error

    const ordenes = (orden.data ?? []) as (Pick<OrdenTrabajo, 'numero' | 'fecha_entrega_estimada' | 'estado'>)[]
    const ordenViva = ordenes.find((o) => o.estado !== 'cancelada') ?? ordenes[0] ?? null
    // Un cobro anulado antes de este recibo ya no contaba en ese momento.
    const momento = new Date(v.created_at).getTime()
    const pagosAnteriores = (previos.data as { monto: number; anulado_at: string | null }[])
      .filter((p) => !p.anulado_at || new Date(p.anulado_at).getTime() > momento)
      .reduce((s, p) => s + p.monto, 0)

    return {
      venta: v,
      cotizacion: {
        datos: cot.data as unknown as NonNullable<DatosRecibo['cotizacion']>['datos'],
        orden: ordenViva ? { numero: ordenViva.numero, fecha_entrega_estimada: ordenViva.fecha_entrega_estimada } : null,
        pagosAnteriores,
      },
      mostrador: null,
    }
  }

  if (v.venta_mostrador_id) {
    const { data: vm, error: vmError } = await supabase
      .from('ventas_mostrador')
      .select('id, numero, total, cliente:clientes(*), items:ventas_mostrador_items(descripcion, cantidad, precio_total)')
      .eq('id', v.venta_mostrador_id)
      .single()
    if (vmError) throw vmError
    return { venta: v, cotizacion: null, mostrador: vm as unknown as NonNullable<DatosRecibo['mostrador']> }
  }

  return { venta: v, cotizacion: null, mostrador: null }
}

/** El cobro que acaba de entrar con esta clave de idempotencia (la RPC del anticipo devuelve la orden, no el cobro). */
export async function cobroPorClave(idempotencyKey: string) {
  const { data, error } = await supabase
    .from('ventas')
    .select('id, numero_recibo')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  if (error) throw error
  return data as Pick<Venta, 'id' | 'numero_recibo'> | null
}

/** El cobro de una venta de mostrador. */
export async function cobroDeVentaMostrador(ventaMostradorId: string) {
  const { data, error } = await supabase
    .from('ventas')
    .select('id, numero_recibo')
    .eq('venta_mostrador_id', ventaMostradorId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as Pick<Venta, 'id' | 'numero_recibo'> | null
}
