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
import { useToast } from '@/hooks/useToast'
import { estaLiquidada, TIPO_PAGO_LABEL } from '@/lib/pagos'
import { formatCOP, formatFecha, formatFechaHora } from '@/lib/utils'
import type { Cotizacion, CotizacionItem, Venta } from '@/types/database'

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

export function CotizacionDetalle() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { data: cotizacion, isLoading } = useCotizacion(id ?? '')
  const { data: saldoInfo } = useSaldoCotizacion(id)
  const { data: pagos } = usePagosCotizacion(id)
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
    const cli = cotizacion.cliente as { nombre: string; apellido: string; empresa?: string; telefono?: string; email?: string } | undefined
    const items = (cotizacion.items ?? []) as CotizacionItem[]
    const descuentoValor = cotizacion.subtotal * (cotizacion.descuento_pct / 100)
    const ivaValor = cotizacion.total - cotizacion.subtotal * (1 - cotizacion.descuento_pct / 100)
    const abonadoImpreso = saldoInfo?.total_abonado ?? 0
    const saldoImpreso = saldoInfo?.saldo ?? cotizacion.total

    const filasHtml = items.map((item) => `
      <tr>
        <td>
          ${escapar(item.descripcion)}
          ${item.ancho_cm && item.alto_cm ? `<div class="dim">${item.ancho_cm} × ${item.alto_cm} cm</div>` : ''}
        </td>
        <td class="right">${item.cantidad}</td>
        <td class="right">${formatCOP(item.precio_unitario)}</td>
        <td class="right"><strong>${formatCOP(item.precio_total)}</strong></td>
      </tr>`).join('')

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>Cotización ${cotizacion.numero}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111;padding:2cm}
    h1{font-size:22px;font-weight:700}
    .sub{color:#666;font-size:12px;margin-bottom:20px}
    .head-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-bottom:20px}
    .kv{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f3f4f6}
    .kv strong{font-weight:600}
    table{width:100%;border-collapse:collapse;margin-top:8px}
    th{text-align:left;padding:6px 8px;font-size:11px;text-transform:uppercase;color:#6b7280;border-bottom:2px solid #e5e7eb}
    td{padding:8px;border-bottom:1px solid #f3f4f6;vertical-align:top}
    .right{text-align:right}
    .dim{color:#6b7280;font-size:11px;margin-top:2px}
    .totales{margin-top:14px;margin-left:auto;width:280px}
    .totales .row{display:flex;justify-content:space-between;padding:4px 0}
    .totales .total{border-top:2px solid #e5e7eb;margin-top:6px;padding-top:8px;font-weight:700;font-size:16px;color:#1d4ed8}
    .totales .abonado{color:#15803d;margin-top:6px}
    .totales .saldo{border-top:1px solid #e5e7eb;margin-top:4px;padding-top:6px;font-weight:700}
    .notas{margin-top:24px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px 14px;color:#374151;line-height:1.5}
    .notas h2{font-size:11px;text-transform:uppercase;color:#888;letter-spacing:.05em;margin-bottom:6px}
    @media print{body{padding:1.2cm}}
  </style>
</head>
<body>
  <h1>Cotización ${cotizacion.numero}</h1>
  <div class="sub">Emitida el ${formatFecha(cotizacion.fecha_emision)} · VidrioSystem</div>

  <div class="head-grid">
    <div class="kv"><span>Cliente</span><strong>${cli ? escapar(`${cli.nombre} ${cli.apellido}`) : '—'}</strong></div>
    <div class="kv"><span>Empresa</span><strong>${cli?.empresa ? escapar(cli.empresa) : '—'}</strong></div>
    <div class="kv"><span>Teléfono</span><strong>${cli?.telefono ? escapar(cli.telefono) : '—'}</strong></div>
    <div class="kv"><span>Correo</span><strong>${cli?.email ? escapar(cli.email) : '—'}</strong></div>
    <div class="kv"><span>Vencimiento</span><strong>${cotizacion.fecha_vencimiento ? formatFecha(cotizacion.fecha_vencimiento) : '—'}</strong></div>
    <div class="kv"><span>Estado</span><strong>${estadoConfig[cotizacion.estado].label}</strong></div>
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

  ${cotizacion.notas ? `<div class="notas"><h2>Notas</h2>${escapar(cotizacion.notas).replace(/\n/g, '<br/>')}</div>` : ''}
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

  const cliente = cotizacion.cliente as { nombre: string; apellido: string; empresa?: string; telefono?: string; email?: string } | undefined
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
            {cliente?.telefono && <p>{cliente.telefono}</p>}
            {cliente?.email && <p className="text-muted-foreground">{cliente.email}</p>}
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
