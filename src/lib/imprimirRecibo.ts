import { escapar, membreteCss, membreteHtml } from '@/lib/documentos'
import { METODO_PAGO_LABEL, estaLiquidada } from '@/lib/pagos'
import { textoOpcion } from '@/lib/cotizaciones'
import { etiquetaDocumento, tablaItemsCss, tablaItemsHtml, totalesFilasHtml } from '@/lib/imprimirCotizacion'
import { numeroALetras } from '@/lib/numeroALetras'
import { textoAgradecimiento } from '@/lib/recibos'
import { formatCantidad, formatCOP, formatFecha, formatFechaHora } from '@/lib/utils'
import { obtenerDatosRecibo, type DatosRecibo } from '@/hooks/useRecibos'
import { ANCHO_CARTA_PX, descargarBlob, htmlAPng } from '@/lib/htmlAImagen'
import type { Cliente, ConfiguracionEmpresa } from '@/types/database'

/**
 * Recibo de pago: la versión imprimible de un cobro (una fila de `ventas`),
 * para imprimir o guardar como PDF y mandarlo por WhatsApp. El cobro de una
 * cotización va en carta porque lleva el detalle del trabajo; el de mostrador,
 * en media carta.
 */

export interface ContextoRecibo {
  empresa: ConfiguracionEmpresa | null | undefined
  /** Data URI del logo (ver useLogoEmpresaDataUri). */
  logo: string | null | undefined
}

const css = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.35;color:#000;padding:1cm;
      -webkit-print-color-adjust:exact;print-color-adjust:exact}
${membreteCss}
    .campos{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;margin-bottom:10px}
    .campos dt{color:#555;white-space:nowrap}
    .campos dd{font-weight:600;word-break:break-word}
    .monto{font-size:15px;font-weight:700}
    .letras{display:block;font-weight:400;font-style:italic;color:#333;font-size:10px}
    .dim{color:#555;font-weight:400}
    .productos{margin-top:2px;font-weight:400}
    .productos li{list-style:none}
${tablaItemsCss}
    /* Detalle del trabajo: la opción confirmada, como aparece en la cotización. */
    .detalle{margin:4px 0 10px}
    .detalle h2{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px}
    .detalle .dim{font-size:10px}
    .detalle .eleccion{border:1px solid #999;padding:5px 9px;margin-bottom:8px}
    .pie{display:flex;justify-content:flex-start;margin-top:6px}
    .saldo{width:250px;border:1px solid #999;padding:6px 9px}
    .saldo .row{display:flex;justify-content:space-between;padding:1.5px 0}
    .saldo .este{font-weight:700}
    .saldo .final{border-top:1px solid #999;margin-top:3px;padding-top:4px;font-weight:700;font-size:12px}
    .saldo .pagado{margin-top:4px;text-align:center;font-weight:700;color:#047857}
    /* El agradecimiento cierra el recibo: centrado y con el único color del documento. */
    .gracias{margin-top:14px;padding-top:8px;border-top:1px dashed #999;text-align:center;
      font-size:13px;font-weight:700;color:#1d4ed8}
    .anulado{border:2px solid #b91c1c;color:#b91c1c;font-weight:700;text-align:center;
      padding:5px;margin-bottom:10px;font-size:13px;letter-spacing:.1em}
    .anulado span{display:block;font-size:10px;font-weight:400;letter-spacing:0}
    @media print{body{padding:0}}`

/** Media carta (21,6 × 14 cm) o carta. */
const PAGINA = {
  media_carta: '@media print{@page{size:21.6cm 14cm;margin:1cm}}',
  carta: '@media print{@page{size:letter;margin:1.2cm}}',
}

function documento(titulo: string, cuerpo: string, pagina: keyof typeof PAGINA) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${escapar(titulo)}</title>
  <style>${css}
    ${PAGINA[pagina]}
  </style>
</head>
<body>
${cuerpo}
</body>
</html>`
}

const nombrePersona = (p: { nombre: string; apellido: string } | null | undefined) =>
  p ? `${p.nombre} ${p.apellido}`.trim() : ''

/** A una empresa se le nombra por su razón social; a una persona, por su nombre. */
function recibimosDe(cli: Cliente | null | undefined) {
  if (!cli) return 'Cliente de mostrador'
  const nombre = cli.empresa ?? `${cli.nombre} ${cli.apellido}`
  const doc = cli.documento ? ` · ${etiquetaDocumento(cli.tipo)} ${cli.documento}` : ''
  return `${escapar(nombre)}<span class="dim">${escapar(doc)}</span>`
}

function conceptoHtml({ venta, cotizacion, mostrador }: DatosRecibo) {
  if (cotizacion) {
    const accion = {
      anticipo: 'Anticipo de la cotización',
      abono: 'Abono a la cotización',
      saldo_final: 'Saldo final de la cotización',
      contado: 'Pago total de la cotización',
    }[venta.tipo]
    const opcion = textoOpcion(cotizacion.datos, cotizacion.datos.categoria)
    const partes = [
      `${accion} ${cotizacion.datos.numero}`,
      opcion,
      cotizacion.orden ? `Orden ${cotizacion.orden.numero}` : null,
    ].filter(Boolean) as string[]
    const entrega = venta.tipo === 'anticipo' && cotizacion.orden?.fecha_entrega_estimada
      ? `<br/><span class="dim">Entrega estimada: ${formatFecha(cotizacion.orden.fecha_entrega_estimada)}</span>`
      : ''
    return `${escapar(partes.join(' · '))}${entrega}`
  }
  if (mostrador) {
    const items = mostrador.items.map((i) =>
      `<li>${formatCantidad(i.cantidad)} × ${escapar(i.descripcion)} <span class="dim">${formatCOP(i.precio_total)}</span></li>`
    ).join('')
    return `Venta de mostrador ${escapar(mostrador.numero)}<ul class="productos">${items}</ul>`
  }
  return 'Pago'
}

function formaDePago({ venta }: DatosRecibo) {
  if (venta.metodo_pago === 'financiera') {
    const ref = venta.referencia_financiera ? ` · Ref. ${venta.referencia_financiera}` : ''
    return escapar(`Crédito ${venta.financiera?.nombre ?? 'financiera'}${ref}`)
  }
  return METODO_PAGO_LABEL[venta.metodo_pago]
}

/**
 * Lo que se le vendió al cliente, igual que en la cotización: la elección por
 * categorías (si es un pedido), la tabla de ítems y los totales.
 */
function detalleHtml({ cotizacion }: DatosRecibo) {
  if (!cotizacion) return ''
  const { datos, eleccion } = cotizacion
  const eleccionHtml = eleccion.length === 0 ? '' : `
    <div class="eleccion">${eleccion.map((o) => `<div>✓ ${escapar(textoOpcion(o, o.categoria) ?? o.numero)}</div>`).join('')}</div>`
  return `
  <div class="detalle">
    <h2>Detalle del trabajo</h2>
    ${eleccionHtml}
    ${tablaItemsHtml(datos.items ?? [])}
    <div class="totales">${totalesFilasHtml(datos)}</div>
  </div>`
}

/** Lo pagado antes, este pago y lo que queda. Solo para cotizaciones; el total va en el detalle. */
function saldoHtml({ venta, cotizacion }: DatosRecibo) {
  if (!cotizacion) return ''
  const total = cotizacion.datos.total
  const anteriores = cotizacion.pagosAnteriores
  const abonado = anteriores + venta.monto
  const saldo = Math.max(0, total - abonado)
  return `
  <div class="pie">
    <div class="saldo">
      <div class="row"><span>Pagos anteriores</span><span>${formatCOP(anteriores)}</span></div>
      <div class="row este"><span>Este pago</span><span>${formatCOP(venta.monto)}</span></div>
      <div class="row"><span>Total abonado</span><span>${formatCOP(abonado)}</span></div>
      <div class="row final"><span>Saldo pendiente</span><span>${formatCOP(saldo)}</span></div>
      ${estaLiquidada(total - abonado) ? '<div class="pagado">Trabajo pagado en su totalidad</div>' : ''}
    </div>
  </div>`
}

export function htmlRecibo(datos: DatosRecibo, ctx: ContextoRecibo) {
  const { venta, cotizacion, mostrador } = datos
  const numero = venta.numero_recibo ?? 'Sin número'
  const cliente = cotizacion?.datos.cliente ?? mostrador?.cliente ?? null

  const anulado = !venta.anulado_at ? '' : `
  <div class="anulado">ANULADO<span>El ${formatFechaHora(venta.anulado_at)}${
    venta.anulado_por_usuario ? ` por ${escapar(nombrePersona(venta.anulado_por_usuario))}` : ''
  }${venta.motivo_anulacion ? ` · ${escapar(venta.motivo_anulacion)}` : ''}</span></div>`

  const cuerpo = `
  ${membreteHtml(ctx.empresa, ctx.logo, {
    titulo: 'Recibo de pago',
    numero,
    fecha: formatFechaHora(venta.created_at),
  })}
  ${anulado}
  <dl class="campos">
    <dt>Recibimos de</dt><dd>${recibimosDe(cliente)}</dd>
    <dt>La suma de</dt><dd><span class="monto">${formatCOP(venta.monto)}</span>
      <span class="letras">(${escapar(numeroALetras(venta.monto))})</span></dd>
    <dt>Por concepto de</dt><dd>${conceptoHtml(datos)}</dd>
    <dt>Forma de pago</dt><dd>${formaDePago(datos)}</dd>
  </dl>

  ${detalleHtml(datos)}
  ${saldoHtml(datos)}

  <div class="gracias">${escapar(textoAgradecimiento(ctx.empresa))}</div>`

  return documento(`Recibo ${numero}`, cuerpo, cotizacion ? 'carta' : 'media_carta')
}

/**
 * Abre el recibo de un cobro para imprimir. La ventana se abre antes de la
 * espera: el navegador bloquea un window.open que ocurre después de un await,
 * porque ya no lo considera parte del clic.
 */
export async function imprimirRecibo(ventaId: string, ctx: ContextoRecibo) {
  const win = window.open('', '_blank')
  if (!win) return
  win.document.write('<p style="font-family:Arial;padding:2rem;color:#555">Generando recibo…</p>')
  try {
    const datos = await obtenerDatosRecibo(ventaId)
    win.document.open()
    win.document.write(htmlRecibo(datos, ctx))
    win.document.close()
    win.focus()
    setTimeout(() => win.print(), 400)
  } catch (err) {
    win.document.open()
    win.document.write(`<p style="font-family:Arial;padding:2rem;color:#b91c1c">No se pudo generar el recibo: ${
      escapar(err instanceof Error ? err.message : String(err))
    }</p>`)
    win.document.close()
  }
}

/**
 * Descarga el recibo como imagen PNG, para mandarlo por WhatsApp sin pasar por
 * el PDF. Es el mismo documento que se imprime. Lanza el error para que quien
 * llama lo muestre.
 */
export async function descargarReciboImagen(ventaId: string, ctx: ContextoRecibo) {
  const datos = await obtenerDatosRecibo(ventaId)
  const png = await htmlAPng(htmlRecibo(datos, ctx), ANCHO_CARTA_PX)
  const numero = datos.venta.numero_recibo ?? 'sin-numero'
  descargarBlob(png, `Recibo-${numero}.png`)
}
