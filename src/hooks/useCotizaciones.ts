import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { TOLERANCIA } from '@/lib/pagos'
import { formatCOP, hoyBogota } from '@/lib/utils'
import { calcularTotales, etiquetaDeIndice, MAX_OPCIONES, siguienteEtiqueta } from '@/lib/cotizaciones'
import type { Cotizacion, CotizacionItem, OrdenTrabajo } from '@/types/database'

/**
 * Marca como 'vencida' toda cotización en borrador/enviada cuya fecha_vencimiento
 * ya pasó. No hay cron en este proyecto, así que se ejecuta de forma oportunista
 * cada vez que se listan o abren cotizaciones — es idempotente y barata (el WHERE
 * no encuentra filas la mayoría de las veces).
 */
export async function expirarCotizacionesVencidas() {
  const hoy = hoyBogota()
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
        .select(
          '*, cliente:clientes(*), items:cotizacion_items(*), anulado_por_usuario:usuarios!cotizaciones_anulado_por_fkey(nombre, apellido)'
        )
        .eq('id', id)
        .single()
      if (error) throw error
      return data as Cotizacion & {
        items: CotizacionItem[]
        /** Quién anuló la cotización; null si no está anulada. */
        anulado_por_usuario: { nombre: string; apellido: string } | null
      }
    },
    enabled: !!id,
  })
}

/**
 * La orden de trabajo que nació de la cotización al cobrar el anticipo. Es null
 * mientras la cotización no se haya vendido.
 */
export function useOrdenDeCotizacion(cotizacionId: string | undefined) {
  return useQuery({
    queryKey: ['orden_de_cotizacion', cotizacionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ordenes_trabajo')
        .select('id, numero, estado, fecha_entrega_estimada')
        .eq('cotizacion_id', cotizacionId!)
        .maybeSingle()
      if (error) throw error
      return data as Pick<OrdenTrabajo, 'id' | 'numero' | 'estado' | 'fecha_entrega_estimada'> | null
    },
    enabled: !!cotizacionId,
  })
}

/** Lo que cambia entre las opciones de un envío. */
export type OpcionInput = {
  /** Nombre corto para el cliente; solo se guarda si el envío tiene varias opciones. */
  nombre?: string
  descuento_pct: number
  iva_pct: number
  items: Omit<CotizacionItem, 'id' | 'cotizacion_id'>[]
}

/** Cliente, vencimiento y notas son del envío; ítems, descuento e IVA, de cada opción. */
type CotizacionInput = {
  cliente_id: string
  usuario_id: string
  estado?: 'borrador' | 'enviada'
  fecha_vencimiento?: string
  notas?: string
  opciones: OpcionInput[]
}

const nombreOpcion = (nombre?: string | null) => nombre?.trim() || null

/** Inserta los ítems de varias cotizaciones en una sola llamada. */
async function insertarItems(porCotizacion: { cotizacionId: string; items: OpcionInput['items'] }[]) {
  const filas = porCotizacion.flatMap(({ cotizacionId, items }) =>
    items.map((item) => ({ ...item, cotizacion_id: cotizacionId }))
  )
  if (filas.length === 0) return
  const { error } = await supabase.from('cotizacion_items').insert(filas)
  if (error) throw error
}

/**
 * Crea una cotización suelta, o un envío con varias opciones si `opciones`
 * trae más de una. Cada opción es una cotización completa (COT-<ts>-A, -B…)
 * enlazada por `grupo_id`: al cobrar una, la base descarta las demás.
 */
export function useCrearCotizacion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CotizacionInput) => {
      if (input.opciones.length === 0) throw new Error('La cotización necesita al menos una opción')
      if (input.opciones.length > MAX_OPCIONES) throw new Error(`Un envío admite máximo ${MAX_OPCIONES} opciones`)

      const base = `COT-${Date.now()}`
      const agrupada = input.opciones.length > 1
      const grupoId = agrupada ? crypto.randomUUID() : null

      const filas = input.opciones.map((opcion, idx) => {
        const { subtotal, total } = calcularTotales(opcion.items, opcion.descuento_pct, opcion.iva_pct)
        const etiqueta = agrupada ? etiquetaDeIndice(idx) : null
        return {
          numero: etiqueta ? `${base}-${etiqueta}` : base,
          cliente_id: input.cliente_id,
          usuario_id: input.usuario_id,
          estado: input.estado ?? 'borrador',
          fecha_emision: hoyBogota(),
          fecha_vencimiento: input.fecha_vencimiento ?? null,
          subtotal,
          descuento_pct: opcion.descuento_pct,
          iva_pct: opcion.iva_pct,
          total,
          notas: input.notas ?? null,
          grupo_id: grupoId,
          opcion_etiqueta: etiqueta,
          opcion_nombre: agrupada ? nombreOpcion(opcion.nombre) : null,
        }
      })

      const { data: cotizaciones, error } = await supabase.from('cotizaciones').insert(filas).select()
      if (error) throw error

      // Se empareja por número y no por posición: el orden de la respuesta no
      // está garantizado.
      const porNumero = new Map((cotizaciones as Cotizacion[]).map((c) => [c.numero, c]))
      await insertarItems(
        filas.map((fila, idx) => ({ cotizacionId: porNumero.get(fila.numero)!.id, items: input.opciones[idx].items }))
      )
      return porNumero.get(filas[0].numero)!
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cotizaciones'] }),
  })
}

/** Las opciones de un envío, con sus ítems, en orden A, B, C… */
export function useOpcionesDelGrupo(grupoId: string | null | undefined) {
  return useQuery({
    queryKey: ['opciones_grupo', grupoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cotizaciones')
        .select('*, items:cotizacion_items(*)')
        .eq('grupo_id', grupoId!)
        .order('opcion_etiqueta')
      if (error) throw error
      return data as (Cotizacion & { items: CotizacionItem[] })[]
    },
    enabled: !!grupoId,
  })
}

type AgregarOpcionInput = {
  /** Cualquier cotización del envío; si es suelta, pasa a ser la opción A. */
  origenId: string
  usuario_id: string
  estado: 'borrador' | 'enviada'
  opcion: OpcionInput
}

/**
 * Suma una opción a un envío ya creado. Cliente, vencimiento y notas se copian
 * del envío. Si el origen era una cotización suelta, se convierte en la opción
 * A sin cambiarle el número, que el cliente ya pudo haber visto.
 */
export function useAgregarOpcion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: AgregarOpcionInput) => {
      const { data: origen, error: origenError } = await supabase
        .from('cotizaciones')
        .select('id, numero, estado, cliente_id, fecha_vencimiento, notas, grupo_id')
        .eq('id', input.origenId)
        .single()
      if (origenError) throw origenError
      const o = origen as Pick<Cotizacion, 'id' | 'numero' | 'estado' | 'cliente_id' | 'fecha_vencimiento' | 'notas' | 'grupo_id'>
      if (o.estado !== 'borrador' && o.estado !== 'enviada') {
        throw new Error('Solo se agregan opciones a un envío en borrador o enviado')
      }

      let grupoId = o.grupo_id
      if (!grupoId) {
        grupoId = crypto.randomUUID()
        const { error } = await supabase
          .from('cotizaciones')
          .update({ grupo_id: grupoId, opcion_etiqueta: etiquetaDeIndice(0) })
          .eq('id', o.id)
        if (error) throw error
      }

      const { data: hermanas, error: hermanasError } = await supabase
        .from('cotizaciones')
        .select('opcion_etiqueta')
        .eq('grupo_id', grupoId)
      if (hermanasError) throw hermanasError
      const etiqueta = siguienteEtiqueta((hermanas as Pick<Cotizacion, 'opcion_etiqueta'>[]).map((h) => h.opcion_etiqueta))
      // Mismo número base que el envío: COT-123-A → COT-123-C.
      const base = o.numero.replace(/-[A-Z]$/, '')

      const { subtotal, total } = calcularTotales(input.opcion.items, input.opcion.descuento_pct, input.opcion.iva_pct)
      const { data: cot, error } = await supabase
        .from('cotizaciones')
        .insert({
          numero: `${base}-${etiqueta}`,
          cliente_id: o.cliente_id,
          usuario_id: input.usuario_id,
          estado: input.estado,
          fecha_emision: hoyBogota(),
          fecha_vencimiento: o.fecha_vencimiento,
          subtotal,
          descuento_pct: input.opcion.descuento_pct,
          iva_pct: input.opcion.iva_pct,
          total,
          notas: o.notas,
          grupo_id: grupoId,
          opcion_etiqueta: etiqueta,
          opcion_nombre: nombreOpcion(input.opcion.nombre),
        })
        .select()
        .single()
      if (error) throw error

      await insertarItems([{ cotizacionId: cot.id, items: input.opcion.items }])
      return cot as Cotizacion
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['cotizaciones'] })
      qc.invalidateQueries({ queryKey: ['cotizacion', variables.origenId] })
      qc.invalidateQueries({ queryKey: ['opciones_grupo'] })
    },
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
  /** Solo para una opción de un envío; en una cotización suelta se omite. */
  opcion_nombre?: string
  items: Omit<CotizacionItem, 'id' | 'cotizacion_id'>[]
}

export function useActualizarCotizacion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CotizacionUpdateInput) => {
      const { subtotal, total } = calcularTotales(input.items, input.descuento_pct, input.iva_pct)

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
          ...(input.opcion_nombre !== undefined && { opcion_nombre: nombreOpcion(input.opcion_nombre) }),
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
      qc.invalidateQueries({ queryKey: ['opciones_grupo'] })
    },
  })
}

/**
 * Cambia el estado de una cotización. Con `grupoId`, el cambio aplica a todas
 * las opciones del envío que sigan abiertas (borrador o enviada): el envío se
 * manda o se rechaza completo.
 */
export function useCambiarEstadoCotizacion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, estado, grupoId }: { id: string; estado: Cotizacion['estado']; grupoId?: string | null }) => {
      const consulta = supabase.from('cotizaciones').update({ estado })
      const { error } = grupoId
        ? await consulta.eq('grupo_id', grupoId).in('estado', ['borrador', 'enviada'])
        : await consulta.eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cotizaciones'] })
      qc.invalidateQueries({ queryKey: ['cotizacion'] })
      qc.invalidateQueries({ queryKey: ['opciones_grupo'] })
    },
  })
}
