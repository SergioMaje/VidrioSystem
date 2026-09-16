import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { Financiera, FinancieraDesembolso, Usuario, VentaPorDesembolsar } from '@/types/database'

const KEY = ['financieras']

/**
 * @param soloActivas para vender con ellas; Configuración y los reportes las
 * quieren todas, incluidas las retiradas que aún tienen ventas pendientes.
 */
export function useFinancieras(soloActivas = false) {
  return useQuery({
    queryKey: [...KEY, { soloActivas }],
    queryFn: async () => {
      let query = supabase.from('financieras').select('*')
      if (soloActivas) query = query.eq('activa', true)
      const { data, error } = await query.order('nombre')
      if (error) throw error
      return data as Financiera[]
    },
  })
}

type FinancieraInput = Pick<Financiera, 'nombre' | 'comision_pct' | 'dias_desembolso' | 'activa'>

/** Crear o editar. La escritura es solo de admin: la garantía está en RLS. */
export function useGuardarFinanciera() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }: { id?: string; data: FinancieraInput }) => {
      const { error } = id
        ? await supabase.from('financieras').update(data).eq('id', id)
        : await supabase.from('financieras').insert(data)
      if (error) {
        if (error.code === '23505') throw new Error('Ya existe una financiera con ese nombre')
        throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY })
      // El plazo cambia qué ventas pendientes salen como vencidas.
      qc.invalidateQueries({ queryKey: ['ventas-por-desembolsar'] })
    },
  })
}

/** Ventas a crédito que la financiera aún no ha pagado, de la más vieja a la más nueva. */
export function useVentasPorDesembolsar() {
  return useQuery({
    queryKey: ['ventas-por-desembolsar'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('financieras_por_cobrar')
        .select('*')
        .order('created_at')
      if (error) throw error
      return data as VentaPorDesembolsar[]
    },
  })
}

export type DesembolsoConDetalle = FinancieraDesembolso & {
  financiera: { nombre: string } | null
  cuenta: { alias: string | null; banco: string } | null
  usuario: Pick<Usuario, 'nombre' | 'apellido'> | null
}

/** Desembolsos por fecha de llegada al banco, incluidos los anulados. */
export function useDesembolsos(desde: string, hasta: string) {
  return useQuery({
    queryKey: ['desembolsos', desde, hasta],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('financiera_desembolsos')
        .select(
          // Dos FK a `usuarios` (usuario_id y anulado_por): el hint es obligatorio.
          '*, financiera:financieras(nombre), cuenta:cuentas_pago_empresa(alias, banco), usuario:usuarios!financiera_desembolsos_usuario_id_fkey(nombre, apellido)'
        )
        // `fecha` es date, no timestamp: el rango se compara tal cual, sin finDeDia.
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as DesembolsoConDetalle[]
    },
    enabled: !!desde && !!hasta,
  })
}

function invalidarDesembolsos(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['ventas-por-desembolsar'] })
  qc.invalidateQueries({ queryKey: ['desembolsos'] })
  qc.invalidateQueries({ queryKey: ['ventas-periodo'] })
}

/**
 * Anota lo que llegó al banco y lo enlaza con las ventas que cubre. El RPC
 * valida que todas sean de esa financiera y sigan pendientes, en una transacción.
 */
export function useRegistrarDesembolso() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      financieraId: string
      fecha: string
      montoRecibido: number
      ventaIds: string[]
      cuentaId: string | null
      referencia: string
      notas: string
    }) => {
      if (input.ventaIds.length === 0) throw new Error('Selecciona las ventas que cubre este desembolso')
      if (input.montoRecibido <= 0) throw new Error('El monto recibido debe ser mayor a cero')

      const { data, error } = await supabase.rpc('registrar_desembolso_financiera', {
        p_financiera_id: input.financieraId,
        p_fecha: input.fecha,
        p_monto_recibido: input.montoRecibido,
        p_venta_ids: input.ventaIds,
        p_cuenta_id: input.cuentaId,
        p_referencia: input.referencia.trim() || null,
        p_notas: input.notas.trim() || null,
      })
      if (error) throw error
      return data as unknown as FinancieraDesembolso
    },
    onSettled: () => invalidarDesembolsos(qc),
  })
}

/** Solo admin: las ventas vuelven a pendientes y el desembolso queda tachado. */
export function useAnularDesembolso() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ desembolsoId, motivo }: { desembolsoId: string; motivo: string }) => {
      const { error } = await supabase.rpc('anular_desembolso_financiera', {
        p_desembolso_id: desembolsoId,
        p_motivo: motivo,
      })
      if (error) throw error
    },
    onSettled: () => invalidarDesembolsos(qc),
  })
}
