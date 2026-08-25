import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { anticipoMinimo, cumpleAnticipoMinimo, estaLiquidada, excedeSaldo, tipoDePago } from '@/lib/pagos'
import { finDeDia, formatCOP } from '@/lib/utils'
import type { Cotizacion, CotizacionSaldo, Usuario, Venta } from '@/types/database'

/** Origen de un pago: una cotización o una venta de mostrador, nunca las dos. */
type Origen = { numero: string; cliente: { nombre: string; apellido: string } | null } | null

export type VentaConCotizacion = Venta & {
  cotizacion: Origen
  venta_mostrador: Origen
}

export function useVentasSesion(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['ventas-sesion', sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ventas')
        .select(
          '*, cotizacion:cotizaciones(numero, cliente:clientes(nombre, apellido)), venta_mostrador:ventas_mostrador(numero, cliente:clientes(nombre, apellido))'
        )
        .eq('session_id', sessionId as string)
        .order('created_at')
      if (error) throw error
      return data as unknown as VentaConCotizacion[]
    },
    enabled: !!sessionId,
  })
}

export type VentaReporte = Venta & {
  cotizacion: Origen
  venta_mostrador: Origen
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
          // `ventas` tiene dos FK a `usuarios` (usuario_id y autorizado_por): sin el
          // hint explícito PostgREST no sabe cuál usar y responde 300 (PGRST201).
          '*, cotizacion:cotizaciones(numero, cliente:clientes(nombre, apellido)), venta_mostrador:ventas_mostrador(numero, cliente:clientes(nombre, apellido)), usuario:usuarios!ventas_usuario_id_fkey(nombre, apellido)'
        )
        .gte('created_at', desde)
        .lt('created_at', finDeDia(hasta))
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as VentaReporte[]
    },
    enabled: !!desde && !!hasta,
  })
}

export type PagoConUsuario = Venta & {
  usuario: Pick<Usuario, 'nombre' | 'apellido'> | null
}

/** Saldo de una cotización, derivado en la vista `cotizaciones_saldo`. */
export function useSaldoCotizacion(cotizacionId: string | null | undefined) {
  return useQuery({
    queryKey: ['saldo-cotizacion', cotizacionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cotizaciones_saldo')
        .select('*')
        .eq('cotizacion_id', cotizacionId as string)
        .maybeSingle()
      if (error) throw error
      return data as CotizacionSaldo | null
    },
    enabled: !!cotizacionId,
  })
}

/** Historial de pagos de una cotización: anticipo y abonos posteriores. */
export function usePagosCotizacion(cotizacionId: string | null | undefined) {
  return useQuery({
    queryKey: ['pagos-cotizacion', cotizacionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ventas')
        // Mismo motivo que en useVentasPeriodo: el hint de FK es obligatorio.
        .select('*, usuario:usuarios!ventas_usuario_id_fkey(nombre, apellido)')
        .eq('cotizacion_id', cotizacionId as string)
        .order('created_at')
      if (error) throw error
      return data as unknown as PagoConUsuario[]
    },
    enabled: !!cotizacionId,
  })
}

/**
 * Todos los saldos de una sola consulta, para mezclarlos en el listado de
 * cotizaciones. Supabase no infiere la relación con una vista sin FK, así que
 * el cruce se hace en memoria (el volumen es pequeño).
 */
export function useSaldos() {
  return useQuery({
    queryKey: ['saldos'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cotizaciones_saldo').select('*')
      if (error) throw error
      const porCotizacion = new Map<string, CotizacionSaldo>()
      for (const fila of (data ?? []) as CotizacionSaldo[]) {
        porCotizacion.set(fila.cotizacion_id, fila)
      }
      return porCotizacion
    },
  })
}

/** Una cotización vendida que aún debe plata, con el cliente ya resuelto. */
export type CotizacionMorosa = {
  cotizacion_id: string
  numero: string
  cliente: string
  fecha_emision: string
  total: number
  total_abonado: number
  saldo: number
  pct_abonado: number
}

type CotizacionVendida = Pick<Cotizacion, 'id' | 'numero' | 'fecha_emision'> & {
  cliente: { nombre: string; apellido: string } | null
}

/**
 * Cartera pendiente: cotizaciones ya vendidas (anticipo cobrado) cuyo saldo
 * sigue abierto. Se devuelve la lista completa ordenada por saldo; recortarla
 * es decisión de quien la pinta.
 */
export function useCotizacionesMorosas() {
  return useQuery({
    queryKey: ['cotizaciones-morosas'],
    queryFn: async (): Promise<CotizacionMorosa[]> => {
      // `cotizaciones_saldo` es una vista sin FK: PostgREST no puede embeber el
      // cliente desde ahí, así que se traen las dos partes y se cruzan aquí.
      const [{ data: cotizaciones, error: cotError }, { data: saldos, error: saldoError }] =
        await Promise.all([
          supabase
            .from('cotizaciones')
            .select('id, numero, fecha_emision, cliente:clientes(nombre, apellido)')
            .eq('estado', 'vendida'),
          supabase.from('cotizaciones_saldo').select('*'),
        ])
      if (cotError) throw cotError
      if (saldoError) throw saldoError

      const porCotizacion = new Map<string, CotizacionSaldo>()
      for (const fila of (saldos ?? []) as CotizacionSaldo[]) {
        porCotizacion.set(fila.cotizacion_id, fila)
      }

      const morosas: CotizacionMorosa[] = []
      for (const cot of (cotizaciones ?? []) as unknown as CotizacionVendida[]) {
        const saldo = porCotizacion.get(cot.id)
        if (!saldo || estaLiquidada(saldo.saldo)) continue
        morosas.push({
          cotizacion_id: cot.id,
          numero: cot.numero,
          cliente: cot.cliente ? `${cot.cliente.nombre} ${cot.cliente.apellido}` : '—',
          fecha_emision: cot.fecha_emision,
          total: saldo.total,
          total_abonado: saldo.total_abonado,
          saldo: saldo.saldo,
          pct_abonado: saldo.pct_abonado,
        })
      }

      return morosas.sort((a, b) => b.saldo - a.saldo)
    },
  })
}

function invalidarPagos(
  qc: ReturnType<typeof useQueryClient>,
  cotizacionId: string,
  sessionId: string | undefined
) {
  qc.invalidateQueries({ queryKey: ['caja-actual'] })
  qc.invalidateQueries({ queryKey: ['ventas-sesion', sessionId] })
  qc.invalidateQueries({ queryKey: ['resumen-sesiones'] })
  qc.invalidateQueries({ queryKey: ['ventas-periodo'] })
  qc.invalidateQueries({ queryKey: ['cotizaciones'] })
  qc.invalidateQueries({ queryKey: ['cotizacion', cotizacionId] })
  qc.invalidateQueries({ queryKey: ['saldo-cotizacion', cotizacionId] })
  qc.invalidateQueries({ queryKey: ['pagos-cotizacion', cotizacionId] })
  qc.invalidateQueries({ queryKey: ['saldos'] })
  qc.invalidateQueries({ queryKey: ['cotizaciones-morosas'] })
  qc.invalidateQueries({ queryKey: ['ordenes'] })
}

/**
 * Cliente aprueba la cotización: entrega el anticipo (mínimo 50% del total,
 * salvo autorización de un admin), la cotización pasa directo a 'vendida' (sin
 * estado 'aprobada' intermedio) y se crea la orden de producción, que ya puede
 * arrancar. El saldo se cobra después en abonos, contra entrega.
 */
export function useRegistrarAnticipo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      cotizacion,
      sessionId,
      metodoPago,
      monto,
      usuarioId,
      fechaEntregaEstimada,
      autorizadoPor,
      motivoAutorizacion,
    }: {
      cotizacion: Cotizacion
      sessionId: string | undefined
      metodoPago: Venta['metodo_pago']
      monto: number
      usuarioId: string
      fechaEntregaEstimada?: string
      autorizadoPor?: string
      motivoAutorizacion?: string
    }) => {
      if (!sessionId) throw new Error('Debes abrir caja antes de registrar el anticipo')
      if (monto <= 0) throw new Error('El anticipo debe ser mayor a cero')
      if (excedeSaldo(monto, cotizacion.total)) {
        throw new Error(`El anticipo no puede superar el total (${formatCOP(cotizacion.total)})`)
      }
      // El trigger en Postgres es la garantía; esto solo da un error legible antes.
      if (!cumpleAnticipoMinimo(monto, cotizacion.total) && !autorizadoPor) {
        throw new Error(
          `El anticipo debe ser al menos el 50% del total (mínimo: ${formatCOP(anticipoMinimo(cotizacion.total))})`
        )
      }

      const { error: ventaError } = await supabase.from('ventas').insert({
        cotizacion_id: cotizacion.id,
        session_id: sessionId,
        metodo_pago: metodoPago,
        monto,
        tipo: tipoDePago(0, monto, cotizacion.total),
        autorizado_por: autorizadoPor ?? null,
        motivo_autorizacion: motivoAutorizacion?.trim() || null,
        usuario_id: usuarioId,
      })
      if (ventaError) throw ventaError

      const { error: cotizacionError } = await supabase
        .from('cotizaciones')
        .update({ estado: 'vendida' })
        .eq('id', cotizacion.id)
      if (cotizacionError) throw cotizacionError

      // Un flujo anterior creaba la orden al aprobar, antes de cobrar nada: esas
      // cotizaciones llegan aquí con orden ya existente y no debe duplicarse.
      const { data: ordenExistente, error: buscarError } = await supabase
        .from('ordenes_trabajo')
        .select('id')
        .eq('cotizacion_id', cotizacion.id)
        .maybeSingle()
      if (buscarError) throw buscarError

      if (ordenExistente) {
        if (fechaEntregaEstimada) {
          const { error: fechaError } = await supabase
            .from('ordenes_trabajo')
            .update({ fecha_entrega_estimada: fechaEntregaEstimada })
            .eq('id', ordenExistente.id)
          if (fechaError) throw fechaError
        }
        return
      }

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
    onSuccess: (_data, variables) => invalidarPagos(qc, variables.cotizacion.id, variables.sessionId),
  })
}

/**
 * Abono posterior al anticipo. Solo registra el cobro en la caja abierta: no
 * cambia el estado de la cotización ni toca la orden de trabajo. Cuando el
 * abono liquida el saldo se marca como 'saldo_final' y la orden queda libre
 * para entregarse.
 */
export function useRegistrarAbono() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      cotizacionId,
      sessionId,
      metodoPago,
      monto,
      usuarioId,
    }: {
      cotizacionId: string
      sessionId: string | undefined
      metodoPago: Venta['metodo_pago']
      monto: number
      usuarioId: string
    }) => {
      if (!sessionId) throw new Error('Debes abrir caja antes de registrar un abono')
      if (monto <= 0) throw new Error('El abono debe ser mayor a cero')

      // Se relee el saldo en vez de confiar en el de la pantalla: otro usuario
      // pudo abonar mientras el diálogo estaba abierto.
      const { data: saldoActual, error: saldoError } = await supabase
        .from('cotizaciones_saldo')
        .select('*')
        .eq('cotizacion_id', cotizacionId)
        .single()
      if (saldoError) throw saldoError

      const { total, total_abonado, saldo } = saldoActual as CotizacionSaldo
      if (excedeSaldo(monto, saldo)) {
        throw new Error(`El abono excede el saldo pendiente (${formatCOP(saldo)})`)
      }

      const { error } = await supabase.from('ventas').insert({
        cotizacion_id: cotizacionId,
        session_id: sessionId,
        metodo_pago: metodoPago,
        monto,
        tipo: tipoDePago(total_abonado, monto, total),
        usuario_id: usuarioId,
      })
      if (error) throw error
    },
    onSuccess: (_data, variables) => invalidarPagos(qc, variables.cotizacionId, variables.sessionId),
  })
}
