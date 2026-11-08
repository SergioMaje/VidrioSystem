import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ConfiguradorProducto, type EdicionItem } from '@/pages/productos/ConfiguradorProducto'
import { ItemLibreForm } from '@/pages/productos/ItemLibreForm'
import { PanelCotizacion, type ItemCotizacion, type ResumenOpcion } from '@/pages/productos/PanelCotizacion'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useCrearCotizacion, useCotizacion, useActualizarCotizacion, useAgregarOpcion } from '@/hooks/useCotizaciones'
import { useReferencias } from '@/hooks/useReferencias'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { useCambiosSinGuardar } from '@/providers/cambiosSinGuardar'
import { PageLoader } from '@/components/shared/LoadingSpinner'
import { calcularTotales, etiquetaDeIndice, MAX_OPCIONES } from '@/lib/cotizaciones'
import { hoyBogota, mensajeError, sumarDias } from '@/lib/utils'

type ModoItem = 'referencia' | 'libre'

/** Lo que cambia entre las opciones de un envío. Cliente, vencimiento y notas son comunes. */
type OpcionForm = {
  nombre: string
  items: ItemCotizacion[]
  descuentoPct: number
  ivaPct: number
}

const vencimientoPorDefecto = () => sumarDias(hoyBogota(), 7)
const opcionVacia = (): OpcionForm => ({ nombre: '', items: [], descuentoPct: 0, ivaPct: 19 })

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
  const [opciones, setOpciones] = useState<OpcionForm[]>(() => [opcionVacia()])
  const [activa, setActiva] = useState(0)
  const [edicionItem, setEdicionItem] = useState<EdicionItem | null>(null)
  const [modo, setModo] = useState<ModoItem>('referencia')

  const opcion = opciones[activa] ?? opciones[0]
  const items = opcion.items

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
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        items: cotizacionExistente.items.map(({ id, cotizacion_id, ...rest }) => rest),
      }])
      setActiva(0)
    }
  }, [modoEdicion, cotizacionExistente])

  // Al agregar una opción, cliente, vencimiento y notas vienen del envío y no se editan.
  useEffect(() => {
    if (modoAgregar && envioOrigen) {
      setClienteId(envioOrigen.cliente_id)
      setFechaVencimiento(envioOrigen.fecha_vencimiento || vencimientoPorDefecto())
      setNotas(envioOrigen.notas || '')
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
        opciones: [opcionVacia()],
      })
    }
    if (!modoEdicion) {
      return JSON.stringify({ clienteId: '', fechaVencimiento: fechaInicial, notas: '', opciones: [opcionVacia()] })
    }
    if (!cotizacionExistente) return null
    return JSON.stringify({
      clienteId: cotizacionExistente.cliente_id,
      fechaVencimiento: cotizacionExistente.fecha_vencimiento || fechaInicial,
      notas: cotizacionExistente.notas || '',
      opciones: [{
        nombre: cotizacionExistente.opcion_nombre ?? '',
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        items: cotizacionExistente.items.map(({ id, cotizacion_id, ...rest }) => rest),
        descuentoPct: cotizacionExistente.descuento_pct,
        ivaPct: cotizacionExistente.iva_pct,
      }],
    })
  }, [modoAgregar, envioOrigen, modoEdicion, cotizacionExistente, fechaInicial])
  const actual = JSON.stringify({ clienteId, fechaVencimiento, notas, opciones })
  useCambiosSinGuardar(inicial !== null && actual !== inicial)

  const handleAgregarItem = (item: ItemCotizacion) => {
    actualizarActiva((o) => ({ ...o, items: [...o.items, item] }))
    toast({ title: opciones.length > 1 ? `Producto agregado a la opción ${etiquetaDeIndice(activa)}` : 'Producto agregado a la cotización' })
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

  const agregarOpcionVacia = () => {
    if (opciones.length >= MAX_OPCIONES) return
    setOpciones((prev) => [...prev, opcionVacia()])
    seleccionarOpcion(opciones.length)
  }

  // Lo normal es cambiar solo el vidrio o el color: se parte de una copia.
  const duplicarOpcion = () => {
    if (opciones.length >= MAX_OPCIONES) return
    setOpciones((prev) => [...prev, { ...structuredClone(prev[activa]), nombre: '' }])
    seleccionarOpcion(opciones.length)
  }

  const eliminarOpcion = () => {
    if (opciones.length <= 1) return
    setOpciones((prev) => prev.filter((_, i) => i !== activa))
    seleccionarOpcion(Math.max(0, activa - 1))
  }

  const resumenOpciones: ResumenOpcion[] = opciones.map((o, i) => ({
    etiqueta: etiquetaDeIndice(i),
    nombre: o.nombre,
    total: calcularTotales(o.items, o.descuentoPct, o.ivaPct).total,
    cantidadItems: o.items.length,
  }))

  const handleGuardar = async (estado: 'borrador' | 'enviada') => {
    if (!clienteId || !usuario) {
      toast({ title: 'Selecciona un cliente', variant: 'destructive' })
      return
    }
    const vacia = opciones.findIndex((o) => o.items.length === 0)
    if (vacia !== -1) {
      toast({
        title: opciones.length > 1
          ? `La opción ${etiquetaDeIndice(vacia)} no tiene productos: agrégale alguno o elimínala`
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
          opcion: { nombre: opcion.nombre, descuento_pct: opcion.descuentoPct, iva_pct: opcion.ivaPct, items: opcion.items },
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
          opciones: opciones.map((o) => ({
            nombre: o.nombre,
            descuento_pct: o.descuentoPct,
            iva_pct: o.ivaPct,
            items: o.items,
          })),
        })
        const sufijo = opciones.length > 1 ? ` con ${opciones.length} opciones` : ''
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

  // Encabezado de la opción cuando se trabaja una sola: al editar una opción de
  // un envío, o al agregar una nueva.
  const etiquetaFija = modoEdicion
    ? cotizacionExistente?.opcion_etiqueta ?? null
    : modoAgregar
      ? 'nueva'
      : null

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
        onDescuentoChange={(v) => actualizarActiva((o) => ({ ...o, descuentoPct: v }))}
        ivaPct={opcion.ivaPct}
        onIvaChange={(v) => actualizarActiva((o) => ({ ...o, ivaPct: v }))}
        onGuardar={handleGuardar}
        isPending={crearCotizacion.isPending || actualizarCotizacion.isPending || agregarOpcion.isPending}
        modoEdicion={modoEdicion}
        editandoIdx={edicionItem?.idx ?? null}
        onEditarItem={handleEditarItem}
        opciones={modoEdicion || modoAgregar ? undefined : resumenOpciones}
        opcionActiva={activa}
        onSeleccionarOpcion={seleccionarOpcion}
        onAgregarOpcion={agregarOpcionVacia}
        onDuplicarOpcion={duplicarOpcion}
        onEliminarOpcion={eliminarOpcion}
        nombreOpcion={opcion.nombre}
        onNombreOpcionChange={(v) => actualizarActiva((o) => ({ ...o, nombre: v }))}
        etiquetaFija={etiquetaFija}
        datosEnvioBloqueados={modoAgregar}
      />
    </div>
  )
}
