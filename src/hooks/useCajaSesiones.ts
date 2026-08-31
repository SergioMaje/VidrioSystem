import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { CashRegisterSession, Usuario } from '@/types/database'

export type SesionCajaHistorial = CashRegisterSession & {
  abierta_por: Pick<Usuario, 'nombre' | 'apellido'> | null
  cerrada_por: Pick<Usuario, 'nombre' | 'apellido'> | null
}

export function useCajaActual() {
  return useQuery({
    queryKey: ['caja-actual'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cash_register_sessions')
        .select('*')
        .eq('status', 'open')
        .maybeSingle()
      if (error) throw error
      return data as CashRegisterSession | null
    },
  })
}

export function useAbrirCaja() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ opening_amount, opened_by }: { opening_amount: number; opened_by: string }) => {
      const { data, error } = await supabase
        .from('cash_register_sessions')
        .insert({ opening_amount, opened_by, status: 'open' })
        .select()
        .single()
      if (error) {
        if (error.code === '23505') throw new Error('Ya hay una caja abierta')
        throw error
      }
      return data as CashRegisterSession
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['caja-actual'] }),
  })
}

export function useCerrarCaja() {
  const qc = useQueryClient()
  return useMutation({
    /**
     * El arqueo lo calcula Postgres (`cerrar_caja`), no el navegador: es la cifra
     * de control de la caja y el cliente no debe poder dictarla. El RPC también
     * resuelve `closed_by` desde `auth.uid()`.
     */
    mutationFn: async ({ sessionId, counted_amount }: { sessionId: string; counted_amount: number }) => {
      const { data, error } = await supabase.rpc('cerrar_caja', {
        p_session_id: sessionId,
        p_counted_amount: counted_amount,
      })
      if (error) throw error
      return data as unknown as CashRegisterSession
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['caja-actual'] })
      qc.invalidateQueries({ queryKey: ['historial-caja'] })
      qc.invalidateQueries({ queryKey: ['resumen-sesiones'] })
    },
  })
}

export function useHistorialCaja() {
  return useQuery({
    queryKey: ['historial-caja'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cash_register_sessions')
        .select(`
          *,
          abierta_por:usuarios!cash_register_sessions_opened_by_fkey(nombre, apellido),
          cerrada_por:usuarios!cash_register_sessions_closed_by_fkey(nombre, apellido)
        `)
        .eq('status', 'closed')
        .order('closed_at', { ascending: false })
      if (error) throw error
      return data as SesionCajaHistorial[]
    },
  })
}

export type ResumenSesion = {
  session_id: string
  total_efectivo: number
  total_transferencia: number
  total_tarjeta: number
  total_cobrado: number
  num_pagos: number
  /** Gastos vivos del turno; solo los de efectivo bajan el arqueo. */
  total_gastos_efectivo: number
  total_gastos: number
  num_gastos: number
  /** Lo que debería quedar en el cajón: fondo + ventas en efectivo − gastos. */
  neto_efectivo: number
}

/**
 * Movimiento completo de cada turno (no solo efectivo). Supabase no infiere la
 * relación con una vista sin FK, así que el cruce con el historial se hace en
 * memoria — mismo patrón que `useSaldos` en useVentasCaja.ts.
 */
export function useResumenSesiones() {
  return useQuery({
    queryKey: ['resumen-sesiones'],
    queryFn: async () => {
      const { data, error } = await supabase.from('caja_sesiones_resumen').select('*')
      if (error) throw error
      const porSesion = new Map<string, ResumenSesion>()
      for (const fila of (data ?? []) as ResumenSesion[]) porSesion.set(fila.session_id, fila)
      return porSesion
    },
  })
}
