import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { TOLERANCIA } from '@/lib/pagos'
import { formatCOP } from '@/lib/utils'
import type { Cotizacion, CotizacionItem } from '@/types/database'

/**
 * Marca como 'vencida' toda cotización en borrador/enviada cuya fecha_vencimiento
 * ya pasó. No hay cron en este proyecto, así que se ejecuta de forma oportunista
 * cada vez que se listan o abren cotizaciones — es idempotente y barata (el WHERE
 * no encuentra filas la mayoría de las veces).
 */
export async function expirarCotizacionesVencidas() {
  const hoy = new Date().toISOString().split('T')[0]
  await supabase
    .from('cotizaciones')
    .update({ estado: 'vencida' })
    .in('estado', ['borrador', 'enviada'])
    .lt('fecha_vencimiento', hoy)
}

export function useCotizaciones() {
  return useQuery({
    queryKey: ['cotizaciones'],
    queryFn: async () => {
      await expirarCotizacionesVencidas()
      const { data, error } = await supabase
        .from('cotizaciones')
        .select('*, cliente:clientes(*)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Cotizacion[]
    },
  })
}

export function useCotizacion(id: string) {
  return useQuery({
    queryKey: ['cotizacion', id],
    queryFn: async () => {
      await expirarCotizacionesVencidas()
      const { data, error } = await supabase
        .from('cotizaciones')
        .select('*, cliente:clientes(*), items:cotizacion_items(*)')
        .eq('id', id)
        .single()
      if (error) throw error
      return data as Cotizacion & { items: CotizacionItem[] }
    },
    enabled: !!id,
  })
}

type CotizacionInput = {
  cliente_id: string
  usuario_id: string
  estado?: 'borrador' | 'enviada'
  fecha_vencimiento?: string
  descuento_pct: number
  iva_pct: number
  notas?: string
  items: Omit<CotizacionItem, 'id' | 'cotizacion_id'>[]
}

export function useCrearCotizacion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CotizacionInput) => {
      const subtotal = input.items.reduce((s, i) => s + i.precio_total, 0)
      const descuento = subtotal * (input.descuento_pct / 100)
      const base = subtotal - descuento
      const iva = base * (input.iva_pct / 100)
      const total = base + iva

      const numero = `COT-${Date.now()}`

      const { data: cot, error } = await supabase
        .from('cotizaciones')
        .insert({
          numero,
          cliente_id: input.cliente_id,
          usuario_id: input.usuario_id,
          estado: input.estado ?? 'borrador',
          fecha_emision: new Date().toISOString().split('T')[0],
          fecha_vencimiento: input.fecha_vencimiento ?? null,
          subtotal,
          descuento_pct: input.descuento_pct,
          iva_pct: input.iva_pct,
          total,
          notas: input.notas ?? null,
        })
        .select()
        .single()
      if (error) throw error

      if (input.items.length > 0) {
        const { error: itemsError } = await supabase.from('cotizacion_items').insert(
          input.items.map((item) => ({ ...item, cotizacion_id: cot.id }))
        )
        if (itemsError) throw itemsError
      }
      return cot
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cotizaciones'] }),
  })
}

type CotizacionUpdateInput = {
  id: string
  cliente_id: string
  estado: Cotizacion['estado']
  fecha_vencimiento?: string
  descuento_pct: number
  iva_pct: number
  notas?: string
  items: Omit<CotizacionItem, 'id' | 'cotizacion_id'>[]
}

export function useActualizarCotizacion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CotizacionUpdateInput) => {
      const subtotal = input.items.reduce((s, i) => s + i.precio_total, 0)
      const descuento = subtotal * (input.descuento_pct / 100)
      const base = subtotal - descuento
      const iva = base * (input.iva_pct / 100)
      const total = base + iva

      // Editar recalcula el total desde los ítems, sin mirar lo ya cobrado: se
      // podía dejar una cotización con un total por debajo de sus abonos, y a
      // partir de ahí el saldo salía negativo y la vista de morosos mentía.
      const { data: saldoActual, error: saldoError } = await supabase
        .from('cotizaciones_saldo')
        .select('total_abonado')
        .eq('cotizacion_id', input.id)
        .single()
      if (saldoError) throw saldoError

      const abonado = (saldoActual as { total_abonado: number }).total_abonado
      if (abonado > 0 && total + TOLERANCIA < abonado) {
        throw new Error(
          `El nuevo total (${formatCOP(total)}) es menor que lo ya cobrado (${formatCOP(abonado)}). ` +
            'Devuelve la diferencia antes de reducir la cotización.'
        )
      }

      const { error } = await supabase
        .from('cotizaciones')
        .update({
          cliente_id: input.cliente_id,
          estado: input.estado,
          fecha_vencimiento: input.fecha_vencimiento ?? null,
          subtotal,
          descuento_pct: input.descuento_pct,
          iva_pct: input.iva_pct,
          total,
          notas: input.notas ?? null,
        })
        .eq('id', input.id)
      if (error) throw error

      const { error: deleteError } = await supabase
        .from('cotizacion_items')
        .delete()
        .eq('cotizacion_id', input.id)
      if (deleteError) throw deleteError

      if (input.items.length > 0) {
        const { error: itemsError } = await supabase.from('cotizacion_items').insert(
          input.items.map((item) => ({ ...item, cotizacion_id: input.id }))
        )
        if (itemsError) throw itemsError
      }
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['cotizaciones'] })
      qc.invalidateQueries({ queryKey: ['cotizacion', variables.id] })
    },
  })
}

export function useCambiarEstadoCotizacion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, estado }: { id: string; estado: Cotizacion['estado'] }) => {
      const { error } = await supabase.from('cotizaciones').update({ estado }).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['cotizaciones'] })
      qc.invalidateQueries({ queryKey: ['cotizacion', variables.id] })
    },
  })
}
