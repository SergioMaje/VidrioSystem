import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { TOLERANCIA, anticipoMinimo, cumpleAnticipoMinimo, estaLiquidada, excedeSaldo, tipoDePago } from '@/lib/pagos'
import { finDeDia, formatCOP } from '@/lib/utils'
import type {
  CashRegisterSession,
  Cotizacion,
  CotizacionSaldo,
  OrdenTrabajo,
  TipoAnulacionCotizacion,
  Usuario,
  Venta,
  VentaMostradorItem,
} from '@/types/database'

/** Origen de un pago: una cotización o una venta de mostrador, nunca las dos. */
type Origen = { numero: string; cliente: { nombre: string; apellido: string } | null } | null

export type VentaConCotizacion = Venta & {
  cotizacion: Origen
  venta_mostrador: Origen
  /** Quién registró el cobro: con él se filtra por cajero en el cierre. */
  usuario: { nombre: string; apellido: string } | null
}

export function useVentasSesion(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['ventas-sesion', sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ventas')
        .select(
          '*, cotizacion:cotizaciones(numero, cliente:clientes(nombre, apellido)), venta_mostrador:ventas_mostrador(numero, cliente:clientes(nombre, apellido)), usuario:usuarios!ventas_usuario_id_fkey(nombre, apellido)'
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
  anulado_por_usuario: { nombre: string; apellido: string } | null
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
          '*, cotizacion:cotizaciones(numero, cliente:clientes(nombre, apellido)), venta_mostrador:ventas_mostrador(numero, cliente:clientes(nombre, apellido)), usuario:usuarios!ventas_usuario_id_fkey(nombre, apellido), anulado_por_usuario:usuarios!ventas_anulado_por_fkey(nombre, apellido)'
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
  anulado_por_usuario: Pick<Usuario, 'nombre' | 'apellido'> | null
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
        .select(
          '*, usuario:usuarios!ventas_usuario_id_fkey(nombre, apellido), anulado_por_usuario:usuarios!ventas_anulado_por_fkey(nombre, apellido)'
        )
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
  qc.invalidateQueries({ queryKey: ['ventas-por-desembolsar'] })
}

/**
 * Cliente aprueba la cotización: entrega el anticipo (mínimo 50% del total,
 * salvo autorización de un admin), la cotización pasa directo a 'vendida' (sin
 * estado 'aprobada' intermedio) y se crea la orden de producción, que ya puede
 * arrancar. El saldo se cobra después en abonos, contra entrega.
 *
 * Todo eso ocurre dentro del RPC `registrar_anticipo_cotizacion`, en una sola
 * transacción. Antes eran cuatro llamadas HTTP sueltas y la primera cobraba: si
 * cualquiera de las siguientes fallaba, el pago quedaba registrado y la
 * cotización sin aprobar ni producir. Ver la migración 20260831210000.
 */
export function useRegistrarAnticipo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      cotizacion,
      sessionId,
      metodoPago,
      monto,
      fechaEntregaEstimada,
      autorizadoPor,
      motivoAutorizacion,
      financieraId,
      referenciaFinanciera,
      idempotencyKey,
    }: {
      cotizacion: Cotizacion
      sessionId: string | undefined
      metodoPago: Venta['metodo_pago']
      monto: number
      fechaEntregaEstimada?: string
      autorizadoPor?: string
      motivoAutorizacion?: string
      /** Obligatoria con metodoPago 'financiera'; el crédito cubre el total. */
      financieraId?: string
      referenciaFinanciera?: string
      /**
       * Una por apertura del diálogo. Si la misma petición llega dos veces (doble
       * clic, reintento tras un corte de red), el RPC devuelve la orden ya creada
       * sin cobrar otra vez.
       */
      idempotencyKey?: string
    }) => {
      if (!sessionId) throw new Error('Debes abrir caja antes de registrar el anticipo')
      if (monto <= 0) throw new Error('El anticipo debe ser mayor a cero')
      if (metodoPago === 'financiera') {
        if (!financieraId) throw new Error('Selecciona la financiera que otorgó el crédito')
        if (monto + TOLERANCIA < cotizacion.total) {
          throw new Error(`El crédito con financiera debe cubrir el total (${formatCOP(cotizacion.total)})`)
        }
      }
      // El trigger en Postgres es la garantía; esto solo da un error legible antes.
      if (!cumpleAnticipoMinimo(monto, cotizacion.total) && !autorizadoPor) {
        throw new Error(
          `El anticipo debe ser al menos el 50% del total (mínimo: ${formatCOP(anticipoMinimo(cotizacion.total))})`
        )
      }

      const { error } = await supabase.rpc('registrar_anticipo_cotizacion', {
        p_cotizacion_id: cotizacion.id,
        p_metodo_pago: metodoPago,
        p_monto: monto,
        p_fecha_entrega: fechaEntregaEstimada || null,
        p_autorizado_por: autorizadoPor ?? null,
        p_motivo_autorizacion: motivoAutorizacion?.trim() || null,
        p_financiera_id: metodoPago === 'financiera' ? financieraId : null,
        p_referencia_financiera: metodoPago === 'financiera' ? referenciaFinanciera?.trim() || null : null,
        p_idempotency_key: idempotencyKey ?? null,
      })
      if (error) throw error
    },
    // onSettled, no onSuccess: un fallo también puede haber cambiado el saldo
    // (el RPC es atómico, pero la red puede cortarse tras el commit). Dejar la
    // caché sin refrescar tras un error fue lo que hizo que la UI siguiera
    // creyendo que no había pagos y ofreciera un anticipo ya cobrado.
    onSettled: (_data, _err, variables) => {
      invalidarPagos(qc, variables.cotizacion.id, variables.sessionId)
      // El RPC también crea la orden: la cotización debe mostrarla sin recargar.
      qc.invalidateQueries({ queryKey: ['orden_de_cotizacion', variables.cotizacion.id] })
      qc.invalidateQueries({ queryKey: ['ordenes'] })
      // Si era una opción de un envío, el RPC descartó las demás.
      if (variables.cotizacion.grupo_id) {
        qc.invalidateQueries({ queryKey: ['opciones_grupo', variables.cotizacion.grupo_id] })
        qc.invalidateQueries({ queryKey: ['cotizacion'] })
      }
    },
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
      idempotencyKey,
    }: {
      cotizacionId: string
      sessionId: string | undefined
      metodoPago: Venta['metodo_pago']
      monto: number
      usuarioId: string
      /** Ver useRegistrarAnticipo: la misma clave no cobra dos veces. */
      idempotencyKey?: string
    }) => {
      if (!sessionId) throw new Error('Debes abrir caja antes de registrar un abono')
      if (monto <= 0) throw new Error('El abono debe ser mayor a cero')
      // El trigger también lo rechaza; aquí solo se adelanta el mensaje.
      if (metodoPago === 'financiera') {
        throw new Error('El crédito con financiera cubre el total de la venta: no se usa para abonos')
      }

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
        idempotency_key: idempotencyKey ?? null,
      })
      // La misma clave ya entró: es un reintento de un abono ya cobrado, no un
      // error. Se trata como éxito para no ofrecer cobrarlo otra vez.
      if (error?.code === '23505' && error.message.includes('ventas_idempotency_key_key')) return
      if (error) throw error
    },
    onSettled: (_data, _err, variables) =>
      invalidarPagos(qc, variables.cotizacionId, variables.sessionId),
  })
}

/** Lo que necesita el diálogo de anulación para anunciar los efectos antes de confirmar. */
export type PreviaAnulacion = {
  /** Caja donde entró el cobro. */
  cajaOriginal: Pick<CashRegisterSession, 'id' | 'status' | 'opened_at'> | null
  /** Caja abierta hoy, a donde iría el reverso si la original ya cerró. */
  cajaAbierta: Pick<CashRegisterSession, 'id' | 'opened_at'> | null
  /** Otros cobros activos de la misma cotización (en el duplicado, el válido). */
  otrosCobrosActivos: number
  cotizacion: Pick<Cotizacion, 'numero' | 'estado' | 'estado_previo_venta'> | null
  ordenes: Pick<OrdenTrabajo, 'id' | 'numero' | 'estado'>[]
  /** Si alguna orden ya consumió material del inventario. */
  materialConsumido: boolean
  /** Líneas de la venta de mostrador que volverían al inventario. */
  itemsMostrador: Pick<VentaMostradorItem, 'id' | 'descripcion' | 'cantidad'>[]
}

/**
 * Vista previa de la anulación. Es solo informativa: las reglas (permisos, caja
 * abierta, orden en producción, desembolso registrado) las aplica el RPC
 * `anular_venta`, que es el que decide.
 */
export function usePreviaAnulacion(venta: Venta | null) {
  return useQuery({
    queryKey: ['previa-anulacion', venta?.id],
    enabled: !!venta,
    queryFn: async (): Promise<PreviaAnulacion> => {
      const v = venta as Venta
      const [original, abierta] = await Promise.all([
        supabase.from('cash_register_sessions').select('id, status, opened_at').eq('id', v.session_id).maybeSingle(),
        supabase.from('cash_register_sessions').select('id, opened_at').eq('status', 'open').maybeSingle(),
      ])
      if (original.error) throw original.error
      if (abierta.error) throw abierta.error

      const previa: PreviaAnulacion = {
        cajaOriginal: original.data,
        cajaAbierta: abierta.data,
        otrosCobrosActivos: 0,
        cotizacion: null,
        ordenes: [],
        materialConsumido: false,
        itemsMostrador: [],
      }

      if (v.cotizacion_id) {
        const [otros, cot, ordenes] = await Promise.all([
          supabase
            .from('ventas')
            .select('id', { count: 'exact', head: true })
            .eq('cotizacion_id', v.cotizacion_id)
            .is('anulado_at', null)
            .neq('id', v.id),
          supabase.from('cotizaciones').select('numero, estado, estado_previo_venta').eq('id', v.cotizacion_id).single(),
          supabase
            .from('ordenes_trabajo')
            .select('id, numero, estado')
            .eq('cotizacion_id', v.cotizacion_id)
            .neq('estado', 'cancelada'),
        ])
        if (otros.error) throw otros.error
        if (cot.error) throw cot.error
        if (ordenes.error) throw ordenes.error
        previa.otrosCobrosActivos = otros.count ?? 0
        previa.cotizacion = cot.data
        previa.ordenes = ordenes.data ?? []

        if (previa.ordenes.length > 0) {
          const { count, error } = await supabase
            .from('orden_materiales')
            .select('id', { count: 'exact', head: true })
            .in('orden_id', previa.ordenes.map((o) => o.id))
            .eq('estado', 'consumido')
          if (error) throw error
          previa.materialConsumido = (count ?? 0) > 0
        }
      } else if (v.venta_mostrador_id) {
        const { data, error } = await supabase
          .from('ventas_mostrador_items')
          .select('id, descripcion, cantidad')
          .eq('venta_id', v.venta_mostrador_id)
        if (error) throw error
        previa.itemsMostrador = data ?? []
      }

      return previa
    },
  })
}

/** Un cobro activo de la cotización y la caja donde entró. */
export type CobroAAnular = {
  venta: Venta
  cajaOriginal: PreviaAnulacion['cajaOriginal']
}

/** Lo que necesita el diálogo de anulación de una cotización completa. */
export type PreviaAnulacionCotizacion = {
  /** Cobros activos, del más nuevo al más viejo (el orden en que los anula el RPC). */
  cobros: CobroAAnular[]
  cajaAbierta: PreviaAnulacion['cajaAbierta']
  ordenes: PreviaAnulacion['ordenes']
  materialConsumido: boolean
}

/**
 * Vista previa de `anular_cotizacion`. Igual que usePreviaAnulacion, es solo
 * informativa: el RPC aplica las reglas.
 */
export function usePreviaAnulacionCotizacion(cotizacionId: string | null) {
  return useQuery({
    queryKey: ['previa-anulacion-cotizacion', cotizacionId],
    enabled: !!cotizacionId,
    queryFn: async (): Promise<PreviaAnulacionCotizacion> => {
      const id = cotizacionId as string
      const [ventas, abierta, ordenes] = await Promise.all([
        supabase
          .from('ventas')
          .select('*')
          .eq('cotizacion_id', id)
          .is('anulado_at', null)
          .order('created_at', { ascending: false }),
        supabase.from('cash_register_sessions').select('id, opened_at').eq('status', 'open').maybeSingle(),
        supabase.from('ordenes_trabajo').select('id, numero, estado').eq('cotizacion_id', id).neq('estado', 'cancelada'),
      ])
      if (ventas.error) throw ventas.error
      if (abierta.error) throw abierta.error
      if (ordenes.error) throw ordenes.error

      const cobros = (ventas.data ?? []) as Venta[]
      const sesionIds = [...new Set(cobros.map((v) => v.session_id))]
      const sesiones = new Map<string, CobroAAnular['cajaOriginal']>()
      if (sesionIds.length > 0) {
        const { data, error } = await supabase
          .from('cash_register_sessions')
          .select('id, status, opened_at')
          .in('id', sesionIds)
        if (error) throw error
        for (const s of data ?? []) sesiones.set(s.id, s)
      }

      let materialConsumido = false
      const listaOrdenes = ordenes.data ?? []
      if (listaOrdenes.length > 0) {
        const { count, error } = await supabase
          .from('orden_materiales')
          .select('id', { count: 'exact', head: true })
          .in('orden_id', listaOrdenes.map((o) => o.id))
          .eq('estado', 'consumido')
        if (error) throw error
        materialConsumido = (count ?? 0) > 0
      }

      return {
        cobros: cobros.map((venta) => ({ venta, cajaOriginal: sesiones.get(venta.session_id) ?? null })),
        cajaAbierta: abierta.data,
        ordenes: listaOrdenes,
        materialConsumido,
      }
    },
  })
}

/**
 * Anula una cotización vendida completa con el RPC `anular_cotizacion`: anula
 * todos sus cobros (con sus reversos de caja), cancela la orden pendiente y la
 * deja en 'anulada', un estado final. Solo admin; la garantía está en el RPC.
 */
export function useAnularCotizacion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      cotizacionId,
      motivo,
      tipo,
    }: {
      cotizacionId: string
      motivo: string
      tipo: TipoAnulacionCotizacion
    }) => {
      const { data, error } = await supabase.rpc('anular_cotizacion', {
        p_cotizacion_id: cotizacionId,
        p_motivo: motivo,
        p_tipo: tipo,
      })
      if (error) throw error
      return data as unknown as Cotizacion
    },
    onSettled: (_data, _err, { cotizacionId }) => {
      // Los reversos pueden caer en varias cajas: se invalidan todas.
      invalidarPagos(qc, cotizacionId, undefined)
      qc.invalidateQueries({ queryKey: ['orden_de_cotizacion', cotizacionId] })
      qc.invalidateQueries({ queryKey: ['ventas-sesion'] })
      qc.invalidateQueries({ queryKey: ['ventas-por-desembolsar'] })
      qc.invalidateQueries({ queryKey: ['gastos-sesion'] })
      qc.invalidateQueries({ queryKey: ['gastos-periodo'] })
      qc.invalidateQueries({ queryKey: ['previa-anulacion-cotizacion', cotizacionId] })
      qc.invalidateQueries({ queryKey: ['previa-anulacion'] })
    },
  })
}

/**
 * Anula un cobro sin borrarlo. Todo pasa en una sola transacción, en el RPC
 * `anular_venta`:
 *   * marca el cobro como anulado;
 *   * registra el reverso en caja, salvo con financiera;
 *   * reintegra el inventario de mostrador;
 *   * si era el último cobro de la cotización, la devuelve a su estado previo y
 *     cancela la orden pendiente.
 * Solo admin; la garantía está en el RPC.
 */
export function useAnularVenta() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      venta,
      motivo,
      saleEfectivo,
    }: {
      venta: Venta
      motivo: string
      /** Solo cuenta si la caja del cobro ya cerró y el pago fue en efectivo. */
      saleEfectivo: boolean
    }) => {
      const { data, error } = await supabase.rpc('anular_venta', {
        p_venta_id: venta.id,
        p_motivo: motivo,
        p_sale_efectivo: saleEfectivo,
      })
      if (error) throw error
      return data as unknown as Venta
    },
    // onSettled: mismo criterio que los cobros, porque un corte de red después
    // del commit también movió la caja.
    onSettled: (_data, _err, { venta }) => {
      if (venta.cotizacion_id) {
        invalidarPagos(qc, venta.cotizacion_id, venta.session_id)
        qc.invalidateQueries({ queryKey: ['orden_de_cotizacion', venta.cotizacion_id] })
      }
      // El reverso puede ir a una caja distinta a la del cobro.
      qc.invalidateQueries({ queryKey: ['caja-actual'] })
      qc.invalidateQueries({ queryKey: ['ventas-sesion'] })
      qc.invalidateQueries({ queryKey: ['resumen-sesiones'] })
      qc.invalidateQueries({ queryKey: ['ventas-periodo'] })
      qc.invalidateQueries({ queryKey: ['ventas-por-desembolsar'] })
      qc.invalidateQueries({ queryKey: ['gastos-sesion'] })
      qc.invalidateQueries({ queryKey: ['gastos-periodo'] })
      qc.invalidateQueries({ queryKey: ['items'] })
      qc.invalidateQueries({ queryKey: ['movimientos'] })
      qc.invalidateQueries({ queryKey: ['previa-anulacion', venta.id] })
    },
  })
}
