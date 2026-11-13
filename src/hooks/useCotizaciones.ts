import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { TOLERANCIA } from '@/lib/pagos'
import { formatCOP, hoyBogota } from '@/lib/utils'
import {
  calcularTotales, codigoOpcion, etiquetaDeIndice, MAX_OPCIONES, numeroBaseEnvio, siguienteEtiqueta,
  type TipoCategoria,
} from '@/lib/cotizaciones'
import type { Cotizacion, CotizacionItem, EnvioCategoria, OrdenTrabajo } from '@/types/database'

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
  /** Índice en `CotizacionInput.categorias`; solo en un envío por categorías. */
  categoria?: number
  recomendada?: boolean
  items: Omit<CotizacionItem, 'id' | 'cotizacion_id'>[]
}

/** Una parte del envío (p. ej. "Puerta principal"). */
export type CategoriaInput = { nombre: string; tipo: TipoCategoria }

/**
 * Cliente, vencimiento y notas son del envío; ítems, descuento e IVA, de cada
 * opción. Con `categorias`, cada opción indica la suya y el cliente elige una
 * por categoría.
 */
type CotizacionInput = {
  cliente_id: string
  usuario_id: string
  estado?: 'borrador' | 'enviada'
  fecha_vencimiento?: string
  notas?: string
  categorias?: CategoriaInput[]
  opciones: OpcionInput[]
}

const nombreOpcion = (nombre?: string | null) => nombre?.trim() || null

/**
 * Una sola opción recomendada por categoría (o por envío, si no está dividido):
 * al marcar una, las demás dejan de estarlo.
 */
async function dejarUnicaRecomendada(id: string) {
  const { data, error } = await supabase.from('cotizaciones').select('grupo_id, categoria_id').eq('id', id).single()
  if (error) throw error
  const { grupo_id, categoria_id } = data as Pick<Cotizacion, 'grupo_id' | 'categoria_id'>
  if (!grupo_id) return
  const consulta = supabase.from('cotizaciones').update({ recomendada: false })
    .eq('grupo_id', grupo_id).neq('id', id).eq('recomendada', true)
  const { error: updateError } = categoria_id
    ? await consulta.eq('categoria_id', categoria_id)
    : await consulta.is('categoria_id', null)
  if (updateError) throw updateError
}

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
 *
 * Con `categorias`, las letras van por categoría y el número lleva su posición
 * (COT-<ts>-1A, -1B, -2A…). El cliente elige una por categoría y la elección
 * se cobra como un pedido aparte (`useConsolidarEleccion`).
 */
export function useCrearCotizacion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CotizacionInput) => {
      if (input.opciones.length === 0) throw new Error('La cotización necesita al menos una opción')
      const categorias = input.categorias ?? []
      const porCategoria = categorias.length > 0

      if (porCategoria) {
        if (input.opciones.some((o) => o.categoria == null || !categorias[o.categoria])) {
          throw new Error('Cada opción debe pertenecer a una categoría')
        }
        const vacia = categorias.findIndex((_, idx) => !input.opciones.some((o) => o.categoria === idx))
        if (vacia !== -1) throw new Error(`La categoría "${categorias[vacia].nombre}" no tiene opciones`)
      }

      // Posición de cada opción: dentro de su categoría, o en todo el envío.
      const contador = new Map<number, number>()
      const posiciones = input.opciones.map((o) => {
        const clave = porCategoria ? o.categoria! : 0
        const n = contador.get(clave) ?? 0
        contador.set(clave, n + 1)
        return n
      })
      if (Math.max(...posiciones) >= MAX_OPCIONES) {
        throw new Error(`Máximo ${MAX_OPCIONES} opciones ${porCategoria ? 'por categoría' : 'por envío'}`)
      }

      const base = `COT-${Date.now()}`
      const agrupada = porCategoria || input.opciones.length > 1
      const grupoId = agrupada ? crypto.randomUUID() : null

      let idsCategoria: string[] = []
      if (porCategoria) {
        const { data, error } = await supabase
          .from('envio_categorias')
          .insert(categorias.map((c, orden) => ({ grupo_id: grupoId, nombre: c.nombre.trim(), tipo: c.tipo, orden })))
          .select('id, orden')
        if (error) throw error
        const porOrden = new Map((data as Pick<EnvioCategoria, 'id' | 'orden'>[]).map((c) => [c.orden, c.id]))
        idsCategoria = categorias.map((_, orden) => porOrden.get(orden)!)
      }

      const filas = input.opciones.map((opcion, idx) => {
        const { subtotal, total } = calcularTotales(opcion.items, opcion.descuento_pct, opcion.iva_pct)
        const etiqueta = agrupada ? etiquetaDeIndice(posiciones[idx]) : null
        const sufijo = etiqueta && (porCategoria ? codigoOpcion(opcion.categoria!, etiqueta) : etiqueta)
        return {
          numero: sufijo ? `${base}-${sufijo}` : base,
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
          categoria_id: porCategoria ? idsCategoria[opcion.categoria!] : null,
          recomendada: agrupada && !!opcion.recomendada,
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

/** Las categorías de un envío, en su orden. Vacío si el envío no está dividido. */
export function useCategoriasDelEnvio(grupoId: string | null | undefined) {
  return useQuery({
    queryKey: ['categorias_envio', grupoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('envio_categorias')
        .select('*')
        .eq('grupo_id', grupoId!)
        .order('orden')
      if (error) throw error
      return data as EnvioCategoria[]
    },
    enabled: !!grupoId,
  })
}

export type OpcionElegida = Pick<
  Cotizacion,
  'id' | 'numero' | 'estado' | 'opcion_etiqueta' | 'opcion_nombre' | 'total' | 'categoria_id'
> & { categoria: Pick<EnvioCategoria, 'nombre' | 'tipo' | 'orden'> | null }

/**
 * Las opciones que el cliente eligió y que forman el pedido, con su categoría.
 * Vacío si la cotización no es un pedido armado por elección.
 */
export function useEleccionDelPedido(pedidoId: string | undefined) {
  return useQuery({
    queryKey: ['eleccion_pedido', pedidoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cotizaciones')
        .select('id, numero, estado, opcion_etiqueta, opcion_nombre, total, categoria_id, categoria:envio_categorias(nombre, tipo, orden)')
        .eq('pedido_id', pedidoId!)
        .eq('estado', 'aprobada')
      if (error) throw error
      return (data as unknown as OpcionElegida[]).sort(
        (a, b) => (a.categoria?.orden ?? 0) - (b.categoria?.orden ?? 0)
      )
    },
    enabled: !!pedidoId,
  })
}

/**
 * El cliente eligió una opción por categoría (puede omitir categorías). La
 * base arma el pedido con sus ítems, aprueba las elegidas y descarta el resto.
 * Devuelve el pedido, sobre el que se cobra el anticipo.
 */
export function useConsolidarEleccion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ grupoId, opciones }: { grupoId: string; opciones: string[] }) => {
      const { data, error } = await supabase.rpc('consolidar_eleccion_envio', {
        p_grupo_id: grupoId,
        p_opciones: opciones,
      })
      if (error) throw error
      return data as Cotizacion
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cotizaciones'] })
      qc.invalidateQueries({ queryKey: ['cotizacion'] })
      qc.invalidateQueries({ queryKey: ['opciones_grupo'] })
      qc.invalidateQueries({ queryKey: ['eleccion_pedido'] })
    },
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
        .select('id, numero, estado, cliente_id, fecha_vencimiento, notas, grupo_id, categoria_id, descuento_pct, iva_pct, categoria:envio_categorias(orden)')
        .eq('id', input.origenId)
        .single()
      if (origenError) throw origenError
      const o = origen as unknown as Pick<
        Cotizacion,
        'id' | 'numero' | 'estado' | 'cliente_id' | 'fecha_vencimiento' | 'notas' | 'grupo_id' | 'categoria_id' | 'descuento_pct' | 'iva_pct'
      > & { categoria: Pick<EnvioCategoria, 'orden'> | null }
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

      // En un envío por categorías, la opción nueva entra en la categoría del
      // origen y las letras se cuentan solo dentro de ella.
      const consulta = supabase.from('cotizaciones').select('opcion_etiqueta').eq('grupo_id', grupoId)
      const { data: hermanas, error: hermanasError } = o.categoria_id
        ? await consulta.eq('categoria_id', o.categoria_id)
        : await consulta
      if (hermanasError) throw hermanasError
      const etiqueta = siguienteEtiqueta((hermanas as Pick<Cotizacion, 'opcion_etiqueta'>[]).map((h) => h.opcion_etiqueta))
      // Mismo número base que el envío: COT-123-A → COT-123-C, COT-123-2A → COT-123-2C.
      const base = numeroBaseEnvio(o.numero)
      const sufijo = o.categoria ? codigoOpcion(o.categoria.orden, etiqueta) : etiqueta

      // Con categorías, descuento e IVA son del envío: se copian del origen
      // para que el pedido sume bien.
      const descuentoPct = o.categoria_id ? o.descuento_pct : input.opcion.descuento_pct
      const ivaPct = o.categoria_id ? o.iva_pct : input.opcion.iva_pct
      const { subtotal, total } = calcularTotales(input.opcion.items, descuentoPct, ivaPct)
      const { data: cot, error } = await supabase
        .from('cotizaciones')
        .insert({
          numero: `${base}-${sufijo}`,
          cliente_id: o.cliente_id,
          usuario_id: input.usuario_id,
          estado: input.estado,
          fecha_emision: hoyBogota(),
          fecha_vencimiento: o.fecha_vencimiento,
          subtotal,
          descuento_pct: descuentoPct,
          iva_pct: ivaPct,
          total,
          notas: o.notas,
          grupo_id: grupoId,
          opcion_etiqueta: etiqueta,
          opcion_nombre: nombreOpcion(input.opcion.nombre),
          categoria_id: o.categoria_id,
          recomendada: !!input.opcion.recomendada,
        })
        .select()
        .single()
      if (error) throw error

      await insertarItems([{ cotizacionId: cot.id, items: input.opcion.items }])
      if (input.opcion.recomendada) await dejarUnicaRecomendada(cot.id)
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
  recomendada?: boolean
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
          ...(input.recomendada !== undefined && { recomendada: input.recomendada }),
        })
        .eq('id', input.id)
      if (error) throw error

      if (input.recomendada) await dejarUnicaRecomendada(input.id)

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
