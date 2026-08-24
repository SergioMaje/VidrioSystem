import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ShoppingCart, XCircle, Printer, AlertCircle, Pencil, Wallet, CheckCircle2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { RegistrarPagoDialog } from './RegistrarPagoDialog'
import { useCotizacion, useCambiarEstadoCotizacion } from '@/hooks/useCotizaciones'
import { useSaldoCotizacion, usePagosCotizacion } from '@/hooks/useVentasCaja'
import { useCuentasPagoEmpresa } from '@/hooks/useCuentasPagoEmpresa'
import { useToast } from '@/hooks/useToast'
import { estaLiquidada, TIPO_PAGO_LABEL } from '@/lib/pagos'
import { formatCOP, formatFecha, formatFechaHora } from '@/lib/utils'
import type { Cliente, Cotizacion, CotizacionItem, Venta } from '@/types/database'

const METODO_LABEL: Record<Venta['metodo_pago'], string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
}

const estadoConfig: Record<Cotizacion['estado'], { label: string; variant: 'default' | 'secondary' | 'destructive' | 'warning' | 'success' | 'outline' }> = {
  borrador: { label: 'Borrador', variant: 'secondary' },
  enviada: { label: 'Enviada', variant: 'default' },
  aprobada: { label: 'Aprobada', variant: 'success' },
  rechazada: { label: 'Rechazada', variant: 'destructive' },
  vencida: { label: 'Vencida', variant: 'warning' },
  vendida: { label: 'Vendida', variant: 'outline' },
}

const escapar = (texto: string) =>
  texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Una empresa se identifica con NIT; una persona natural, con cédula. */
const etiquetaDocumento = (tipo?: Cliente['tipo']) => (tipo === 'juridico' ? 'NIT' : 'C.C.')

export function CotizacionDetalle() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { data: cotizacion, isLoading } = useCotizacion(id ?? '')
  const { data: saldoInfo } = useSaldoCotizacion(id)
  const { data: pagos } = usePagosCotizacion(id)
  // Se cargan aqui y no dentro de imprimir(), que es sincrono y no puede esperar la query.
  const { data: cuentasPago } = useCuentasPagoEmpresa(true)
  const cambiarEstado = useCambiarEstadoCotizacion()

  const [pagoDialog, setPagoDialog] = useState<'anticipo' | 'abono' | null>(null)

  const handleRechazar = async () => {
    if (!id) return
    try {
      await cambiarEstado.mutateAsync({ id, estado: 'rechazada' })
      toast({ title: 'Cotización rechazada', variant: 'success' })
    } catch {
      toast({ title: 'Error al actualizar estado', variant: 'destructive' })
    }
  }

  const imprimir = () => {
    if (!cotizacion) return
    const cli = cotizacion.cliente as Cliente | undefined
    // A una empresa se le factura por su razon social; el contacto va como dato aparte.
    const razonSocial = cli ? (cli.empresa ?? `${cli.nombre} ${cli.apellido}`) : '—'
    const items = (cotizacion.items ?? []) as CotizacionItem[]
    const descuentoValor = cotizacion.subtotal * (cotizacion.descuento_pct / 100)
    const ivaValor = cotizacion.total - cotizacion.subtotal * (1 - cotizacion.descuento_pct / 100)
    const abonadoImpreso = saldoInfo?.total_abonado ?? 0
    const saldoImpreso = saldoInfo?.saldo ?? cotizacion.total

    const filasHtml = items.map((item) => `
      <tr>
        <td>
          ${escapar(item.descripcion)}${item.ancho_cm && item.alto_cm ? ` <span class="dim">(${item.ancho_cm} × ${item.alto_cm} cm)</span>` : ''}
        </td>
        <td class="right">${item.cantidad}</td>
        <td class="right">${formatCOP(item.precio_unitario)}</td>
        <td class="right"><strong>${formatCOP(item.precio_total)}</strong></td>
      </tr>`).join('')

    const cuentas = cuentasPago ?? []
    const cuentasHtml = cuentas.length === 0 ? '' : `
      <div class="caja">
        <h2>Medios de pago</h2>
        ${cuentas.map((cuenta) => `
        <div class="cuenta">
          <span class="cuenta-banco">${escapar(cuenta.banco)} · ${escapar(cuenta.tipo_cuenta)}</span>
          <span class="cuenta-num">${escapar(cuenta.numero_cuenta)}</span>
          <div class="cuenta-tit">${escapar(cuenta.titular)}</div>
        </div>`).join('')}
      </div>`

    const notasHtml = !cotizacion.notas ? '' : `
      <div class="caja"><h2>Notas</h2>${escapar(cotizacion.notas).replace(/\n/g, '<br/>')}</div>`

    // Si solo hay uno de los dos bloques, ocupa el ancho completo en vez de dejar un hueco.
    const pieHtml = !notasHtml && !cuentasHtml ? '' :
      `<div class="pie${notasHtml && cuentasHtml ? '' : ' una'}">${notasHtml}${cuentasHtml}</div>`

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>Cotización ${cotizacion.numero}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.35;color:#000;padding:1.4cm}
    .membrete{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;
      padding-bottom:8px;border-bottom:1.5px solid #000;margin-bottom:12px}
    .marca{font-size:17px;font-weight:700;letter-spacing:-.01em}
    .marca span{display:block;font-size:10px;font-weight:400;color:#555;letter-spacing:0}
    .doc{text-align:right}
    .doc h1{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#555}
    .doc .numero{font-size:17px;font-weight:700}
    .doc .fecha{font-size:10px;color:#555}
    /* Dos bloques independientes: los datos del cliente no se mezclan con los del documento. */
    .bloques{display:grid;grid-template-columns:1.4fr 1fr;gap:20px;margin-bottom:12px}
    .bloque h2{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;
      color:#000;padding-bottom:3px;border-bottom:1px solid #999;margin-bottom:5px}
    /* Etiqueta en columna fija: un valor largo envuelve dentro de su celda y nunca la invade. */
    .campos{display:grid;grid-template-columns:auto 1fr;gap:2px 10px}
    .campos dt{color:#555;white-space:nowrap}
    .campos dd{font-weight:600;word-break:break-word}
    .razon{font-weight:700;font-size:12px;margin-bottom:3px}
    table{width:100%;border-collapse:collapse}
    th{text-align:left;padding:4px 6px;font-size:9px;text-transform:uppercase;
      letter-spacing:.05em;border-bottom:1.5px solid #000;border-top:1px solid #000}
    td{padding:4px 6px;border-bottom:1px solid #ddd;vertical-align:top}
    tr{page-break-inside:avoid}
    .right{text-align:right;white-space:nowrap}
    /* Las medidas van junto a la descripcion: una linea menos por item. */
    .dim{color:#555;font-size:10px}
    .totales{margin-top:8px;margin-left:auto;width:230px}
    .totales .row{display:flex;justify-content:space-between;padding:2px 0}
    /* Doble filete sobre el total: convencion de documento contable. */
    .totales .total{border-top:3px double #000;margin-top:3px;padding-top:5px;font-weight:700;font-size:13px}
    .totales .abonado{margin-top:3px}
    .totales .saldo{border-top:1px solid #999;margin-top:2px;padding-top:3px;font-weight:700}
    /* Notas y cuentas comparten fila: ahorra un bloque completo de alto. */
    .pie{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;align-items:start}
    .pie.una{grid-template-columns:1fr}
    .caja{border:1px solid #999;padding:6px 9px;page-break-inside:avoid}
    .caja h2{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
      margin-bottom:4px;padding-bottom:3px;border-bottom:1px solid #ddd}
    .cuenta{padding:2px 0}
    .cuenta+.cuenta{border-top:1px solid #ddd;margin-top:2px}
    .cuenta-banco{font-weight:600}
    .cuenta-num{font-family:"Courier New",monospace}
    .cuenta-tit{font-size:10px;color:#555}
    @media print{
      body{padding:0}
      /* El navegador ya aplica los margenes de pagina; duplicarlos empujaba el pie a otra hoja. */
      @page{margin:1.2cm}
    }
  </style>
</head>
<body>
  <div class="membrete">
    <div class="marca">VidrioSystem<span>Vidriería y aluminio</span></div>
    <div class="doc">
      <h1>Cotización</h1>
      <div class="numero">${cotizacion.numero}</div>
      <div class="fecha">Emitida el ${formatFecha(cotizacion.fecha_emision)}</div>
    </div>
  </div>

  <div class="bloques">
    <div class="bloque">
      <h2>Cliente</h2>
      <div class="razon">${escapar(razonSocial)}</div>
      <dl class="campos">
        ${cli?.documento ? `<dt>${etiquetaDocumento(cli.tipo)}</dt><dd>${escapar(cli.documento)}</dd>` : ''}
        ${cli?.empresa ? `<dt>Contacto</dt><dd>${escapar(`${cli.nombre} ${cli.apellido}`)}</dd>` : ''}
        ${cli?.direccion ? `<dt>Dirección</dt><dd>${escapar(cli.direccion)}${cli.ciudad ? `, ${escapar(cli.ciudad)}` : ''}</dd>` : ''}
        ${cli?.telefono ? `<dt>Teléfono</dt><dd>${escapar(cli.telefono)}</dd>` : ''}
        ${cli?.email ? `<dt>Correo</dt><dd>${escapar(cli.email)}</dd>` : ''}
      </dl>
    </div>
    <div class="bloque">
      <h2>Datos de la cotización</h2>
      <dl class="campos">
        <dt>Estado</dt><dd>${estadoConfig[cotizacion.estado].label}</dd>
        <dt>Emisión</dt><dd>${formatFecha(cotizacion.fecha_emision)}</dd>
        <dt>Vence</dt><dd>${cotizacion.fecha_vencimiento ? formatFecha(cotizacion.fecha_vencimiento) : '—'}</dd>
        <dt>IVA</dt><dd>${cotizacion.iva_pct}%</dd>
      </dl>
    </div>
  </div>

  <table>
    <thead>
      <tr><th>Descripción</th><th class="right">Cant.</th><th class="right">Precio unit.</th><th class="right">Total</th></tr>
    </thead>
    <tbody>${filasHtml}</tbody>
  </table>

  <div class="totales">
    <div class="row"><span>Subtotal</span><span>${formatCOP(cotizacion.subtotal)}</span></div>
    ${cotizacion.descuento_pct > 0 ? `<div class="row"><span>Descuento (${cotizacion.descuento_pct}%)</span><span>-${formatCOP(descuentoValor)}</span></div>` : ''}
    <div class="row"><span>IVA (${cotizacion.iva_pct}%)</span><span>${formatCOP(ivaValor)}</span></div>
    <div class="row total"><span>Total</span><span>${formatCOP(cotizacion.total)}</span></div>
    ${abonadoImpreso > 0 ? `
    <div class="row abonado"><span>Abonado</span><span>-${formatCOP(abonadoImpreso)}</span></div>
    <div class="row saldo"><span>Saldo pendiente</span><span>${formatCOP(saldoImpreso)}</span></div>` : ''}
  </div>

  ${pieHtml}
</body>
</html>`

    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(html)
    win.document.close()
    win.focus()
    setTimeout(() => win.print(), 400)
  }

  if (isLoading) return <LoadingSpinner className="py-20" />
  if (!cotizacion) return <p className="text-center text-muted-foreground">Cotización no encontrada</p>

  const cliente = cotizacion.cliente as Cliente | undefined
  const cfg = estadoConfig[cotizacion.estado]
  const abonado = saldoInfo?.total_abonado ?? 0
  const saldo = saldoInfo?.saldo ?? cotizacion.total
  const pctAbonado = saldoInfo?.pct_abonado ?? 0
  const liquidada = estaLiquidada(saldo)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/cotizaciones')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h2 className="text-xl font-bold">{cotizacion.numero}</h2>
          <p className="text-sm text-muted-foreground">Emitida el {formatFecha(cotizacion.fecha_emision)}</p>
        </div>
        <Button variant="outline" size="sm" onClick={imprimir}>
          <Printer className="mr-2 h-4 w-4" />
          Imprimir / PDF
        </Button>
        <Badge variant={cfg.variant}>{cfg.label}</Badge>
      </div>

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
            <div className="flex justify-between"><span className="text-muted-foreground">Emisión:</span><span>{formatFecha(cotizacion.fecha_emision)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Vencimiento:</span><span>{cotizacion.fecha_vencimiento ? formatFecha(cotizacion.fecha_vencimiento) : '—'}</span></div>
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
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{item.cantidad}</td>
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
            <div className="flex justify-between font-bold text-lg"><span>Total</span><span className="font-mono text-primary">{formatCOP(cotizacion.total)}</span></div>
          </div>
        </CardContent>
      </Card>

      {cotizacion.estado === 'vendida' && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Pagos</CardTitle>
            {liquidada ? (
              <Badge variant="success" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Pagada completa
              </Badge>
            ) : (
              <Button size="sm" onClick={() => setPagoDialog('abono')}>
                <Wallet className="mr-2 h-4 w-4" />
                Registrar abono
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
                    <th className="py-2">Fecha</th>
                    <th className="py-2">Tipo</th>
                    <th className="py-2">Método</th>
                    <th className="py-2">Recibió</th>
                    <th className="py-2 text-right">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {pagos.map((pago) => (
                    <tr key={pago.id} className="border-b last:border-0">
                      <td className="py-2">{formatFechaHora(pago.created_at)}</td>
                      <td className="py-2">
                        {TIPO_PAGO_LABEL[pago.tipo]}
                        {pago.autorizado_por && (
                          <span className="ml-1 text-xs text-amber-700" title={pago.motivo_autorizacion ?? ''}>
                            (autorizado)
                          </span>
                        )}
                      </td>
                      <td className="py-2">{METODO_LABEL[pago.metodo_pago]}</td>
                      <td className="py-2 text-muted-foreground">
                        {pago.usuario ? `${pago.usuario.nombre} ${pago.usuario.apellido}` : '—'}
                      </td>
                      <td className="py-2 text-right font-mono">{formatCOP(pago.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="space-y-1 border-t pt-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Abonado</span>
                <span className="font-mono">{formatCOP(abonado)}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span>Saldo pendiente</span>
                <span className={`font-mono ${liquidada ? 'text-emerald-600' : 'text-destructive'}`}>
                  {formatCOP(saldo)}
                </span>
              </div>
            </div>

            {!liquidada && (
              <p className="text-xs text-muted-foreground">
                La orden de producción ya puede avanzar, pero no se podrá entregar hasta que el saldo quede en cero.
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

      {(cotizacion.estado === 'borrador' || cotizacion.estado === 'enviada') && (
        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => navigate(`/cotizaciones/${id}/editar`)}
          >
            <Pencil className="mr-2 h-4 w-4" />
            Editar
          </Button>
          <Button
            className="flex-1"
            onClick={() => setPagoDialog('anticipo')}
            disabled={cambiarEstado.isPending}
          >
            <ShoppingCart className="mr-2 h-4 w-4" />
            Cliente aprobó — Registrar anticipo
          </Button>
          <Button
            variant="destructive"
            onClick={handleRechazar}
            disabled={cambiarEstado.isPending}
          >
            <XCircle className="mr-2 h-4 w-4" />
            Rechazar
          </Button>
        </div>
      )}

      {pagoDialog && (
        <RegistrarPagoDialog
          cotizacion={cotizacion}
          modo={pagoDialog}
          open
          onOpenChange={(open) => { if (!open) setPagoDialog(null) }}
        />
      )}
    </div>
  )
}
