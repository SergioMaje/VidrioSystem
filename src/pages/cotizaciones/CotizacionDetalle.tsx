import { useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, ShoppingCart, XCircle, Printer, AlertCircle, Pencil, Wallet, CheckCircle2, Send, ClipboardList, Ban, Layers, Plus, ChevronDown, ImageDown, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { RegistrarPagoDialog } from './RegistrarPagoDialog'
import { AnularVentaDialog, BadgeAnulada } from '@/pages/caja/AnularVentaDialog'
import { AnularCotizacionDialog } from './AnularCotizacionDialog'
import { TIPO_ANULACION_LABEL } from '@/lib/anulacion'
import { useCotizacion, useCambiarEstadoCotizacion, useOrdenDeCotizacion, useOpcionesDelGrupo } from '@/hooks/useCotizaciones'
import { useSaldoCotizacion, usePagosCotizacion } from '@/hooks/useVentasCaja'
import { useCuentasPagoEmpresa } from '@/hooks/useCuentasPagoEmpresa'
import { useConfiguracionEmpresa, useLogoEmpresaDataUri } from '@/hooks/useConfiguracionEmpresa'
import { useToast } from '@/hooks/useToast'
import { useAuth } from '@/hooks/useAuth'
import { esVentaAnulada, estaLiquidada, textoAnticipoSolicitado, METODO_PAGO_LABEL, TIPO_PAGO_LABEL } from '@/lib/pagos'
import { ESTADOS_COTIZACION_CONFIG, textoOpcion } from '@/lib/cotizaciones'
import { abrirYImprimir, descargarImagen, etiquetaDocumento, htmlCotizacion, htmlEnvio } from '@/lib/imprimirCotizacion'
import { AccionesRecibo } from '@/components/shared/AccionesRecibo'
import type { OrigenNavegacion } from '@/components/shared/EnlaceDocumento'
import { formatCantidad, formatCOP, formatFecha, formatFechaHora, mensajeError } from '@/lib/utils'
import { detalleMedidasPorLado, medidasDeItem } from '@/lib/produccion'
import { ESTADOS_ORDEN_CONFIG } from '@/lib/estadosOrden'
import type { Cliente, Venta } from '@/types/database'

const estadoConfig = ESTADOS_COTIZACION_CONFIG

export function CotizacionDetalle() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  // Si se llegó desde Caja o Reportes, la flecha vuelve allá y no a la lista.
  const origen = useLocation().state as OrigenNavegacion | null
  const { toast } = useToast()
  const { data: cotizacion, isLoading } = useCotizacion(id ?? '')
  const { data: saldoInfo } = useSaldoCotizacion(id)
  const { data: pagos } = usePagosCotizacion(id)
  const { data: orden } = useOrdenDeCotizacion(id)
  const { data: opcionesGrupo } = useOpcionesDelGrupo(cotizacion?.grupo_id)
  // Se cargan aqui y no dentro de imprimir(), que es sincrono y no puede esperar la query.
  const { data: cuentasPago } = useCuentasPagoEmpresa(true)
  const { data: empresa } = useConfiguracionEmpresa()
  const { data: logoEmpresa } = useLogoEmpresaDataUri()
  const cambiarEstado = useCambiarEstadoCotizacion()

  const [pagoOpen, setPagoOpen] = useState(false)
  const [aAnular, setAAnular] = useState<Venta | null>(null)
  const [anularCotizacionOpen, setAnularCotizacionOpen] = useState(false)
  const [descargando, setDescargando] = useState(false)
  const { usuario } = useAuth()
  // Cosmético: la regla de que solo un admin anula vive en los RPC anular_venta
  // y anular_cotizacion.
  const esAdmin = usuario?.rol === 'admin'

  const handleMarcarEnviada = async () => {
    if (!id) return
    try {
      await cambiarEstado.mutateAsync({ id, estado: 'enviada', grupoId: cotizacion?.grupo_id })
      toast({ title: cotizacion?.grupo_id ? 'Envío marcado como enviado' : 'Cotización marcada como enviada', variant: 'success' })
    } catch {
      toast({ title: 'Error al actualizar estado', variant: 'destructive' })
    }
  }

  const handleRechazar = async () => {
    if (!id) return
    try {
      await cambiarEstado.mutateAsync({ id, estado: 'rechazada', grupoId: cotizacion?.grupo_id })
      toast({ title: cotizacion?.grupo_id ? 'Envío rechazado: todas sus opciones abiertas' : 'Cotización rechazada', variant: 'success' })
    } catch {
      toast({ title: 'Error al actualizar estado', variant: 'destructive' })
    }
  }

  const contextoImpresion = () => ({ empresa, logo: logoEmpresa, cuentas: cuentasPago ?? [] })

  // El mismo HTML sirve para imprimir (o guardar como PDF) y para la imagen.
  const htmlEstaCotizacion = () => cotizacion && htmlCotizacion(
    cotizacion,
    { abonado: saldoInfo?.total_abonado ?? 0, saldo: saldoInfo?.saldo ?? cotizacion.total },
    contextoImpresion(),
  )

  const imprimir = () => {
    const html = htmlEstaCotizacion()
    if (html) abrirYImprimir(html)
  }

  // Si el cliente ya eligió, las descartadas no se vuelven a ofrecer.
  const opcionesImprimibles = (opcionesGrupo ?? []).filter((o) =>
    o.estado !== 'anulada' &&
    !(o.estado === 'descartada' && opcionesGrupo!.some((x) => x.estado === 'vendida'))
  )

  const htmlDelEnvio = () =>
    cotizacion && opcionesImprimibles.length > 0
      ? htmlEnvio(opcionesImprimibles, cotizacion.cliente as Cliente | undefined, contextoImpresion())
      : null

  const imprimirEnvio = () => {
    const html = htmlDelEnvio()
    if (html) abrirYImprimir(html)
  }

  const descargar = async (html: string | null | undefined, nombreArchivo: string) => {
    if (!html) return
    setDescargando(true)
    try {
      await descargarImagen(html, nombreArchivo)
    } catch (err) {
      toast({ title: mensajeError(err, 'No se pudo descargar la imagen'), variant: 'destructive' })
    } finally {
      setDescargando(false)
    }
  }

  if (isLoading) return <LoadingSpinner className="py-20" />
  if (!cotizacion) return <p className="text-center text-muted-foreground">Cotización no encontrada</p>

  const cliente = cotizacion.cliente as Cliente | undefined
  const cfg = estadoConfig[cotizacion.estado]
  const abonado = saldoInfo?.total_abonado ?? 0
  const saldo = saldoInfo?.saldo ?? cotizacion.total
  const pctAbonado = saldoInfo?.pct_abonado ?? 0
  const anulada = cotizacion.estado === 'anulada'
  // Una anulada no tiene nada vigente: su saldo no es una deuda del cliente.
  const liquidada = !anulada && estaLiquidada(saldo)
  // Ni una anulada ni una descartada le piden anticipo al cliente.
  const pctAnticipo = anulada || cotizacion.estado === 'descartada' ? null : empresa?.anticipo_solicitado_pct
  const opcion = textoOpcion(cotizacion)
  const hermanas = (opcionesGrupo ?? []).filter((o) => o.id !== cotizacion.id)
  const elegida = (opcionesGrupo ?? []).find((o) => o.estado === 'vendida')
  // Las que el RPC descartará al cobrar el anticipo de esta.
  const aDescartar = hermanas
    .filter((o) => ['borrador', 'enviada', 'vencida', 'aprobada'].includes(o.estado))
    .map((o) => o.opcion_etiqueta ?? '')
  const abierta = cotizacion.estado === 'borrador' || cotizacion.estado === 'enviada'
  const envioCompleto = opcionesImprimibles.length > 1
  // El envío se nombra por su número base: COT-123-B → COT-123.
  const numeroEnvio = cotizacion.numero.replace(/-[A-Z]$/, '')

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(origen?.desde ?? '/cotizaciones')}
          title={origen ? `Volver a ${origen.desdeEtiqueta}` : 'Volver a cotizaciones'}
          aria-label={origen ? `Volver a ${origen.desdeEtiqueta}` : 'Volver a cotizaciones'}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h2 className="text-xl font-bold">{cotizacion.numero}</h2>
          <p className="text-sm text-muted-foreground">
            {opcion && (
              <span className="font-medium text-foreground">
                {opcion}
                {opcionesGrupo && ` (de ${opcionesGrupo.length})`} ·{' '}
              </span>
            )}
            Creada el {formatFechaHora(cotizacion.created_at)}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={descargando}>
              {descargando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
              {descargando ? 'Generando imagen…' : 'Imprimir / Descargar'}
              <ChevronDown className="ml-1 h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {envioCompleto ? (
              <>
                <DropdownMenuLabel>Todo el envío ({opcionesImprimibles.length} opciones)</DropdownMenuLabel>
                <DropdownMenuItem onClick={imprimirEnvio}>
                  <Printer className="mr-2 h-4 w-4" />
                  Imprimir / PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => descargar(htmlDelEnvio(), `Cotizacion-${numeroEnvio}`)}>
                  <ImageDown className="mr-2 h-4 w-4" />
                  Descargar imagen
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Solo la opción {cotizacion.opcion_etiqueta}</DropdownMenuLabel>
              </>
            ) : null}
            <DropdownMenuItem onClick={imprimir}>
              <Printer className="mr-2 h-4 w-4" />
              Imprimir / PDF
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => descargar(htmlEstaCotizacion(), `Cotizacion-${cotizacion.numero}`)}>
              <ImageDown className="mr-2 h-4 w-4" />
              Descargar imagen
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Badge variant={cfg.variant} className={anulada ? 'px-3 py-1 text-sm' : undefined}>{cfg.label}</Badge>
      </div>

      {cotizacion.estado === 'descartada' && (
        <div className="flex items-start gap-2 rounded-md border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          <Layers className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {elegida ? (
              <>
                El cliente eligió la{' '}
                <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => navigate(`/cotizaciones/${elegida.id}`, { state: origen })}>
                  {textoOpcion(elegida)} ({elegida.numero})
                </button>
                . Esta opción quedó descartada.
              </>
            ) : (
              'El cliente eligió otra opción de este envío y esta quedó descartada.'
            )}
          </p>
        </div>
      )}

      {opcionesGrupo && opcionesGrupo.length > 1 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4" />
              Opciones de este envío
            </CardTitle>
            {abierta && (
              <Button variant="outline" size="sm" onClick={() => navigate(`/cotizaciones/nueva?agregarA=${cotizacion.id}`)}>
                <Plus className="mr-2 h-4 w-4" />
                Agregar opción
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {opcionesGrupo.map((o) => {
                const actual = o.id === cotizacion.id
                const cfgOpcion = estadoConfig[o.estado]
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      disabled={actual}
                      onClick={() => navigate(`/cotizaciones/${o.id}`, { state: origen })}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                        actual ? 'bg-primary/5' : 'hover:bg-muted/40'
                      }`}
                    >
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        actual ? 'bg-primary text-primary-foreground' : 'bg-muted'
                      }`}>
                        {o.opcion_etiqueta}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className={actual ? 'font-medium' : ''}>{o.opcion_nombre || `Opción ${o.opcion_etiqueta}`}</span>
                        <span className="block font-mono text-xs text-muted-foreground">{o.numero}</span>
                      </span>
                      <span className="font-mono">{formatCOP(o.total)}</span>
                      <Badge variant={cfgOpcion.variant}>{cfgOpcion.label}</Badge>
                    </button>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {anulada && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <Ban className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-0.5">
            <p className="font-semibold">
              Cotización anulada
              {cotizacion.anulado_at && ` el ${formatFechaHora(cotizacion.anulado_at)}`}
              {cotizacion.anulado_por_usuario &&
                ` por ${cotizacion.anulado_por_usuario.nombre} ${cotizacion.anulado_por_usuario.apellido}`}
            </p>
            {cotizacion.tipo_anulacion && (
              <p>
                <span className="font-medium">Motivo:</span> {TIPO_ANULACION_LABEL[cotizacion.tipo_anulacion]}
                {cotizacion.motivo_anulacion && ` · ${cotizacion.motivo_anulacion}`}
              </p>
            )}
            <p className="text-xs opacity-80">
              Sus cobros quedaron anulados con su reverso en caja. Ya no se le pueden registrar cobros ni editarla.
            </p>
          </div>
        </div>
      )}

      {esAdmin && cotizacion.estado === 'vendida' && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" className="text-destructive" onClick={() => setAnularCotizacionOpen(true)}>
            <Ban className="mr-2 h-4 w-4" />
            Anular cotización
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Cliente</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="font-medium">{cliente ? `${cliente.nombre} ${cliente.apellido}` : '—'}</p>
            {cliente?.empresa && <p className="text-muted-foreground">{cliente.empresa}</p>}
            {cliente?.documento && <p className="text-muted-foreground">{etiquetaDocumento(cliente.tipo)} {cliente.documento}</p>}
            {cliente?.telefono && <p>{cliente.telefono}</p>}
            {cliente?.email && <p className="text-muted-foreground">{cliente.email}</p>}
            {cliente?.direccion && <p className="text-muted-foreground">{cliente.direccion}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Detalles</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Creación:</span><span>{formatFechaHora(cotizacion.created_at)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Emisión:</span><span>{formatFecha(cotizacion.fecha_emision)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Vencimiento:</span><span>{cotizacion.fecha_vencimiento ? formatFecha(cotizacion.fecha_vencimiento) : '—'}</span></div>
            {cotizacion.fecha_aprobacion && (
              <div className="flex justify-between"><span className="text-muted-foreground">Aprobación:</span><span>{formatFechaHora(cotizacion.fecha_aprobacion)}</span></div>
            )}
            <div className="flex justify-between"><span className="text-muted-foreground">IVA:</span><span>{cotizacion.iva_pct}%</span></div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Items</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase text-muted-foreground">
                <th className="px-4 py-3">Descripción</th>
                <th className="px-4 py-3 text-right">Cant.</th>
                <th className="px-4 py-3 text-right">Precio unit.</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {cotizacion.items?.map((item) => (
                <tr key={item.id} className="border-b">
                  <td className="px-4 py-3">
                    <p>{item.descripcion}</p>
                    {item.ancho_cm && item.alto_cm && <p className="text-xs text-muted-foreground">{item.ancho_cm}×{item.alto_cm}cm</p>}
                    {detalleMedidasPorLado(medidasDeItem(item)) && (
                      <p className="text-xs text-amber-700">{detalleMedidasPorLado(medidasDeItem(item))}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{formatCantidad(item.cantidad)}</td>
                  <td className="px-4 py-3 text-right font-mono">{formatCOP(item.precio_unitario)}</td>
                  <td className="px-4 py-3 text-right font-mono font-medium">{formatCOP(item.precio_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="space-y-2 p-4">
            <div className="flex justify-between text-sm"><span>Subtotal</span><span className="font-mono">{formatCOP(cotizacion.subtotal)}</span></div>
            {cotizacion.descuento_pct > 0 && <div className="flex justify-between text-sm text-muted-foreground"><span>Descuento ({cotizacion.descuento_pct}%)</span><span className="font-mono">-{formatCOP(cotizacion.subtotal * cotizacion.descuento_pct / 100)}</span></div>}
            <div className="flex justify-between text-sm"><span>IVA ({cotizacion.iva_pct}%)</span><span className="font-mono">{formatCOP(cotizacion.total - cotizacion.subtotal * (1 - cotizacion.descuento_pct / 100))}</span></div>
            <Separator />
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <span className="text-lg font-bold">Total</span>
              {/* El anticipo va pegado al total: en pantallas angostas baja de línea sin separarse de él. */}
              <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
                {pctAnticipo && (
                  <p className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-1 text-sm font-medium text-primary">
                    <Wallet className="h-4 w-4 shrink-0" />
                    {textoAnticipoSolicitado(pctAnticipo, cotizacion.total)}
                  </p>
                )}
                <span className="font-mono text-lg font-bold text-primary">{formatCOP(cotizacion.total)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {orden && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Orden de trabajo</CardTitle>
            <Button variant="outline" size="sm" onClick={() => navigate(`/ordenes/${orden.id}`)}>
              <ClipboardList className="mr-2 h-4 w-4" />
              Ver orden
            </Button>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-mono font-medium">{orden.numero}</span>
            <Badge variant={ESTADOS_ORDEN_CONFIG[orden.estado].variant}>{ESTADOS_ORDEN_CONFIG[orden.estado].label}</Badge>
            {orden.fecha_entrega_estimada && (
              <span className="text-muted-foreground">Entrega estimada: {formatFecha(orden.fecha_entrega_estimada)}</span>
            )}
          </CardContent>
        </Card>
      )}

      {/* 'aprobada' viene de un flujo anterior que creaba la orden sin cobrar:
          esas cotizaciones también necesitan poder cobrar su anticipo aquí. */}
      {(cotizacion.estado === 'vendida' || cotizacion.estado === 'aprobada' || anulada) && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Pagos</CardTitle>
            {anulada ? (
              <Badge variant="destructive">Anulada</Badge>
            ) : liquidada ? (
              <Badge variant="success" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Pagada completa
              </Badge>
            ) : (
              <Button size="sm" onClick={() => setPagoOpen(true)}>
                <Wallet className="mr-2 h-4 w-4" />
                {abonado > 0 ? 'Registrar abono' : 'Registrar anticipo'}
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-all ${liquidada ? 'bg-emerald-500' : 'bg-primary'}`}
                  style={{ width: `${Math.min(100, pctAbonado)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">{Math.round(pctAbonado)}% del total abonado</p>
            </div>

            {pagos && pagos.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs font-medium uppercase text-muted-foreground">
                    <th className="py-2">Recibo</th>
                    <th className="py-2">Fecha</th>
                    <th className="py-2">Tipo</th>
                    <th className="py-2">Método</th>
                    <th className="py-2">Recibió</th>
                    <th className="py-2 text-right">Monto</th>
                    {esAdmin && <th className="py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {pagos.map((pago) => {
                    const anulada = esVentaAnulada(pago)
                    return (
                    <tr
                      key={pago.id}
                      className={`border-b last:border-0 ${anulada ? 'text-muted-foreground' : ''}`}
                    >
                      <td className="py-2">
                        {pago.numero_recibo ? (
                          <AccionesRecibo ventaId={pago.id} numero={pago.numero_recibo} anulado={anulada} />
                        ) : (
                          // Cobro anterior a los recibos: no tiene número.
                          <span className="text-muted-foreground" title="Cobro registrado antes de los recibos de pago">—</span>
                        )}
                      </td>
                      <td className={`py-2 ${anulada ? 'line-through' : ''}`}>{formatFechaHora(pago.created_at)}</td>
                      <td className="py-2">
                        <span className={anulada ? 'line-through' : ''}>{TIPO_PAGO_LABEL[pago.tipo]}</span>
                        {pago.autorizado_por && (
                          <span className="ml-1 text-xs text-amber-700" title={pago.motivo_autorizacion ?? ''}>
                            (autorizado)
                          </span>
                        )}
                      </td>
                      <td className="py-2">{METODO_PAGO_LABEL[pago.metodo_pago]}</td>
                      <td className="py-2 text-muted-foreground">
                        {pago.usuario ? `${pago.usuario.nombre} ${pago.usuario.apellido}` : '—'}
                      </td>
                      <td className={`py-2 text-right font-mono ${anulada ? 'line-through' : ''}`}>
                        {formatCOP(pago.monto)}
                      </td>
                      {esAdmin && (
                        <td className="py-2 text-right">
                          {!anulada && (
                            <Button size="sm" variant="ghost" onClick={() => setAAnular(pago)}>
                              Anular
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
            {pagos
              ?.filter(esVentaAnulada)
              .map((pago) => (
                <p key={pago.id} className="text-xs text-muted-foreground">
                  <BadgeAnulada motivo={pago.motivo_anulacion} /> {formatCOP(pago.monto)} del{' '}
                  {formatFechaHora(pago.created_at)}: {pago.motivo_anulacion}
                  {pago.anulado_por_usuario &&
                    ` — ${pago.anulado_por_usuario.nombre} ${pago.anulado_por_usuario.apellido}`}
                  {pago.anulado_at && `, ${formatFechaHora(pago.anulado_at)}`}
                </p>
              ))}

            <div className="space-y-1 border-t pt-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Abonado</span>
                <span className="font-mono">{formatCOP(abonado)}</span>
              </div>
              {anulada ? (
                <div className="flex justify-between font-bold text-muted-foreground">
                  <span>Saldo pendiente</span>
                  <span>Anulada · {formatCOP(0)} vigente</span>
                </div>
              ) : (
                <div className="flex justify-between font-bold">
                  <span>Saldo pendiente</span>
                  <span className={`font-mono ${liquidada ? 'text-emerald-600' : 'text-destructive'}`}>
                    {formatCOP(saldo)}
                  </span>
                </div>
              )}
            </div>

            {!liquidada && !anulada && (
              <p className="text-xs text-muted-foreground">
                {abonado > 0
                  ? 'La producción ya puede avanzar. El cliente tiene plazo hasta el día de la entrega para abonar el saldo: la orden no se entregará mientras quede pendiente.'
                  : 'La producción no puede iniciar hasta cobrar el anticipo.'}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {cotizacion.notas && (
        <Card>
          <CardHeader><CardTitle className="text-base">Notas</CardTitle></CardHeader>
          <CardContent><p className="text-sm text-muted-foreground">{cotizacion.notas}</p></CardContent>
        </Card>
      )}

      {cotizacion.estado === 'vencida' && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            Esta cotización venció el {cotizacion.fecha_vencimiento ? formatFecha(cotizacion.fecha_vencimiento) : '—'} sin ser aprobada.
            Los precios pudieron cambiar — crea una nueva cotización para este cliente en lugar de venderla.
          </div>
        </div>
      )}

      {/* El anticipo solo se cobra sobre una cotización que ya se le pasó al cliente:
          desde 'borrador' el paso obligado es marcarla como enviada. */}
      {(cotizacion.estado === 'borrador' || cotizacion.estado === 'enviada') && (
        <div className="space-y-2">
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => navigate(`/cotizaciones/${id}/editar`)}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Editar
            </Button>
            {!cotizacion.grupo_id && (
              <Button
                variant="outline"
                onClick={() => navigate(`/cotizaciones/nueva?agregarA=${cotizacion.id}`)}
                title="Crea otra opción para que el cliente compare; esta pasa a ser la opción A"
              >
                <Plus className="mr-2 h-4 w-4" />
                Agregar opción
              </Button>
            )}
            {cotizacion.estado === 'borrador' ? (
              <Button
                className="flex-1"
                onClick={handleMarcarEnviada}
                disabled={cambiarEstado.isPending}
              >
                <Send className="mr-2 h-4 w-4" />
                {cotizacion.grupo_id ? 'Marcar envío como enviado' : 'Marcar como enviada'}
              </Button>
            ) : (
              <Button
                className="flex-1"
                onClick={() => setPagoOpen(true)}
                disabled={cambiarEstado.isPending}
              >
                <ShoppingCart className="mr-2 h-4 w-4" />
                {cotizacion.grupo_id ? 'Cliente eligió esta opción — Registrar anticipo' : 'Cliente aprobó — Registrar anticipo'}
              </Button>
            )}
            <Button
              variant="destructive"
              onClick={handleRechazar}
              disabled={cambiarEstado.isPending}
            >
              <XCircle className="mr-2 h-4 w-4" />
              {cotizacion.grupo_id ? 'Rechazar envío' : 'Rechazar'}
            </Button>
          </div>
          {cotizacion.estado === 'borrador' && (
            <p className="text-xs text-muted-foreground">
              {cotizacion.grupo_id
                ? 'Marca el envío como enviado al cliente para poder registrar el anticipo de la opción que elija.'
                : 'Marca la cotización como enviada al cliente para poder registrar el anticipo.'}
            </p>
          )}
        </div>
      )}

      <RegistrarPagoDialog
        cotizacion={cotizacion}
        open={pagoOpen}
        onOpenChange={setPagoOpen}
        opcionesADescartar={aDescartar}
      />
      <AnularVentaDialog venta={aAnular} documento={cotizacion.numero} onClose={() => setAAnular(null)} />
      <AnularCotizacionDialog
        cotizacion={cotizacion}
        open={anularCotizacionOpen}
        onClose={() => setAnularCotizacionOpen(false)}
      />
    </div>
  )
}
