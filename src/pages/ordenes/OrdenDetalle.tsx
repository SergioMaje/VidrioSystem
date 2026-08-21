import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Play, CheckSquare, Truck, Loader2, Printer, Scissors, Calculator, Wallet, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { useCotizacion } from '@/hooks/useCotizaciones'
import { useSaldoCotizacion } from '@/hooks/useVentasCaja'
import { RegistrarPagoDialog } from '@/pages/cotizaciones/RegistrarPagoDialog'
import { estaLiquidada } from '@/lib/pagos'
import { formatCOP, formatFecha } from '@/lib/utils'
import { calcularCortes, calcularMateriales, nombreColorPerfil } from '@/lib/produccion'
import { calcularOpciones, esComponenteDeVidrio, lineasDeOpciones, type LineaMaterial } from '@/lib/opciones'
import { ESTADOS_ORDEN_CONFIG as estadoConfig } from '@/lib/estadosOrden'
import { ladoCorredizoExterior, textoLadoCorredizo } from '@/lib/lados'
import { PreviewProducto } from '@/pages/productos/PreviewProducto'
import type { OrdenTrabajo, CotizacionItem } from '@/types/database'

const SELECT_ITEMS_PRODUCCION = `
  *,
  referencia:referencias_producto(*, tipo_producto:tipos_producto(*), cortes:referencia_cortes(*)),
  plantilla:plantillas_producto(*, componentes:plantilla_componentes(*, item:items_inventario(*, categoria:categorias(*), unidad_medida:unidades_medida(*))))
`

/**
 * Componentes estructurales de la plantilla. Si el ítem guardó un vidrio como opción,
 * el componente de vidrio del BOM se excluye para no contarlo dos veces (los ítems
 * cotizados antes de las opciones adicionales lo conservan).
 */
function componentesEstructurales(item: CotizacionItem) {
  const tieneVidrioElegido = (item.opciones ?? []).some((o) => o.rol === 'vidrio')
  return (item.plantilla?.componentes ?? []).filter(
    (c) => !(tieneVidrioElegido && esComponenteDeVidrio(c))
  )
}

function detalleProduccion(item: CotizacionItem) {
  const anchoCm = item.ancho_cm ?? 0
  const altoCm = item.alto_cm ?? 0
  const conMedidas = anchoCm > 0 && altoCm > 0

  const cortes = conMedidas && item.referencia?.cortes?.length
    ? calcularCortes([...item.referencia.cortes].sort((a, b) => a.orden - b.orden), anchoCm, altoCm)
    : []

  const materiales: LineaMaterial[] = conMedidas
    ? [
        ...calcularMateriales(componentesEstructurales(item), anchoCm, altoCm, item.cantidad).map((m) => ({
          key: m.id,
          nombre: m.item?.nombre ?? '—',
          simbolo: m.item?.unidad_medida?.simbolo ?? '',
          cantidad: m.cantidad_calculada,
        })),
        ...lineasDeOpciones(item.opciones, anchoCm, altoCm, item.cantidad),
      ]
    : []

  return { cortes, materiales }
}

export function OrdenDetalle() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const { usuario } = useAuth()
  const qc = useQueryClient()

  const { data: orden, isLoading } = useQuery({
    queryKey: ['orden', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ordenes_trabajo')
        .select('*, cliente:clientes(*)')
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as OrdenTrabajo
    },
    enabled: !!id,
  })

  const { data: itemsCotizacion } = useQuery({
    queryKey: ['orden_items', orden?.cotizacion_id],
    queryFn: async () => {
      if (!orden?.cotizacion_id) return []
      const { data, error } = await supabase
        .from('cotizacion_items')
        .select(SELECT_ITEMS_PRODUCCION)
        .eq('cotizacion_id', orden.cotizacion_id)
      if (error) throw error
      return data as unknown as CotizacionItem[]
    },
    enabled: !!orden?.cotizacion_id,
  })

  // El producto no sale del taller sin estar pagado: el saldo bloquea la entrega.
  const { data: saldoInfo } = useSaldoCotizacion(orden?.cotizacion_id)
  const { data: cotizacion } = useCotizacion(orden?.cotizacion_id ?? '')
  const [pagoOpen, setPagoOpen] = useState(false)
  const saldoPendiente = saldoInfo?.saldo ?? 0
  // Mientras el saldo no haya cargado se asume bloqueado, para no habilitar el
  // botón por un instante antes de saber si hay deuda.
  const bloqueadaPorSaldo = !!orden?.cotizacion_id && (!saldoInfo || !estaLiquidada(saldoInfo.saldo))

  const cambiarEstado = useMutation({
    mutationFn: async (nuevoEstado: OrdenTrabajo['estado']) => {
      const updates: Partial<OrdenTrabajo> = { estado: nuevoEstado }
      if (nuevoEstado === 'en_produccion') updates.fecha_inicio = new Date().toISOString().split('T')[0]
      if (nuevoEstado === 'entregada') updates.fecha_entrega_real = new Date().toISOString().split('T')[0]

      const { error } = await supabase.from('ordenes_trabajo').update(updates).eq('id', id!)
      if (error) throw error

      if (nuevoEstado === 'entregada' && orden?.cotizacion_id && usuario) {
        const { data: cotItems } = await supabase
          .from('cotizacion_items')
          .select(
            '*, plantilla:plantillas_producto(componentes:plantilla_componentes(*, item:items_inventario(*, categoria:categorias(*))))'
          )
          .eq('cotizacion_id', orden.cotizacion_id)

        for (const cotItem of (cotItems ?? []) as unknown as CotizacionItem[]) {
          if (!cotItem.ancho_cm || !cotItem.alto_cm) continue

          const consumos = [
            ...calcularMateriales(
              componentesEstructurales(cotItem),
              cotItem.ancho_cm,
              cotItem.alto_cm,
              cotItem.cantidad
            ).map((m) => ({ item_id: m.item_id, cantidad: m.cantidad_calculada })),
            ...calcularOpciones(
              cotItem.opciones,
              cotItem.ancho_cm,
              cotItem.alto_cm,
              cotItem.cantidad
            ).map((o) => ({ item_id: o.opcion.item_id, cantidad: o.cantidad_calculada })),
          ]

          for (const consumo of consumos) {
            if (consumo.cantidad <= 0) continue

            const { data: inv } = await supabase
              .from('items_inventario')
              .select('stock_actual')
              .eq('id', consumo.item_id)
              .single()
            if (!inv) continue

            const anterior = inv.stock_actual
            const posterior = Math.max(0, anterior - consumo.cantidad)

            await supabase.from('movimientos_inventario').insert({
              item_id:           consumo.item_id,
              tipo:              'produccion',
              cantidad:          consumo.cantidad,
              cantidad_anterior: anterior,
              cantidad_posterior: posterior,
              motivo:            `Orden ${orden.numero}`,
              referencia:        id,
              usuario_id:        usuario.id,
            })

            await supabase
              .from('items_inventario')
              .update({ stock_actual: posterior })
              .eq('id', consumo.item_id)
          }
        }
      }
    },
    onSuccess: (_data, nuevoEstado) => {
      qc.invalidateQueries({ queryKey: ['orden', id] })
      qc.invalidateQueries({ queryKey: ['ordenes'] })
      qc.invalidateQueries({ queryKey: ['dashboard_pipeline'] })
      qc.invalidateQueries({ queryKey: ['dashboard_entregas'] })
      if (nuevoEstado === 'entregada') {
        qc.invalidateQueries({ queryKey: ['items'] })
        qc.invalidateQueries({ queryKey: ['movimientos'] })
        qc.invalidateQueries({ queryKey: ['dashboard_stock_bajo'] })
        qc.invalidateQueries({ queryKey: ['dashboard_total_items'] })
      }
      toast({ title: nuevoEstado === 'entregada' ? 'Orden entregada — stock descontado' : 'Estado actualizado', variant: 'success' })
    },
    onError: () => toast({ title: 'Error al actualizar', variant: 'destructive' }),
  })

  const imprimirFichaProduccion = () => {
    if (!orden || !itemsCotizacion?.length) return
    const cli = orden.cliente as { nombre: string; apellido: string; telefono?: string } | undefined
    const fecha = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' })

    const itemsHtml = itemsCotizacion.map((item, idx) => {
      const { cortes, materiales } = detalleProduccion(item)
      const color = nombreColorPerfil(item.color_perfil)
      const ladoTexto = item.referencia?.es_corrediza
        ? textoLadoCorredizo(item.lado_corredizo, item.lado_medicion)
        : null

      const cortesHtml = cortes.length === 0 ? '' : `
        <h3>Medidas de corte</h3>
        <table>
          <thead><tr><th>Pieza</th><th>Cantidad</th><th class="right">Longitud (cm)</th></tr></thead>
          <tbody>
            ${cortes.map((c) => `
              <tr>
                <td>${c.nombre_pieza}</td>
                <td>${c.cantidad_piezas} ${c.cantidad_piezas === 1 ? 'pieza' : 'piezas'}${item.cantidad > 1 ? ` × ${item.cantidad} und = ${c.cantidad_piezas * item.cantidad}` : ''}</td>
                <td class="right"><strong>${c.valor_cm.toFixed(1)} cm</strong></td>
              </tr>
            `).join('')}
          </tbody>
        </table>`

      const materialesHtml = materiales.length === 0 ? '' : `
        <h3>Materiales</h3>
        <table>
          <thead><tr><th>Material</th><th class="right">Cantidad total</th><th>Unidad</th></tr></thead>
          <tbody>
            ${materiales.map((m) => `
              <tr>
                <td>${m.nombre}</td>
                <td class="right">${m.cantidad.toFixed(2)}</td>
                <td>${m.simbolo || '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>`

      const sinInfo = cortes.length === 0 && materiales.length === 0
        ? '<p class="warn">Sin referencia/plantilla guardada — verificar medidas de corte manualmente.</p>'
        : ''

      // Se reaprovecha el SVG ya montado en la tarjeta del ítem en vez de renderizar
      // uno oculto aparte: así el papel y la pantalla no pueden divergir.
      const svg = document.querySelector(`[data-preview="${item.id}"] svg`)
      const despieceHtml = svg
        ? `<div class="preview">${new XMLSerializer().serializeToString(svg)}</div>`
        : ''

      return `
        <div class="item">
          <div class="item-head">
            <span class="num">${idx + 1}</span>
            <div>
              <p class="desc">${item.descripcion}</p>
              <p class="meta">
                ${item.ancho_cm && item.alto_cm ? `${item.ancho_cm} × ${item.alto_cm} cm` : 'Sin medidas'}
                · Cantidad: ${item.cantidad}
                ${color ? ` · Perfil: ${color}` : ''}
                ${item.referencia?.es_corrediza && !ladoTexto ? ' · <strong>Corrediza (lado sin registrar)</strong>' : ''}
              </p>
              ${ladoTexto ? `<p><span class="lado">${ladoTexto}</span></p>` : ''}
              ${item.notas ? `<p class="notas">${item.notas.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')}</p>` : ''}
            </div>
          </div>
          ${despieceHtml}
          ${cortesHtml}
          ${materialesHtml}
          ${sinInfo}
        </div>`
    }).join('')

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>Ficha de Producción — ${orden.numero}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    /* Sin esto el navegador descarta fondos al imprimir y el despiece saldría sin el
       color del perfil, sin los degradados del vidrio y sin el azul de la corredera. */
    body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#111;padding:1.5cm;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    h1{font-size:20px;font-weight:700;margin-bottom:2px}
    .sub{color:#666;font-size:12px;margin-bottom:20px}
    .head-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-bottom:20px}
    .kv{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #f3f4f6}
    .kv strong{font-weight:600}
    .item{border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;margin-bottom:16px;page-break-inside:avoid}
    .item-head{display:flex;gap:12px;margin-bottom:8px}
    .num{display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:#111;color:#fff;font-weight:700;font-size:13px;flex-shrink:0}
    .desc{font-weight:700;font-size:14px}
    .meta{color:#555;font-size:12px;margin-top:2px}
    .lado{display:inline-block;margin-top:5px;padding:3px 9px;border:1.5px solid #1d4ed8;border-radius:4px;color:#1d4ed8;font-size:12px;font-weight:700}
    .notas{color:#374151;font-size:12px;margin-top:4px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:4px;padding:6px 8px}
    .preview{text-align:center;margin:12px 0}
    .preview svg{max-width:100%;height:auto;border:1px solid #e5e7eb;border-radius:6px}
    h3{font-size:10px;text-transform:uppercase;color:#888;letter-spacing:.05em;margin:10px 0 6px}
    table{width:100%;border-collapse:collapse}
    th{text-align:left;padding:4px;font-size:10px;text-transform:uppercase;color:#6b7280;border-bottom:2px solid #e5e7eb}
    td{padding:4px;border-bottom:1px solid #f3f4f6}
    .right{text-align:right}
    .warn{color:#92400e;background:#fef3c7;border:1px solid #fde68a;border-radius:4px;padding:6px 8px;font-size:12px;margin-top:8px}
    @media print{body{padding:1cm}}
  </style>
</head>
<body>
  <h1>Ficha de Producción — ${orden.numero}</h1>
  <div class="sub">Generada el ${fecha} · VidrioSystem</div>
  <div class="head-grid">
    <div class="kv"><span>Cliente</span><strong>${cli ? `${cli.nombre} ${cli.apellido}` : '—'}</strong></div>
    <div class="kv"><span>Teléfono</span><strong>${cli?.telefono ?? '—'}</strong></div>
    <div class="kv"><span>Estado</span><strong>${estadoConfig[orden.estado].label}</strong></div>
    <div class="kv"><span>Entrega estimada</span><strong>${orden.fecha_entrega_estimada ? formatFecha(orden.fecha_entrega_estimada) : '—'}</strong></div>
  </div>
  ${itemsHtml}
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
  if (!orden) return <p className="text-center text-muted-foreground">Orden no encontrada</p>

  const cliente = orden.cliente as { nombre: string; apellido: string; telefono?: string; email?: string } | undefined
  const cfg = estadoConfig[orden.estado]

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/ordenes')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h2 className="text-xl font-bold">{orden.numero}</h2>
          <p className="text-sm text-muted-foreground">Creada el {formatFecha(orden.created_at)}</p>
        </div>
        {itemsCotizacion && itemsCotizacion.length > 0 && (
          <Button variant="outline" size="sm" onClick={imprimirFichaProduccion}>
            <Printer className="mr-2 h-4 w-4" />
            Ficha de producción
          </Button>
        )}
        <Badge variant={cfg.variant}>{cfg.label}</Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Cliente</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="font-medium">{cliente ? `${cliente.nombre} ${cliente.apellido}` : '—'}</p>
            {cliente?.telefono && <p>{cliente.telefono}</p>}
            {cliente?.email && <p className="text-muted-foreground">{cliente.email}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Fechas</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Inicio:</span><span>{orden.fecha_inicio ? formatFecha(orden.fecha_inicio) : 'Pendiente'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Entrega estimada:</span><span>{orden.fecha_entrega_estimada ? formatFecha(orden.fecha_entrega_estimada) : '—'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Entrega real:</span><span>{orden.fecha_entrega_real ? formatFecha(orden.fecha_entrega_real) : '—'}</span></div>
          </CardContent>
        </Card>
      </div>

      {itemsCotizacion && itemsCotizacion.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-base font-semibold">Items a producir</h3>
          {itemsCotizacion.map((item, idx) => {
            const { cortes, materiales } = detalleProduccion(item)
            const color = nombreColorPerfil(item.color_perfil)
            // El marco de referencia viaja siempre con el lado: un "Derecha" suelto
            // reintroduciría la ambigüedad que este dato existe para eliminar.
            const ladoTexto = item.referencia?.es_corrediza
              ? textoLadoCorredizo(item.lado_corredizo, item.lado_medicion)
              : null
            const ladoVista = ladoCorredizoExterior(item.lado_corredizo, item.lado_medicion)
            const dibujable = !!item.referencia && !!item.ancho_cm && !!item.alto_cm
            return (
              <Card key={item.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                      {idx + 1}
                    </span>
                    <div className="flex-1 space-y-1">
                      <CardTitle className="text-sm leading-snug">{item.descripcion}</CardTitle>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{item.ancho_cm && item.alto_cm ? `${item.ancho_cm} × ${item.alto_cm} cm` : 'Sin medidas'}</span>
                        <span>Cantidad: <span className="font-mono font-semibold text-foreground">{item.cantidad}</span></span>
                        {color && (
                          <span className="flex items-center gap-1.5">
                            {item.color_perfil && (
                              <span className="h-3 w-3 rounded-full border" style={{ backgroundColor: item.color_perfil }} />
                            )}
                            Perfil: {color}
                          </span>
                        )}
                        {item.referencia && <Badge variant="outline" className="text-xs">{item.referencia.nombre}</Badge>}
                        {item.referencia?.es_corrediza && (
                          ladoTexto
                            ? <Badge className="text-xs">{ladoTexto}</Badge>
                            : (
                              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-xs text-amber-800">
                                Corrediza — lado sin registrar
                              </Badge>
                            )
                        )}
                      </div>
                      {item.notas && (
                        <p className="rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">{item.notas}</p>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {cortes.length === 0 && materiales.length === 0 ? (
                    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Este ítem no tiene referencia ni plantilla guardada — verificar medidas de corte manualmente.
                    </p>
                  ) : (
                    <>
                      {dibujable && (
                        <div className="flex justify-center" data-preview={item.id}>
                          <PreviewProducto
                            tipo={item.referencia!.tipo_producto?.nombre ?? 'ventana'}
                            anchoCm={item.ancho_cm!}
                            altoCm={item.alto_cm!}
                            colorPerfil={item.color_perfil ?? undefined}
                            // Sin lado registrado, ladoCorredizoExterior devuelve null y el
                            // default del preview ('derecha') imprimiría una afirmación falsa
                            // en el papel del taller. Mejor no dibujar F/C: la advertencia la
                            // da el badge ámbar "Corrediza — lado sin registrar".
                            esCorrediza={!!item.referencia!.es_corrediza && !!ladoVista}
                            ladoCorredizoVista={ladoVista ?? undefined}
                            cortes={cortes}
                          />
                        </div>
                      )}
                      {cortes.length > 0 && (
                        <div>
                          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            <Scissors className="h-3.5 w-3.5" />
                            Medidas de corte
                          </p>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {cortes.map((c) => (
                              <div key={c.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                                <div>
                                  <p className="font-medium">{c.nombre_pieza}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {c.cantidad_piezas} {c.cantidad_piezas === 1 ? 'pieza' : 'piezas'}
                                    {item.cantidad > 1 && ` × ${item.cantidad} und = ${c.cantidad_piezas * item.cantidad}`}
                                  </p>
                                </div>
                                <span className="font-mono font-semibold">{c.valor_cm.toFixed(1)} cm</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {materiales.length > 0 && (
                        <div>
                          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            <Calculator className="h-3.5 w-3.5" />
                            Materiales (total × {item.cantidad} {item.cantidad === 1 ? 'unidad' : 'unidades'})
                          </p>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {materiales.map((m) => (
                              <div key={m.key} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                                <p className="font-medium">{m.nombre}</p>
                                <span className="font-mono text-muted-foreground">
                                  {m.cantidad.toFixed(2)} {m.simbolo}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {orden.notas && (
        <Card>
          <CardHeader><CardTitle className="text-base">Notas</CardTitle></CardHeader>
          <CardContent><p className="text-sm text-muted-foreground">{orden.notas}</p></CardContent>
        </Card>
      )}

      <Separator />

      <div className="flex flex-wrap gap-3">
        {orden.estado === 'pendiente' && (
          <Button onClick={() => cambiarEstado.mutate('en_produccion')} disabled={cambiarEstado.isPending}>
            {cambiarEstado.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            Iniciar producción
          </Button>
        )}
        {orden.estado === 'en_produccion' && (
          <Button onClick={() => cambiarEstado.mutate('lista')} disabled={cambiarEstado.isPending}>
            {cambiarEstado.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckSquare className="mr-2 h-4 w-4" />}
            Marcar como lista
          </Button>
        )}
        {orden.estado === 'lista' && (
          <>
            <Button
              onClick={() => cambiarEstado.mutate('entregada')}
              disabled={cambiarEstado.isPending || bloqueadaPorSaldo}
            >
              {cambiarEstado.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Truck className="mr-2 h-4 w-4" />}
              Marcar como entregada
            </Button>
            {bloqueadaPorSaldo && (
              <Button variant="outline" onClick={() => setPagoOpen(true)} disabled={!cotizacion}>
                <Wallet className="mr-2 h-4 w-4" />
                Registrar pago final
              </Button>
            )}
          </>
        )}
      </div>

      {orden.estado === 'lista' && bloqueadaPorSaldo && saldoInfo && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            No se puede entregar: quedan <strong className="font-mono">{formatCOP(saldoPendiente)}</strong> por cobrar.
            Registra el pago final para poder marcar la orden como entregada.
          </div>
        </div>
      )}

      {cotizacion && (
        <RegistrarPagoDialog
          cotizacion={cotizacion}
          modo="abono"
          open={pagoOpen}
          onOpenChange={setPagoOpen}
        />
      )}
    </div>
  )
}
