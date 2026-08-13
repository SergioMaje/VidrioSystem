import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ConfiguradorProducto, type EdicionItem } from '@/pages/productos/ConfiguradorProducto'
import { PanelCotizacion, type ItemCotizacion } from '@/pages/productos/PanelCotizacion'
import { useCrearCotizacion, useCotizacion, useActualizarCotizacion } from '@/hooks/useCotizaciones'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { PageLoader } from '@/components/shared/LoadingSpinner'

const vencimientoPorDefecto = () => {
  const fecha = new Date()
  fecha.setDate(fecha.getDate() + 7)
  return fecha.toISOString().split('T')[0]
}

export function CotizacionFormPage() {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const { usuario } = useAuth()
  const { toast } = useToast()
  const modoEdicion = !!id

  const { data: cotizacionExistente, isLoading: cargandoCotizacion } = useCotizacion(id || '')
  const crearCotizacion = useCrearCotizacion()
  const actualizarCotizacion = useActualizarCotizacion()

  const [clienteId, setClienteId] = useState('')
  const [fechaVencimiento, setFechaVencimiento] = useState(vencimientoPorDefecto)
  const [notas, setNotas] = useState('')
  const [items, setItems] = useState<ItemCotizacion[]>([])
  const [descuentoPct, setDescuentoPct] = useState(0)
  const [ivaPct, setIvaPct] = useState(19)
  const [edicionItem, setEdicionItem] = useState<EdicionItem | null>(null)

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
    setEdicionItem({ idx, item: items[idx] })
  }

  const handleActualizarItem = (idx: number, nuevo: ItemCotizacion) => {
    setItems((prev) => prev.map((it, i) => (
      i === idx
        ? { ...nuevo, cantidad: it.cantidad, precio_total: it.cantidad * nuevo.precio_unitario }
        : it
    )))
    setEdicionItem(null)
    toast({ title: 'Ítem actualizado' })
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
        await actualizarCotizacion.mutateAsync({
          id,
          cliente_id: clienteId,
          estado: cotizacionExistente.estado,
          fecha_vencimiento: fechaVencimiento,
          descuento_pct: descuentoPct,
          iva_pct: ivaPct,
          notas: notas || undefined,
          items,
        })
        toast({ title: 'Cotización actualizada', variant: 'success' })
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
      <ConfiguradorProducto
        onAgregarItem={handleAgregarItem}
        edicion={edicionItem}
        onActualizarItem={handleActualizarItem}
        onCancelarEdicion={() => setEdicionItem(null)}
      />
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
