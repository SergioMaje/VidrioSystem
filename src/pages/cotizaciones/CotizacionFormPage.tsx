import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ConfiguradorProducto, type EdicionItem } from '@/pages/productos/ConfiguradorProducto'
import { ItemLibreForm } from '@/pages/productos/ItemLibreForm'
import { PanelCotizacion, type ItemCotizacion } from '@/pages/productos/PanelCotizacion'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useCrearCotizacion, useCotizacion, useActualizarCotizacion } from '@/hooks/useCotizaciones'
import { useReferencias } from '@/hooks/useReferencias'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { useCambiosSinGuardar } from '@/providers/cambiosSinGuardar'
import { PageLoader } from '@/components/shared/LoadingSpinner'
import { hoyBogota, sumarDias } from '@/lib/utils'

type ModoItem = 'referencia' | 'libre'

const vencimientoPorDefecto = () => sumarDias(hoyBogota(), 7)

export function CotizacionFormPage() {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const { usuario } = useAuth()
  const { toast } = useToast()
  const modoEdicion = !!id

  const { data: cotizacionExistente, isLoading: cargandoCotizacion } = useCotizacion(id || '')
  const { data: referencias, isLoading: cargandoReferencias } = useReferencias()
  const crearCotizacion = useCrearCotizacion()
  const actualizarCotizacion = useActualizarCotizacion()

  const [clienteId, setClienteId] = useState('')
  const [fechaInicial] = useState(vencimientoPorDefecto)
  const [fechaVencimiento, setFechaVencimiento] = useState(fechaInicial)
  const [notas, setNotas] = useState('')
  const [items, setItems] = useState<ItemCotizacion[]>([])
  const [descuentoPct, setDescuentoPct] = useState(0)
  const [ivaPct, setIvaPct] = useState(19)
  const [edicionItem, setEdicionItem] = useState<EdicionItem | null>(null)
  const [modo, setModo] = useState<ModoItem>('referencia')

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
      setDescuentoPct(cotizacionExistente.descuento_pct)
      setIvaPct(cotizacionExistente.iva_pct)
      setItems(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        cotizacionExistente.items.map(({ id, cotizacion_id, ...rest }) => rest)
      )
    }
  }, [modoEdicion, cotizacionExistente])

  // Cambios sin guardar: el estado actual comparado con el que había al cargar
  // (la cotización existente, o el formulario vacío). Lo usan los atajos de
  // teclado para preguntar antes de salir.
  const inicial = useMemo(() => {
    if (!modoEdicion) {
      return JSON.stringify({ clienteId: '', fechaVencimiento: fechaInicial, notas: '', descuentoPct: 0, ivaPct: 19, items: [] })
    }
    if (!cotizacionExistente) return null
    return JSON.stringify({
      clienteId: cotizacionExistente.cliente_id,
      fechaVencimiento: cotizacionExistente.fecha_vencimiento || fechaInicial,
      notas: cotizacionExistente.notas || '',
      descuentoPct: cotizacionExistente.descuento_pct,
      ivaPct: cotizacionExistente.iva_pct,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      items: cotizacionExistente.items.map(({ id, cotizacion_id, ...rest }) => rest),
    })
  }, [modoEdicion, cotizacionExistente, fechaInicial])
  const actual = JSON.stringify({ clienteId, fechaVencimiento, notas, descuentoPct, ivaPct, items })
  useCambiosSinGuardar(inicial !== null && actual !== inicial)

  const handleAgregarItem = (item: ItemCotizacion) => {
    setItems((prev) => [...prev, item])
    toast({ title: 'Producto agregado a la cotización' })
  }

  const handleUpdateItem = (idx: number, field: 'cantidad' | 'precio_unitario', value: number) => {
    setItems((prev) => prev.map((item, i) => {
      if (i !== idx) return item
      const updated = { ...item, [field]: value }
      updated.precio_total = updated.cantidad * updated.precio_unitario
      return updated
    }))
  }

  const handleRemoveItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx))
    setEdicionItem(null)
  }

  const handleEditarItem = (idx: number) => {
    // Cada ítem se edita en el formulario que lo puede reconstruir: el configurador
    // necesita la referencia; el libre solo tiene texto y precio.
    setModo(items[idx].referencia_id ? 'referencia' : 'libre')
    setEdicionItem({ idx, item: items[idx] })
  }

  const handleActualizarItem = (idx: number, nuevo: ItemCotizacion) => {
    setItems((prev) => prev.map((it, i) => {
      if (i !== idx) return it
      // El configurador siempre devuelve cantidad 1 (la cantidad se ajusta en el panel),
      // así que ahí se conserva la del ítem. El formulario libre sí la trae editada.
      const cantidad = nuevo.referencia_id ? it.cantidad : nuevo.cantidad
      return { ...nuevo, cantidad, precio_total: cantidad * nuevo.precio_unitario }
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

  const handleGuardar = async (estado: 'borrador' | 'enviada') => {
    if (!clienteId || !usuario) {
      toast({ title: 'Selecciona un cliente', variant: 'destructive' })
      return
    }
    if (items.length === 0) {
      toast({ title: 'Agrega al menos un producto', variant: 'destructive' })
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
          descuento_pct: descuentoPct,
          iva_pct: ivaPct,
          notas: notas || undefined,
          items,
        })
        toast({
          title: revierteABorrador
            ? 'Cotización actualizada — vuelve a borrador, márcala como enviada de nuevo'
            : 'Cotización actualizada',
          variant: 'success',
        })
        navigate(`/cotizaciones/${id}`)
      } else {
        await crearCotizacion.mutateAsync({
          cliente_id: clienteId,
          usuario_id: usuario.id,
          estado,
          fecha_vencimiento: fechaVencimiento,
          descuento_pct: descuentoPct,
          iva_pct: ivaPct,
          notas: notas || undefined,
          items,
        })
        toast({ title: estado === 'borrador' ? 'Borrador guardado' : 'Cotización enviada', variant: 'success' })
        navigate('/cotizaciones')
      }
    } catch {
      toast({ title: 'Error al guardar cotización', variant: 'destructive' })
    }
  }

  if (modoEdicion && cargandoCotizacion) {
    return <PageLoader />
  }

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
        descuentoPct={descuentoPct}
        onDescuentoChange={setDescuentoPct}
        ivaPct={ivaPct}
        onIvaChange={setIvaPct}
        onGuardar={handleGuardar}
        isPending={modoEdicion ? actualizarCotizacion.isPending : crearCotizacion.isPending}
        modoEdicion={modoEdicion}
        editandoIdx={edicionItem?.idx ?? null}
        onEditarItem={handleEditarItem}
      />
    </div>
  )
}
