import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ConfiguradorProducto, type EdicionItem } from '@/pages/productos/ConfiguradorProducto'
import { ItemLibreForm } from '@/pages/productos/ItemLibreForm'
import { PanelCotizacion, type ItemCotizacion } from '@/pages/productos/PanelCotizacion'
import { OpcionesEnvioCard, type CategoriaForm, type ResumenOpcion } from './OpcionesEnvioCard'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  useCrearCotizacion, useCotizacion, useActualizarEnvio, useAgregarOpcion,
  useOpcionesDelGrupo, useCategoriasDelEnvio,
} from '@/hooks/useCotizaciones'
import { useReferencias } from '@/hooks/useReferencias'
import { useConfiguracionEmpresa } from '@/hooks/useConfiguracionEmpresa'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { useCambiosSinGuardar } from '@/providers/cambiosSinGuardar'
import { PageLoader } from '@/components/shared/LoadingSpinner'
import {
  calcularTotales, codigoOpcion, IVA_PCT_DEFECTO, ivaPorDefecto, MAX_OPCIONES, numeroBaseEnvio, siguienteEtiqueta,
} from '@/lib/cotizaciones'
import { hoyBogota, mensajeError, sumarDias } from '@/lib/utils'
import type { Cotizacion, CotizacionItem, EnvioCategoria } from '@/types/database'

type ModoItem = 'referencia' | 'libre'

/** Lo que cambia entre las opciones de un envío. Cliente, vencimiento y notas son comunes. */
type OpcionForm = {
  /** Al editar un envío: la opción ya guardada. Sin id, es nueva. */
  id?: string
  /** Al editar un envío: su letra guardada, que no cambia. */
  etiqueta?: string
  nombre: string
  items: ItemCotizacion[]
  descuentoPct: number
  ivaPct: number
  /** Índice en `categorias`; null si el envío no está dividido. */
  categoria: number | null
  recomendada: boolean
}

const vencimientoPorDefecto = () => sumarDias(hoyBogota(), 7)
const opcionVacia = (categoria: number | null = null, base?: Pick<OpcionForm, 'descuentoPct' | 'ivaPct'>): OpcionForm => ({
  nombre: '',
  items: [],
  descuentoPct: base?.descuentoPct ?? 0,
  ivaPct: base?.ivaPct ?? IVA_PCT_DEFECTO,
  categoria,
  recomendada: false,
})
const categoriaVacia = (): CategoriaForm => ({ nombre: '', tipo: 'otro' })

/**
 * Letra de cada opción: dentro de su categoría, o en todo el envío. Las
 * guardadas conservan la suya; las nuevas toman la primera libre, contando las
 * que ya existen en la base aunque estén anuladas (como `actualizar_envio`).
 */
function letrasDeOpciones(
  opciones: Pick<OpcionForm, 'categoria' | 'etiqueta'>[],
  categorias: CategoriaForm[],
  usadasEnBase: Record<string, string[]>,
) {
  const tomadas = new Map<number | null, string[]>()
  const deCategoria = (c: number | null) => {
    let lista = tomadas.get(c)
    if (!lista) {
      const clave = c === null ? '' : categorias[c]?.id
      lista = [
        ...(clave !== undefined ? usadasEnBase[clave] ?? [] : []),
        ...opciones.filter((o) => o.categoria === c && o.etiqueta).map((o) => o.etiqueta!),
      ]
      tomadas.set(c, lista)
    }
    return lista
  }
  return opciones.map((o) => {
    if (o.etiqueta) return o.etiqueta
    const lista = deCategoria(o.categoria)
    let letra = '?'
    try {
      letra = siguienteEtiqueta(lista)
    } catch {
      // Sin letras libres: la base lo rechaza al guardar con un mensaje claro.
    }
    lista.push(letra)
    return letra
  })
}

type ConItems = Cotizacion & { items: CotizacionItem[] }

/** Un envío ya guardado, como lo trabaja el formulario. */
type EnvioCargado = {
  clienteId: string
  fechaVencimiento: string
  notas: string
  categorias: CategoriaForm[]
  opciones: OpcionForm[]
  /** La opción desde la que se abrió la edición. */
  activa: number
  /** Letras que ya existen en la base por categoría (su id, o '' sin categorías), anuladas incluidas. */
  letrasUsadas: Record<string, string[]>
  /** Orden que le toca a la próxima categoría nueva. */
  ordenSiguiente: number
  /** Alguna opción ya se le mandó al cliente: al guardar, el envío vuelve a borrador. */
  enviado: boolean
  /** Las opciones vivas al cargar; las que se quiten quedan anuladas. */
  ids: string[]
}

function aOpcionForm(c: ConItems, categoria: number | null): OpcionForm {
  return {
    id: c.id,
    etiqueta: c.opcion_etiqueta ?? undefined,
    nombre: c.opcion_nombre ?? '',
    descuentoPct: c.descuento_pct,
    ivaPct: c.iva_pct,
    categoria,
    recomendada: c.recomendada,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    items: c.items.map(({ id, cotizacion_id, ...rest }) => rest),
  }
}

/**
 * Arma el formulario con todo el envío de `base`: sus opciones vivas (no
 * anuladas) y las categorías que aún tienen alguna. Una cotización suelta es
 * un envío de una sola opción.
 */
function envioAFormulario(base: ConItems, grupo: ConItems[] | undefined, cats: EnvioCategoria[] | undefined): EnvioCargado {
  const todas = grupo ?? [base]
  const vivas = todas.filter((o) => o.estado !== 'anulada')
  const ordenadas = [...(cats ?? [])].sort((a, b) => a.orden - b.orden)
  const catsVivas = ordenadas.filter((cat) => vivas.some((o) => o.categoria_id === cat.id))
  const idxCat = (o: ConItems) => (o.categoria_id ? catsVivas.findIndex((cat) => cat.id === o.categoria_id) : -1)
  const opcionesVivas = [...vivas].sort((a, b) =>
    idxCat(a) - idxCat(b) || (a.opcion_etiqueta ?? '').localeCompare(b.opcion_etiqueta ?? ''))

  const letrasUsadas: Record<string, string[]> = {}
  for (const o of todas) {
    if (!o.opcion_etiqueta) continue
    const clave = o.categoria_id ?? ''
    letrasUsadas[clave] = [...(letrasUsadas[clave] ?? []), o.opcion_etiqueta]
  }

  return {
    clienteId: base.cliente_id,
    fechaVencimiento: base.fecha_vencimiento || vencimientoPorDefecto(),
    notas: base.notas || '',
    categorias: catsVivas.map((cat) => ({
      id: cat.id,
      orden: cat.orden,
      nombre: cat.nombre,
      tipo: cat.tipo,
      tipoPersonalizadoId: cat.tipo_personalizado_id,
    })),
    opciones: opcionesVivas.map((o) => aOpcionForm(o, o.categoria_id ? idxCat(o) : null)),
    activa: Math.max(0, opcionesVivas.findIndex((o) => o.id === base.id)),
    letrasUsadas,
    ordenSiguiente: ordenadas.length > 0 ? Math.max(...ordenadas.map((c) => c.orden)) + 1 : 0,
    enviado: vivas.some((o) => o.estado === 'enviada'),
    ids: opcionesVivas.map((o) => o.id),
  }
}

export function CotizacionFormPage() {
  const { id } = useParams<{ id?: string }>()
  // ?agregarA=<id>: suma una opción nueva al envío de esa cotización.
  const [searchParams] = useSearchParams()
  const agregarA = searchParams.get('agregarA')
  const navigate = useNavigate()
  const { usuario } = useAuth()
  const { toast } = useToast()
  const modoEdicion = !!id
  const modoAgregar = !modoEdicion && !!agregarA

  const { data: cotizacionExistente, isLoading: cargandoCotizacion } = useCotizacion(id || '')
  const { data: envioOrigen, isLoading: cargandoOrigen } = useCotizacion(modoAgregar ? agregarA! : '')
  const { data: referencias, isLoading: cargandoReferencias } = useReferencias()
  // IVA con el que arranca una opción nueva: el de la vidriería, o 0 si no cobra IVA.
  const { data: config, isLoading: cargandoConfig } = useConfiguracionEmpresa()
  const ivaDefecto = ivaPorDefecto(config)
  const crearCotizacion = useCrearCotizacion()
  const actualizarEnvio = useActualizarEnvio()
  const agregarOpcion = useAgregarOpcion()
  // Al editar una opción de un envío se trabaja el envío completo: todas sus
  // opciones y categorías.
  const grupoEdicion = modoEdicion ? cotizacionExistente?.grupo_id ?? null : null
  const { data: opcionesGrupo } = useOpcionesDelGrupo(grupoEdicion)
  const { data: categoriasEnvio } = useCategoriasDelEnvio(grupoEdicion)
  // El envío tal como se cargó. Se arma una sola vez: si las consultas se
  // refrescan mientras se edita, no se pisan los cambios.
  const [cargado, setCargado] = useState<EnvioCargado | null>(null)

  const [clienteId, setClienteId] = useState('')
  const [fechaInicial] = useState(vencimientoPorDefecto)
  const [fechaVencimiento, setFechaVencimiento] = useState(fechaInicial)
  const [notas, setNotas] = useState('')
  const [categorias, setCategorias] = useState<CategoriaForm[]>([])
  const [opciones, setOpciones] = useState<OpcionForm[]>(() => [opcionVacia()])
  const [activa, setActiva] = useState(0)
  const [edicionItem, setEdicionItem] = useState<EdicionItem | null>(null)
  const [modo, setModo] = useState<ModoItem>('referencia')

  const opcion = opciones[activa] ?? opciones[0]
  const items = opcion.items
  const porCategoria = categorias.length > 0
  // La opción que se trabaja sola pertenece a un envío por categorías: su
  // descuento e IVA son los del envío.
  const opcionSueltaConCategoria = modoAgregar && !!envioOrigen?.categoria_id

  /** Aplica un cambio solo a la opción que se está editando. */
  const actualizarActiva = (fn: (o: OpcionForm) => OpcionForm) =>
    setOpciones((prev) => prev.map((o, i) => (i === activa ? fn(o) : o)))

  // Sin referencias cargadas el configurador no puede producir ningún ítem, así que
  // se abre directo en el modo libre. El día que se cree la primera referencia el
  // default vuelve solo a 'referencia' y el modo manual pasa a ser la excepción.
  useEffect(() => {
    if (cargandoReferencias || !referencias) return
    if (referencias.length === 0) setModo('libre')
  }, [cargandoReferencias, referencias])

  useEffect(() => {
    if (!modoEdicion || cargado || !cotizacionExistente) return
    if (grupoEdicion && (!opcionesGrupo || !categoriasEnvio)) return
    const envio = envioAFormulario(cotizacionExistente, grupoEdicion ? opcionesGrupo : undefined, categoriasEnvio)
    setCargado(envio)
    setClienteId(envio.clienteId)
    setFechaVencimiento(envio.fechaVencimiento)
    setNotas(envio.notas)
    setCategorias(envio.categorias)
    setOpciones(envio.opciones)
    setActiva(envio.activa)
  }, [modoEdicion, cargado, cotizacionExistente, grupoEdicion, opcionesGrupo, categoriasEnvio])

  // Al agregar una opción, cliente, vencimiento y notas vienen del envío y no se
  // editan. Con categorías, también el descuento y el IVA.
  useEffect(() => {
    if (modoAgregar && envioOrigen) {
      setClienteId(envioOrigen.cliente_id)
      setFechaVencimiento(envioOrigen.fecha_vencimiento || vencimientoPorDefecto())
      setNotas(envioOrigen.notas || '')
      if (envioOrigen.categoria_id) {
        setOpciones([opcionVacia(null, { descuentoPct: envioOrigen.descuento_pct, ivaPct: envioOrigen.iva_pct })])
      }
    }
  }, [modoAgregar, envioOrigen])

  // La configuración llega después del primer render: el IVA inicial de una
  // cotización nueva se ajusta una sola vez. Editar no lo toca (la cotización
  // tiene el suyo) y una opción nueva de un envío por categorías tampoco
  // (lleva el del envío).
  const ivaAplicado = useRef(false)
  useEffect(() => {
    if (ivaAplicado.current || cargandoConfig || modoEdicion) return
    if (modoAgregar && (!envioOrigen || envioOrigen.categoria_id)) return
    ivaAplicado.current = true
    setOpciones((prev) => prev.map((o) => ({ ...o, ivaPct: ivaDefecto })))
  }, [cargandoConfig, modoEdicion, modoAgregar, envioOrigen, ivaDefecto])

  // Cambios sin guardar: el estado actual comparado con el que había al cargar
  // (la cotización existente, o el formulario vacío). Lo usan los atajos de
  // teclado para preguntar antes de salir.
  const inicial = useMemo(() => {
    if (modoAgregar) {
      if (!envioOrigen) return null
      return JSON.stringify({
        clienteId: envioOrigen.cliente_id,
        fechaVencimiento: envioOrigen.fecha_vencimiento || fechaInicial,
        notas: envioOrigen.notas || '',
        categorias: [],
        opciones: [envioOrigen.categoria_id
          ? opcionVacia(null, { descuentoPct: envioOrigen.descuento_pct, ivaPct: envioOrigen.iva_pct })
          : opcionVacia(null, { descuentoPct: 0, ivaPct: ivaDefecto })],
      })
    }
    if (!modoEdicion) {
      return JSON.stringify({
        clienteId: '', fechaVencimiento: fechaInicial, notas: '', categorias: [],
        opciones: [opcionVacia(null, { descuentoPct: 0, ivaPct: ivaDefecto })],
      })
    }
    if (!cargado) return null
    return JSON.stringify({
      clienteId: cargado.clienteId,
      fechaVencimiento: cargado.fechaVencimiento,
      notas: cargado.notas,
      categorias: cargado.categorias,
      opciones: cargado.opciones,
    })
  }, [modoAgregar, envioOrigen, modoEdicion, cargado, fechaInicial, ivaDefecto])
  const actual = JSON.stringify({ clienteId, fechaVencimiento, notas, categorias, opciones })
  useCambiosSinGuardar(inicial !== null && actual !== inicial)

  const letras = letrasDeOpciones(opciones, categorias, cargado?.letrasUsadas ?? {})
  // Posición de la categoría que forma el número (COT-…-2A): la guardada, o
  // las siguientes para las nuevas. Al crear coincide con el índice.
  const ordenDe = (c: number) => {
    const guardado = categorias[c]?.orden
    if (guardado !== undefined) return guardado
    const nuevasAntes = categorias.slice(0, c).filter((cat) => cat.orden === undefined).length
    return (cargado?.ordenSiguiente ?? 0) + nuevasAntes
  }
  const codigoDe = (idx: number) => {
    const cat = opciones[idx].categoria
    return cat === null ? letras[idx] : codigoOpcion(ordenDe(cat), letras[idx])
  }

  const handleAgregarItem = (item: ItemCotizacion) => {
    actualizarActiva((o) => ({ ...o, items: [...o.items, item] }))
    toast({
      title: opciones.length > 1 || porCategoria
        ? `Producto agregado a la opción ${codigoDe(activa)}`
        : 'Producto agregado a la cotización',
    })
  }

  const handleUpdateItem = (idx: number, field: 'cantidad' | 'precio_unitario', value: number) => {
    actualizarActiva((o) => ({
      ...o,
      items: o.items.map((item, i) => {
        if (i !== idx) return item
        const updated = { ...item, [field]: value }
        updated.precio_total = updated.cantidad * updated.precio_unitario
        return updated
      }),
    }))
  }

  const handleRemoveItem = (idx: number) => {
    actualizarActiva((o) => ({ ...o, items: o.items.filter((_, i) => i !== idx) }))
    setEdicionItem(null)
  }

  const handleEditarItem = (idx: number) => {
    // Cada ítem se edita en el formulario que lo puede reconstruir: el configurador
    // necesita la referencia; el libre solo tiene texto y precio.
    setModo(items[idx].referencia_id ? 'referencia' : 'libre')
    setEdicionItem({ idx, item: items[idx] })
  }

  const handleActualizarItem = (idx: number, nuevo: ItemCotizacion) => {
    actualizarActiva((o) => ({
      ...o,
      items: o.items.map((it, i) => {
        if (i !== idx) return it
        // El configurador siempre devuelve cantidad 1 (la cantidad se ajusta en el panel),
        // así que ahí se conserva la del ítem. El formulario libre sí la trae editada.
        const cantidad = nuevo.referencia_id ? it.cantidad : nuevo.cantidad
        return { ...nuevo, cantidad, precio_total: cantidad * nuevo.precio_unitario }
      }),
    }))
    setEdicionItem(null)
    toast({ title: 'Ítem actualizado' })
  }

  // Cambiar de pestaña a mano abandona la edición en curso: el otro formulario no
  // sabría reconstruir ese ítem.
  const cambiarModo = (valor: string) => {
    setModo(valor as ModoItem)
    setEdicionItem(null)
  }

  // ── Opciones del envío ──
  const seleccionarOpcion = (idx: number) => {
    setActiva(idx)
    setEdicionItem(null)
  }

  const cuantasEn = (categoria: number | null) => opciones.filter((o) => o.categoria === categoria).length

  const agregarOpcionVacia = (categoria: number | null = opcion.categoria) => {
    if (cuantasEn(categoria) >= MAX_OPCIONES) return
    setOpciones((prev) => [...prev, opcionVacia(categoria, opcion)])
    seleccionarOpcion(opciones.length)
  }

  // Lo normal es cambiar solo el vidrio o el color: se parte de una copia.
  const duplicarOpcion = () => {
    if (cuantasEn(opcion.categoria) >= MAX_OPCIONES) return
    // La copia es una opción nueva: sin id ni letra guardada.
    setOpciones((prev) => [...prev, {
      ...structuredClone(prev[activa]), id: undefined, etiqueta: undefined, nombre: '', recomendada: false,
    }])
    seleccionarOpcion(opciones.length)
  }

  const eliminarOpcion = () => {
    if (opciones.length <= 1) return
    // La que queda activa es la anterior de la misma categoría, si la hay.
    const anteriores = opciones.slice(0, activa).map((o, i) => (o.categoria === opcion.categoria ? i : -1))
    const anterior = Math.max(...anteriores, -1)
    setOpciones((prev) => prev.filter((_, i) => i !== activa))
    seleccionarOpcion(Math.max(0, anterior === -1 ? activa - 1 : anterior))
  }

  const cambiarRecomendada = (valor: boolean) =>
    // Una recomendada por categoría (o por envío, si no está dividido).
    setOpciones((prev) => prev.map((o, i) => ({
      ...o,
      recomendada: i === activa ? valor : o.categoria === opcion.categoria ? (valor ? false : o.recomendada) : o.recomendada,
    })))

  // Las opciones que ya hay quedan en la primera categoría. Descuento e IVA
  // pasan a ser del envío: se toman los de la opción activa.
  const dividirPorCategorias = () => {
    setCategorias([categoriaVacia()])
    setOpciones((prev) => prev.map((o) => ({ ...o, categoria: 0, descuentoPct: opcion.descuentoPct, ivaPct: opcion.ivaPct })))
  }

  const quitarDivision = () => {
    setCategorias([])
    setOpciones((prev) => prev.map((o) => ({ ...o, categoria: null })))
  }

  const agregarCategoria = () => {
    setCategorias((prev) => [...prev, categoriaVacia()])
    setOpciones((prev) => [...prev, opcionVacia(categorias.length, opcion)])
    seleccionarOpcion(opciones.length)
  }

  const eliminarCategoria = (c: number) => {
    if (categorias.length <= 1) return
    const quedan = opciones
      .filter((o) => o.categoria !== c)
      .map((o) => ({ ...o, categoria: o.categoria !== null && o.categoria > c ? o.categoria - 1 : o.categoria }))
    setCategorias((prev) => prev.filter((_, i) => i !== c))
    setOpciones(quedan)
    seleccionarOpcion(0)
  }

  const cambiarCategoria = (c: number, cambio: Partial<CategoriaForm>) =>
    setCategorias((prev) => prev.map((cat, i) => (i === c ? { ...cat, ...cambio } : cat)))

  // Con categorías, descuento e IVA son del envío: cambian en todas las opciones.
  const cambiarDescuentoIva = (campo: 'descuentoPct' | 'ivaPct', valor: number) =>
    porCategoria
      ? setOpciones((prev) => prev.map((o) => ({ ...o, [campo]: valor })))
      : actualizarActiva((o) => ({ ...o, [campo]: valor }))

  const resumenOpciones: ResumenOpcion[] = opciones.map((o, i) => ({
    codigo: codigoDe(i),
    nombre: o.nombre,
    total: calcularTotales(o.items, o.descuentoPct, o.ivaPct).total,
    cantidadItems: o.items.length,
    categoria: o.categoria,
    recomendada: o.recomendada,
    guardada: !!o.id,
  }))

  const handleGuardar = async (estado: 'borrador' | 'enviada') => {
    if (!clienteId || !usuario) {
      toast({ title: 'Selecciona un cliente', variant: 'destructive' })
      return
    }
    const sinNombre = categorias.findIndex((c) => !c.nombre.trim())
    if (sinNombre !== -1) {
      toast({ title: `Ponle nombre a la categoría ${ordenDe(sinNombre) + 1} (p. ej. "Puerta principal")`, variant: 'destructive' })
      return
    }
    const vacia = opciones.findIndex((o) => o.items.length === 0)
    if (vacia !== -1) {
      toast({
        title: opciones.length > 1
          ? `La opción ${codigoDe(vacia)} no tiene productos: agrégale alguno o elimínala`
          : 'Agrega al menos un producto',
        variant: 'destructive',
      })
      seleccionarOpcion(vacia)
      return
    }
    if (!fechaVencimiento) {
      toast({ title: 'Indica la fecha de vencimiento de la cotización', variant: 'destructive' })
      return
    }
    try {
      if (modoEdicion && id && cargado) {
        // Se guarda el envío completo de una vez. Lo que vio el cliente ya no
        // vale: todo vuelve a borrador y hay que reenviarlo antes de cobrar.
        const guardada = await actualizarEnvio.mutateAsync({
          cotizacionId: id,
          cliente_id: clienteId,
          fecha_vencimiento: fechaVencimiento,
          notas: notas.trim() || null,
          categorias: categorias.map((c) => ({
            id: c.id ?? null,
            nombre: c.nombre.trim(),
            tipo: c.tipo,
            tipo_personalizado_id: c.tipoPersonalizadoId ?? null,
          })),
          opciones: opciones.map((o) => ({
            id: o.id ?? null,
            categoria: o.categoria,
            nombre: o.nombre,
            descuento_pct: o.descuentoPct,
            iva_pct: o.ivaPct,
            recomendada: o.recomendada,
            items: o.items,
          })),
        })
        const esEnvio = opciones.length > 1 || porCategoria || !!cotizacionExistente?.grupo_id
        const quitadas = cargado.ids.filter((guardadaId) => !opciones.some((o) => o.id === guardadaId)).length
        const titulo = esEnvio
          ? cargado.enviado ? 'Envío actualizado — vuelve a borrador, márcalo como enviado de nuevo' : 'Envío actualizado'
          : cargado.enviado ? 'Cotización actualizada — vuelve a borrador, márcala como enviada de nuevo' : 'Cotización actualizada'
        toast({
          title: titulo,
          description: quitadas > 0
            ? `${quitadas === 1 ? 'Una opción quedó anulada' : `${quitadas} opciones quedaron anuladas`} (conservan su número).`
            : undefined,
          variant: 'success',
        })
        navigate(`/cotizaciones/${guardada.id}`)
      } else if (modoAgregar && agregarA) {
        const nueva = await agregarOpcion.mutateAsync({
          origenId: agregarA,
          usuario_id: usuario.id,
          estado,
          opcion: {
            nombre: opcion.nombre,
            descuento_pct: opcion.descuentoPct,
            iva_pct: opcion.ivaPct,
            recomendada: opcion.recomendada,
            items: opcion.items,
          },
        })
        toast({ title: `Opción ${nueva.numero} agregada al envío`, variant: 'success' })
        navigate(`/cotizaciones/${nueva.id}`)
      } else {
        const creada = await crearCotizacion.mutateAsync({
          cliente_id: clienteId,
          usuario_id: usuario.id,
          estado,
          fecha_vencimiento: fechaVencimiento,
          notas: notas || undefined,
          categorias: porCategoria ? categorias : undefined,
          opciones: opciones.map((o) => ({
            nombre: o.nombre,
            descuento_pct: o.descuentoPct,
            iva_pct: o.ivaPct,
            categoria: o.categoria ?? undefined,
            recomendada: o.recomendada,
            items: o.items,
          })),
        })
        const sufijo = porCategoria
          ? ` con ${categorias.length} ${categorias.length === 1 ? 'categoría' : 'categorías'} y ${opciones.length} opciones`
          : opciones.length > 1 ? ` con ${opciones.length} opciones` : ''
        // El número lo asigna la base: se muestra para que el vendedor lo pueda dictar o buscar.
        const numero = numeroBaseEnvio(creada.numero)
        toast({
          title: (estado === 'borrador' ? `Borrador ${numero} guardado` : `Cotización ${numero} enviada`) + sufijo,
          variant: 'success',
        })
        navigate('/cotizaciones')
      }
    } catch (error) {
      toast({ title: mensajeError(error, 'Error al guardar cotización'), variant: 'destructive' })
    }
  }

  if (
    (modoEdicion && (cargandoCotizacion || (!!cotizacionExistente && !cargado))) ||
    (modoAgregar && cargandoOrigen) ||
    (!modoEdicion && cargandoConfig)
  ) {
    return <PageLoader />
  }

  if (modoAgregar && envioOrigen && envioOrigen.estado !== 'borrador' && envioOrigen.estado !== 'enviada') {
    return (
      <p className="py-20 text-center text-muted-foreground">
        Solo se agregan opciones a un envío en borrador o enviado.
      </p>
    )
  }

  // Encabezado de la opción. Al agregar una opción a un envío se trabaja solo
  // la nueva; al crear o editar, el envío completo.
  const trabajaUna = modoAgregar
  const esOpcionDeEnvio = modoAgregar || opciones.length > 1 || porCategoria || !!opcion.etiqueta
  const etiquetaOpcion = modoAgregar ? 'nueva' : esOpcionDeEnvio ? codigoDe(activa) : null
  // Cliente, vencimiento y notas son de todo el envío: no se cambian desde una
  // opción que se agrega sola.
  const datosEnvioBloqueados = modoAgregar

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <Tabs value={modo} onValueChange={cambiarModo}>
        <TabsList>
          <TabsTrigger value="referencia">Con referencia</TabsTrigger>
          <TabsTrigger value="libre">Ítem libre</TabsTrigger>
        </TabsList>
        <TabsContent value="referencia" className="mt-4">
          <ConfiguradorProducto
            onAgregarItem={handleAgregarItem}
            edicion={edicionItem}
            onActualizarItem={handleActualizarItem}
            onCancelarEdicion={() => setEdicionItem(null)}
          />
        </TabsContent>
        <TabsContent value="libre" className="mt-4">
          <ItemLibreForm
            onAgregarItem={handleAgregarItem}
            edicion={edicionItem}
            onActualizarItem={handleActualizarItem}
            onCancelarEdicion={() => setEdicionItem(null)}
          />
        </TabsContent>
      </Tabs>
      <PanelCotizacion
        clienteId={clienteId}
        onClienteChange={setClienteId}
        fechaVencimiento={fechaVencimiento}
        onFechaVencimientoChange={setFechaVencimiento}
        notas={notas}
        onNotasChange={setNotas}
        items={items}
        onUpdateItem={handleUpdateItem}
        onRemoveItem={handleRemoveItem}
        descuentoPct={opcion.descuentoPct}
        onDescuentoChange={(v) => cambiarDescuentoIva('descuentoPct', v)}
        ivaPct={opcion.ivaPct}
        onIvaChange={(v) => cambiarDescuentoIva('ivaPct', v)}
        // Sin IVA en la vidriería no se ofrece, salvo que la cotización ya lo tenga (para poder quitarlo).
        mostrarIva={(config?.usa_iva ?? true) || opcion.ivaPct > 0}
        onGuardar={handleGuardar}
        isPending={crearCotizacion.isPending || actualizarEnvio.isPending || agregarOpcion.isPending}
        modoEdicion={modoEdicion}
        editandoIdx={edicionItem?.idx ?? null}
        onEditarItem={handleEditarItem}
        tarjetaOpciones={trabajaUna ? undefined : (
          <OpcionesEnvioCard
            categorias={categorias}
            opciones={resumenOpciones}
            activa={activa}
            onSeleccionar={seleccionarOpcion}
            onAgregarVacia={(c) => agregarOpcionVacia(c ?? opcion.categoria)}
            onDuplicar={duplicarOpcion}
            onEliminar={eliminarOpcion}
            onDividir={dividirPorCategorias}
            onQuitarDivision={quitarDivision}
            onAgregarCategoria={agregarCategoria}
            onEliminarCategoria={eliminarCategoria}
            onCambiarCategoria={cambiarCategoria}
            numeroCategoria={(c) => ordenDe(c) + 1}
            edicion={modoEdicion}
          />
        )}
        etiquetaOpcion={etiquetaOpcion}
        pideNombre={esOpcionDeEnvio}
        cantidadOpciones={trabajaUna ? 1 : opciones.length}
        recomendada={opcion.recomendada}
        onRecomendadaChange={esOpcionDeEnvio ? cambiarRecomendada : undefined}
        descuentoDelEnvio={opcionSueltaConCategoria ? 'bloqueado' : porCategoria ? 'editable' : null}
        nombreOpcion={opcion.nombre}
        onNombreOpcionChange={(v) => actualizarActiva((o) => ({ ...o, nombre: v }))}
        datosEnvioBloqueados={datosEnvioBloqueados}
      />
    </div>
  )
}
