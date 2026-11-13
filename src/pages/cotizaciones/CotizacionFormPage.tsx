import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ConfiguradorProducto, type EdicionItem } from '@/pages/productos/ConfiguradorProducto'
import { ItemLibreForm } from '@/pages/productos/ItemLibreForm'
import { PanelCotizacion, type ItemCotizacion } from '@/pages/productos/PanelCotizacion'
import { OpcionesEnvioCard, type CategoriaForm, type ResumenOpcion } from './OpcionesEnvioCard'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useCrearCotizacion, useCotizacion, useActualizarCotizacion, useAgregarOpcion } from '@/hooks/useCotizaciones'
import { useReferencias } from '@/hooks/useReferencias'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { useCambiosSinGuardar } from '@/providers/cambiosSinGuardar'
import { PageLoader } from '@/components/shared/LoadingSpinner'
import { calcularTotales, codigoOpcion, etiquetaDeIndice, MAX_OPCIONES } from '@/lib/cotizaciones'
import { hoyBogota, mensajeError, sumarDias } from '@/lib/utils'

type ModoItem = 'referencia' | 'libre'

/** Lo que cambia entre las opciones de un envío. Cliente, vencimiento y notas son comunes. */
type OpcionForm = {
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
  ivaPct: base?.ivaPct ?? 19,
  categoria,
  recomendada: false,
})
const categoriaVacia = (): CategoriaForm => ({ nombre: '', tipo: 'otro' })

/** Letra de cada opción: dentro de su categoría, o en todo el envío. */
function letrasDeOpciones(opciones: Pick<OpcionForm, 'categoria'>[]) {
  const contador = new Map<number | null, number>()
  return opciones.map((o) => {
    const n = contador.get(o.categoria) ?? 0
    contador.set(o.categoria, n + 1)
    return etiquetaDeIndice(n)
  })
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
  const crearCotizacion = useCrearCotizacion()
  const actualizarCotizacion = useActualizarCotizacion()
  const agregarOpcion = useAgregarOpcion()

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
  const opcionSueltaConCategoria = modoEdicion
    ? !!cotizacionExistente?.categoria_id
    : modoAgregar && !!envioOrigen?.categoria_id

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
    if (modoEdicion && cotizacionExistente) {
      setClienteId(cotizacionExistente.cliente_id)
      setFechaVencimiento(cotizacionExistente.fecha_vencimiento || vencimientoPorDefecto())
      setNotas(cotizacionExistente.notas || '')
      setOpciones([{
        nombre: cotizacionExistente.opcion_nombre ?? '',
        descuentoPct: cotizacionExistente.descuento_pct,
        ivaPct: cotizacionExistente.iva_pct,
        categoria: null,
        recomendada: cotizacionExistente.recomendada,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        items: cotizacionExistente.items.map(({ id, cotizacion_id, ...rest }) => rest),
      }])
      setActiva(0)
    }
  }, [modoEdicion, cotizacionExistente])

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
          : opcionVacia()],
      })
    }
    if (!modoEdicion) {
      return JSON.stringify({ clienteId: '', fechaVencimiento: fechaInicial, notas: '', categorias: [], opciones: [opcionVacia()] })
    }
    if (!cotizacionExistente) return null
    return JSON.stringify({
      clienteId: cotizacionExistente.cliente_id,
      fechaVencimiento: cotizacionExistente.fecha_vencimiento || fechaInicial,
      notas: cotizacionExistente.notas || '',
      categorias: [],
      opciones: [{
        nombre: cotizacionExistente.opcion_nombre ?? '',
        descuentoPct: cotizacionExistente.descuento_pct,
        ivaPct: cotizacionExistente.iva_pct,
        categoria: null,
        recomendada: cotizacionExistente.recomendada,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        items: cotizacionExistente.items.map(({ id, cotizacion_id, ...rest }) => rest),
      }],
    })
  }, [modoAgregar, envioOrigen, modoEdicion, cotizacionExistente, fechaInicial])
  const actual = JSON.stringify({ clienteId, fechaVencimiento, notas, categorias, opciones })
  useCambiosSinGuardar(inicial !== null && actual !== inicial)

  const letras = letrasDeOpciones(opciones)
  const codigoDe = (idx: number) => {
    const cat = opciones[idx].categoria
    return cat === null ? letras[idx] : codigoOpcion(cat, letras[idx])
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
    setOpciones((prev) => [...prev, { ...structuredClone(prev[activa]), nombre: '', recomendada: false }])
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
  }))

  const handleGuardar = async (estado: 'borrador' | 'enviada') => {
    if (!clienteId || !usuario) {
      toast({ title: 'Selecciona un cliente', variant: 'destructive' })
      return
    }
    const sinNombre = categorias.findIndex((c) => !c.nombre.trim())
    if (sinNombre !== -1) {
      toast({ title: `Ponle nombre a la categoría ${sinNombre + 1} (p. ej. "Puerta principal")`, variant: 'destructive' })
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
      if (modoEdicion && id && cotizacionExistente) {
        // Editar los ítems o precios invalida lo que ya vio el cliente: la cotización
        // vuelve a borrador y hay que reenviarla antes de poder cobrar el anticipo.
        const revierteABorrador = cotizacionExistente.estado === 'enviada'
        await actualizarCotizacion.mutateAsync({
          id,
          cliente_id: clienteId,
          estado: revierteABorrador ? 'borrador' : cotizacionExistente.estado,
          fecha_vencimiento: fechaVencimiento,
          descuento_pct: opcion.descuentoPct,
          iva_pct: opcion.ivaPct,
          notas: notas || undefined,
          opcion_nombre: cotizacionExistente.grupo_id ? opcion.nombre : undefined,
          recomendada: cotizacionExistente.grupo_id ? opcion.recomendada : undefined,
          items: opcion.items,
        })
        toast({
          title: revierteABorrador
            ? 'Cotización actualizada — vuelve a borrador, márcala como enviada de nuevo'
            : 'Cotización actualizada',
          variant: 'success',
        })
        navigate(`/cotizaciones/${id}`)
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
        toast({ title: `Opción ${nueva.opcion_etiqueta} agregada al envío`, variant: 'success' })
        navigate(`/cotizaciones/${nueva.id}`)
      } else {
        await crearCotizacion.mutateAsync({
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
        toast({ title: (estado === 'borrador' ? 'Borrador guardado' : 'Cotización enviada') + sufijo, variant: 'success' })
        navigate('/cotizaciones')
      }
    } catch (error) {
      toast({ title: mensajeError(error, 'Error al guardar cotización'), variant: 'destructive' })
    }
  }

  if ((modoEdicion && cargandoCotizacion) || (modoAgregar && cargandoOrigen)) {
    return <PageLoader />
  }

  if (modoAgregar && envioOrigen && envioOrigen.estado !== 'borrador' && envioOrigen.estado !== 'enviada') {
    return (
      <p className="py-20 text-center text-muted-foreground">
        Solo se agregan opciones a un envío en borrador o enviado.
      </p>
    )
  }

  // Encabezado de la opción. Al editar una opción de un envío, o al agregar una
  // nueva, se trabaja una sola.
  const trabajaUna = modoEdicion || modoAgregar
  const etiquetaOpcion = modoEdicion
    ? cotizacionExistente?.opcion_etiqueta ?? null
    : modoAgregar
      ? 'nueva'
      : opciones.length > 1 || porCategoria ? codigoDe(activa) : null
  const esOpcionDeEnvio = modoEdicion ? !!cotizacionExistente?.grupo_id : modoAgregar || opciones.length > 1 || porCategoria

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
        onGuardar={handleGuardar}
        isPending={crearCotizacion.isPending || actualizarCotizacion.isPending || agregarOpcion.isPending}
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
        datosEnvioBloqueados={modoAgregar}
      />
    </div>
  )
}
