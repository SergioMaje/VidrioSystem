import { escapar, membreteCss, membreteHtml } from '@/lib/documentos'
import { ANCHO_CARTA_PX, descargarBlob, htmlAPng } from '@/lib/htmlAImagen'
import { anticipoSolicitado, textoAnticipoSolicitado } from '@/lib/pagos'
import {
  codigoOpcion, ESTADOS_COTIZACION_CONFIG, numeroBaseEnvio, rangoTotales, TIPO_CATEGORIA_CONFIG, textoOpcion,
  type TipoCategoria,
} from '@/lib/cotizaciones'
import { resumenOpciones } from '@/lib/opciones'
import { TIPO_ANULACION_LABEL } from '@/lib/anulacion'
import { detalleMedidasPorLado, medidasDeItem, nombreColorPerfil } from '@/lib/produccion'
import { formatCantidad, formatCOP, formatFecha, formatFechaHora } from '@/lib/utils'
import type {
  Cliente, ConfiguracionEmpresa, Cotizacion, CotizacionItem, CuentaPagoEmpresa, EnvioCategoria,
} from '@/types/database'

/**
 * Documentos de cotización para imprimir o guardar como PDF: una cotización
 * suelta, o un envío con varias opciones para que el cliente compare.
 */

/** Una empresa se identifica con NIT; una persona natural, con cédula. */
export const etiquetaDocumento = (tipo?: Cliente['tipo']) => (tipo === 'juridico' ? 'NIT' : 'C.C.')

type CotizacionConItems = Cotizacion & { items: CotizacionItem[] }

/** Datos de la vidriería que van en todos los documentos. */
export interface ContextoImpresion {
  empresa: ConfiguracionEmpresa | null | undefined
  /** Data URI del logo (ver useLogoEmpresaDataUri). */
  logo: string | null | undefined
  cuentas: CuentaPagoEmpresa[]
}

/**
 * Tabla de ítems y bloque de totales. Lo comparten la cotización y el recibo de
 * pago, para que el cliente vea el trabajo igual en los dos documentos.
 */
export const tablaItemsCss = `
    table{width:100%;border-collapse:collapse}
    th{text-align:left;padding:4px 6px;font-size:9px;text-transform:uppercase;
      letter-spacing:.05em;border-bottom:1.5px solid #000;border-top:1px solid #000}
    td{padding:4px 6px;border-bottom:1px solid #ddd;vertical-align:top}
    tr{page-break-inside:avoid}
    .right{text-align:right;white-space:nowrap}
    .totales{margin-top:8px;margin-left:auto;width:230px}
    .totales .row{display:flex;justify-content:space-between;padding:2px 0}
    /* Doble filete sobre el total: convencion de documento contable. */
    .totales .total{border-top:3px double #000;margin-top:3px;padding-top:5px;font-weight:700;font-size:13px}`

const css = `
    *{box-sizing:border-box;margin:0;padding:0}
    /* print-color-adjust: sin esto el navegador descarta los fondos al imprimir y un logo
       con color de fondo sale descolorido. */
    body{font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.35;color:#000;padding:1.4cm;
      -webkit-print-color-adjust:exact;print-color-adjust:exact}
${membreteCss}
    /* Dos bloques independientes: los datos del cliente no se mezclan con los del documento. */
    .bloques{display:grid;grid-template-columns:1.4fr 1fr;gap:20px;margin-bottom:12px}
    .bloque h2{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;
      color:#000;padding-bottom:3px;border-bottom:1px solid #999;margin-bottom:5px}
    /* Etiqueta en columna fija: un valor largo envuelve dentro de su celda y nunca la invade. */
    .campos{display:grid;grid-template-columns:auto 1fr;gap:2px 10px}
    .campos dt{color:#555;white-space:nowrap}
    .campos dd{font-weight:600;word-break:break-word}
    .razon{font-weight:700;font-size:12px;margin-bottom:3px}
${tablaItemsCss}
    /* Las medidas van junto a la descripcion: una linea menos por item. */
    .dim{color:#555;font-size:10px}
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
    /* El único color del documento, para que el cliente lo vea sin buscarlo. */
    /* Anticipo a la izquierda de los totales, a la altura de la fila del Total. */
    .cierre{display:flex;justify-content:flex-end;align-items:flex-end;gap:14px;margin-top:8px}
    .cierre .totales{margin-top:0;margin-left:0}
    .anticipo{width:fit-content;max-width:100%;border:1.5px solid #2563eb;
      background:#eff6ff;color:#1d4ed8;font-weight:700;font-size:12px;padding:5px 10px;page-break-inside:avoid}
    .anulada{border:2px solid #b91c1c;color:#b91c1c;font-weight:700;text-align:center;
      padding:6px;margin-bottom:12px;font-size:13px;letter-spacing:.1em}
    .anulada span{display:block;font-size:10px;font-weight:400;letter-spacing:0}
    /* Envío con varias opciones: cuadro comparativo y una sección por opción. */
    .comparativo{margin-bottom:14px;page-break-inside:avoid}
    .comparativo h2,.opcion h2{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px}
    .comparativo .elige{font-size:10px;color:#555;margin-top:5px}
    .comparativo td.letra{font-weight:700;width:1%;white-space:nowrap}
    .opcion{margin-top:16px;padding-top:10px;border-top:1.5px solid #000}
    .opcion .titulo{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}
    .opcion .titulo strong{font-size:13px}
    .opcion .titulo span{font-size:10px;color:#555}
    /* Envío por categorías: un encabezado de color por parte y sus opciones en tarjetas.
       --c y --f son el color y el fondo del tipo; el texto sigue en negro para que se
       lea igual impreso en blanco y negro. */
    .partes-intro{font-size:10.5px;color:#333;margin-bottom:4px}
    .cat{margin-top:14px}
    .cat-cab{display:flex;align-items:center;gap:7px;padding:5px 9px;border-left:5px solid var(--c);
      background:var(--f);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
      page-break-after:avoid;break-after:avoid}
    .cat-cab svg{width:16px;height:16px;flex-shrink:0}
    .cat-cab .sub{margin-left:auto;font-size:9px;font-weight:400;text-transform:none;letter-spacing:0;color:#333}
    .tarjetas{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-top:10px}
    .tarjeta{position:relative;border:1px solid #bbb;border-radius:6px;padding:10px 10px 8px;
      display:flex;flex-direction:column;gap:4px;page-break-inside:avoid;break-inside:avoid}
    .tarjeta.reco{border:2px solid var(--c)}
    .tarjeta .cinta{position:absolute;top:-8px;right:8px;background:var(--c);color:#fff;font-size:8.5px;
      font-weight:700;padding:2px 6px;border-radius:3px;letter-spacing:.04em;text-transform:uppercase}
    .tarjeta .cab{display:flex;align-items:center;gap:7px}
    .tarjeta .letra{width:24px;height:24px;border-radius:50%;background:var(--f);border:1.5px solid var(--c);
      display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;flex-shrink:0}
    .tarjeta .nombre{font-weight:700;font-size:11.5px;line-height:1.2}
    .tarjeta .det{font-size:9.5px;color:#444;flex:1}
    .tarjeta .precio{font-size:15px;font-weight:700;margin-top:2px}
    .tarjeta .dif{font-size:9px;color:#555}
    .tarjeta .num{font-size:8.5px;color:#777}
    .eleccion{margin-top:16px;border:1.5px solid #000;border-radius:6px;padding:10px 12px;page-break-inside:avoid;
      display:grid;grid-template-columns:1fr auto;gap:6px 16px;align-items:start}
    .eleccion h2{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px}
    .eleccion .rango{font-size:15px;font-weight:700}
    .eleccion .nota{font-size:9.5px;color:#555;margin-top:2px}
    .eleccion .marcar{grid-column:1 / -1;display:flex;flex-wrap:wrap;gap:6px 18px;font-size:10.5px;
      border-top:1px solid #ddd;padding-top:7px}
    .eleccion .marcar b{display:inline-block;min-width:40px;border-bottom:1px solid #000;margin-left:4px}
    .detalle-titulo{margin-top:22px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;
      padding-bottom:3px;border-bottom:1.5px solid #000;page-break-after:avoid;break-after:avoid}
    .cat .opcion{margin-top:10px;padding-top:6px;border-top:1px solid #999}
    @media print{
      body{padding:0}
      /* El navegador ya aplica los margenes de pagina; duplicarlos empujaba el pie a otra hoja. */
      @page{margin:1.2cm}
    }`

function documento(titulo: string, cuerpo: string) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>${escapar(titulo)}</title>
  <style>${css}
  </style>
</head>
<body>
${cuerpo}
</body>
</html>`
}

function clienteHtml(cli: Cliente | undefined) {
  // A una empresa se le factura por su razon social; el contacto va como dato aparte.
  const razonSocial = cli ? (cli.empresa ?? `${cli.nombre} ${cli.apellido}`) : '—'
  return `
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
    </div>`
}

export function tablaItemsHtml(items: CotizacionItem[]) {
  const filas = items.map((item) => {
    const porLado = detalleMedidasPorLado(medidasDeItem(item))
    return `
      <tr>
        <td>
          ${escapar(item.descripcion)}${item.ancho_cm && item.alto_cm ? ` <span class="dim">(${item.ancho_cm} × ${item.alto_cm} cm)</span>` : ''}
          ${porLado ? `<br/><span class="dim">${escapar(porLado)}</span>` : ''}
        </td>
        <td class="right">${formatCantidad(item.cantidad)}</td>
        <td class="right">${formatCOP(item.precio_unitario)}</td>
        <td class="right"><strong>${formatCOP(item.precio_total)}</strong></td>
      </tr>`
  }).join('')
  return `
  <table>
    <thead>
      <tr><th>Descripción</th><th class="right">Cant.</th><th class="right">Precio unit.</th><th class="right">Total</th></tr>
    </thead>
    <tbody>${filas}</tbody>
  </table>`
}

/** Subtotal, descuento, IVA y total de la cotización. */
export function totalesFilasHtml(cot: Pick<Cotizacion, 'subtotal' | 'descuento_pct' | 'iva_pct' | 'total'>) {
  const descuentoValor = cot.subtotal * (cot.descuento_pct / 100)
  const ivaValor = cot.total - cot.subtotal * (1 - cot.descuento_pct / 100)
  return `
    <div class="row"><span>Subtotal</span><span>${formatCOP(cot.subtotal)}</span></div>
    ${cot.descuento_pct > 0 ? `<div class="row"><span>Descuento (${cot.descuento_pct}%)</span><span>-${formatCOP(descuentoValor)}</span></div>` : ''}
    <div class="row"><span>IVA (${cot.iva_pct}%)</span><span>${formatCOP(ivaValor)}</span></div>
    <div class="row total"><span>Total</span><span>${formatCOP(cot.total)}</span></div>`
}

/** Totales con el anticipo solicitado a la izquierda, y abonado/saldo si ya hubo cobros. */
function cierreHtml(cot: Cotizacion, pctAnticipo: number | null | undefined, abonado = 0, saldo = cot.total) {
  // Lo que la vidriería pide de anticipo (Configuración). Una anulada o una
  // descartada ya no piden nada.
  const anticipo = !pctAnticipo || cot.estado === 'anulada' || cot.estado === 'descartada' ? '' : `
    <div class="anticipo">${escapar(textoAnticipoSolicitado(pctAnticipo, cot.total))}</div>`
  return `
  <div class="cierre">
  ${anticipo}
  <div class="totales">
    ${totalesFilasHtml(cot)}
    ${abonado > 0 ? `
    <div class="row abonado"><span>Abonado</span><span>-${formatCOP(abonado)}</span></div>
    <div class="row saldo"><span>Saldo pendiente</span><span>${formatCOP(saldo)}</span></div>` : ''}
  </div>
  </div>`
}

function pieHtml(notas: string | null, cuentas: CuentaPagoEmpresa[]) {
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
  const notasHtml = !notas ? '' : `
      <div class="caja"><h2>Notas</h2>${escapar(notas).replace(/\n/g, '<br/>')}</div>`
  // Si solo hay uno de los dos bloques, ocupa el ancho completo en vez de dejar un hueco.
  if (!notasHtml && !cuentasHtml) return ''
  return `<div class="pie${notasHtml && cuentasHtml ? '' : ' una'}">${notasHtml}${cuentasHtml}</div>`
}

/**
 * Una cotización sola: la impresión de siempre. Si es un pedido armado por la
 * elección del cliente, `eleccion` lista lo que eligió de cada parte.
 */
export function htmlCotizacion(
  cot: CotizacionConItems,
  cobros: { abonado: number; saldo: number },
  ctx: ContextoImpresion,
  eleccion: string[] = [],
) {
  const opcion = textoOpcion(cot)
  const cuerpo = `
  ${membreteHtml(ctx.empresa, ctx.logo, {
    titulo: 'Cotización',
    numero: cot.numero,
    fecha: `Emitida el ${formatFecha(cot.fecha_emision)}`,
  })}
  ${cot.estado === 'anulada' ? `
  <div class="anulada">ANULADA<span>${cot.anulado_at ? `El ${formatFechaHora(cot.anulado_at)}` : ''}${cot.tipo_anulacion ? ` · ${TIPO_ANULACION_LABEL[cot.tipo_anulacion]}` : ''}</span></div>` : ''}

  <div class="bloques">
    ${clienteHtml(cot.cliente)}
    <div class="bloque">
      <h2>Datos de la cotización</h2>
      <dl class="campos">
        ${opcion ? `<dt>Opción</dt><dd>${escapar(opcion.replace(/^Opción /, ''))}</dd>` : ''}
        <dt>Estado</dt><dd>${ESTADOS_COTIZACION_CONFIG[cot.estado].label}</dd>
        <dt>Emisión</dt><dd>${formatFecha(cot.fecha_emision)}</dd>
        <dt>Vence</dt><dd>${cot.fecha_vencimiento ? formatFecha(cot.fecha_vencimiento) : '—'}</dd>
        <dt>IVA</dt><dd>${cot.iva_pct}%</dd>
      </dl>
    </div>
  </div>
  ${eleccion.length > 0 ? `
  <div class="caja" style="margin-bottom:12px"><h2>Su elección</h2>${eleccion.map((e) => `<div>✓ ${escapar(e)}</div>`).join('')}</div>` : ''}

  ${tablaItemsHtml(cot.items ?? [])}
  ${cierreHtml(cot, ctx.empresa?.anticipo_solicitado_pct, cobros.abonado, cobros.saldo)}

  ${pieHtml(cot.notas, ctx.cuentas)}`
  return documento(`Cotización ${cot.numero}`, cuerpo)
}

/**
 * Un envío con varias opciones: cuadro comparativo arriba y luego el detalle de
 * cada opción. Cliente, vencimiento, notas y medios de pago van una sola vez
 * porque son del envío.
 */
export function htmlEnvio(
  opciones: CotizacionConItems[],
  cliente: Cliente | undefined,
  ctx: ContextoImpresion,
  categorias: EnvioCategoria[] = [],
) {
  if (categorias.length > 0 && opciones.some((o) => o.categoria_id)) {
    return htmlEnvioPorCategorias(opciones, cliente, ctx, categorias)
  }
  const primera = opciones[0]
  const numeroEnvio = numeroBaseEnvio(primera.numero)
  const pctAnticipo = ctx.empresa?.anticipo_solicitado_pct
  const titulo = (o: Cotizacion) => `Opción ${o.opcion_etiqueta}${o.opcion_nombre ? ` – ${o.opcion_nombre}` : ''}`

  const comparativo = `
  <div class="comparativo">
    <h2>Resumen de opciones</h2>
    <table>
      <thead>
        <tr>
          <th>Opción</th><th>Descripción</th><th class="right">Ítems</th>
          ${pctAnticipo ? `<th class="right">Anticipo (${pctAnticipo}%)</th>` : ''}
          <th class="right">Total</th>
        </tr>
      </thead>
      <tbody>${opciones.map((o) => `
        <tr>
          <td class="letra">${escapar(o.opcion_etiqueta ?? '')}</td>
          <td>${escapar(o.opcion_nombre ?? `Opción ${o.opcion_etiqueta}`)}${o.recomendada ? ' <strong>★ Recomendada</strong>' : ''} <span class="dim">(${escapar(o.numero)})</span></td>
          <td class="right">${o.items.length}</td>
          ${pctAnticipo ? `<td class="right">${formatCOP(anticipoSolicitado(pctAnticipo, o.total))}</td>` : ''}
          <td class="right"><strong>${formatCOP(o.total)}</strong></td>
        </tr>`).join('')}
      </tbody>
    </table>
    <p class="elige">Elija una de las opciones. Al confirmar, indíquenos la letra de la opción elegida.</p>
  </div>`

  const secciones = opciones.map((o) => `
  <div class="opcion">
    <div class="titulo"><strong>${escapar(titulo(o))}</strong><span>${escapar(o.numero)} · IVA ${o.iva_pct}%</span></div>
    ${tablaItemsHtml(o.items)}
    ${cierreHtml(o, pctAnticipo)}
  </div>`).join('')

  const cuerpo = `
  ${membreteHtml(ctx.empresa, ctx.logo, {
    titulo: `Cotización · ${opciones.length} opciones`,
    numero: numeroEnvio,
    fecha: `Emitida el ${formatFecha(primera.fecha_emision)}`,
  })}

  <div class="bloques">
    ${clienteHtml(cliente)}
    <div class="bloque">
      <h2>Datos de la cotización</h2>
      <dl class="campos">
        <dt>Opciones</dt><dd>${opciones.map((o) => o.opcion_etiqueta).join(', ')}</dd>
        <dt>Emisión</dt><dd>${formatFecha(primera.fecha_emision)}</dd>
        <dt>Vence</dt><dd>${primera.fecha_vencimiento ? formatFecha(primera.fecha_vencimiento) : '—'}</dd>
      </dl>
    </div>
  </div>

  ${comparativo}
  ${secciones}

  ${pieHtml(primera.notas, ctx.cuentas)}`
  return documento(`Cotización ${numeroEnvio}`, cuerpo)
}

/** Trazos de cada tipo, en SVG en línea: los emojis no salen igual en todos los equipos ni en la imagen. */
const TRAZOS_TIPO: Record<TipoCategoria, string> = {
  puerta: '<rect x="5" y="2" width="14" height="20" rx="1"/><circle cx="15.5" cy="12" r="1"/>',
  ventana: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M12 3v18M3 12h18"/>',
  division: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M12 3v18"/>',
  espejo: '<rect x="5" y="2" width="14" height="20" rx="7"/><path d="M9.5 8.5l3-3M9.5 12.5l5-5"/>',
  otro: '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>',
}

const iconoTipo = (tipo: TipoCategoria) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="${TIPO_CATEGORIA_CONFIG[tipo].color}" stroke-width="1.8" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TRAZOS_TIPO[tipo]}</svg>`

const coloresTipo = (tipo: TipoCategoria) =>
  `--c:${TIPO_CATEGORIA_CONFIG[tipo].color};--f:${TIPO_CATEGORIA_CONFIG[tipo].fondo}`

/** Una o dos líneas con lo que distingue la opción: materiales, color y medidas del primer ítem. */
function detalleTarjeta(items: CotizacionItem[]) {
  const primero = items[0]
  if (!primero) return ''
  // Un color fuera del catálogo vuelve como código hexadecimal: no le dice nada al cliente.
  const color = nombreColorPerfil(primero.color_perfil)
  const partes = [
    ...resumenOpciones(primero.opciones),
    color && !color.startsWith('#') ? color : null,
    primero.ancho_cm && primero.alto_cm ? `${primero.ancho_cm} × ${primero.alto_cm} cm` : null,
  ].filter(Boolean) as string[]
  const texto = partes.length > 0 ? partes.join(' · ') : primero.descripcion
  const recortado = texto.length > 110 ? `${texto.slice(0, 107)}…` : texto
  const mas = items.length > 1 ? ` <strong>+${items.length - 1} ${items.length === 2 ? 'ítem' : 'ítems'}</strong>` : ''
  return `${escapar(recortado)}${mas}`
}

/**
 * Envío dividido en partes (p. ej. una puerta y una ventana). Arriba, cada
 * parte con sus opciones en tarjetas y un recuadro para que el cliente indique
 * su elección; después, el detalle de cada opción.
 */
function htmlEnvioPorCategorias(
  opciones: CotizacionConItems[],
  cliente: Cliente | undefined,
  ctx: ContextoImpresion,
  categorias: EnvioCategoria[],
) {
  const primera = opciones[0]
  const numeroEnvio = numeroBaseEnvio(primera.numero)
  const pctAnticipo = ctx.empresa?.anticipo_solicitado_pct
  const partes = categorias
    .map((cat) => ({ cat, opciones: opciones.filter((o) => o.categoria_id === cat.id) }))
    .filter((p) => p.opciones.length > 0)
  const rango = rangoTotales(partes.map((p) => p.opciones.map((o) => o.total)))
  const codigo = (cat: EnvioCategoria, o: Cotizacion) => codigoOpcion(cat.orden, o.opcion_etiqueta ?? '')

  const tarjetas = partes.map(({ cat, opciones: deEsta }) => {
    const minimo = Math.min(...deEsta.map((o) => o.total))
    const variasOpciones = deEsta.length > 1
    return `
  <div class="cat" style="${coloresTipo(cat.tipo)}">
    <div class="cat-cab">${iconoTipo(cat.tipo)}${escapar(cat.nombre)}<span class="sub">${
      variasOpciones ? `${deEsta.length} opciones · elija una` : '1 opción'
    }</span></div>
    <div class="tarjetas">${deEsta.map((o) => `
      <div class="tarjeta${o.recomendada ? ' reco' : ''}">
        ${o.recomendada ? '<span class="cinta">★ Recomendada</span>' : ''}
        <div class="cab">
          <span class="letra">${escapar(o.opcion_etiqueta ?? '')}</span>
          <span class="nombre">${escapar(o.opcion_nombre ?? `Opción ${o.opcion_etiqueta}`)}</span>
        </div>
        <div class="det">${detalleTarjeta(o.items)}</div>
        <div class="precio">${formatCOP(o.total)}</div>
        ${variasOpciones ? `<div class="dif">${
          o.total - minimo > 0.5 ? `+ ${formatCOP(o.total - minimo)} frente a la más económica` : 'La más económica'
        }</div>` : ''}
        <div class="num">Opción ${escapar(codigo(cat, o))} · ${escapar(o.numero)}</div>
      </div>`).join('')}
    </div>
  </div>`
  }).join('')

  const eleccion = `
  <div class="eleccion">
    <div>
      <h2>${rango.min === rango.max ? 'Total' : 'Total según su elección'}</h2>
      <div class="rango">${rango.min === rango.max ? formatCOP(rango.min) : `Desde ${formatCOP(rango.min)} hasta ${formatCOP(rango.max)}`}</div>
      <p class="nota">Si toma todas las partes. Puede tomar solo algunas.</p>
    </div>
    <div>
      ${pctAnticipo ? `<h2>Anticipo</h2><div><strong>${pctAnticipo}%</strong> del pedido elegido</div>` : ''}
      ${primera.fecha_vencimiento ? `<p class="nota">Precios válidos hasta el ${formatFecha(primera.fecha_vencimiento)}</p>` : ''}
    </div>
    <div class="marcar">
      <span>Indíquenos su elección:</span>
      ${partes.map(({ cat }) => `<span>${escapar(cat.nombre)}<b></b></span>`).join('')}
    </div>
  </div>`

  const detalle = partes.map(({ cat, opciones: deEsta }) => `
  <div class="cat" style="${coloresTipo(cat.tipo)}">
    <div class="cat-cab">${iconoTipo(cat.tipo)}${escapar(cat.nombre)}</div>
    ${deEsta.map((o) => `
    <div class="opcion">
      <div class="titulo"><strong>Opción ${escapar(o.opcion_etiqueta ?? '')}${o.opcion_nombre ? ` – ${escapar(o.opcion_nombre)}` : ''}</strong><span>${escapar(o.numero)} · IVA ${o.iva_pct}%</span></div>
      ${tablaItemsHtml(o.items)}
      ${cierreHtml(o, null)}
    </div>`).join('')}
  </div>`).join('')

  const cuerpo = `
  ${membreteHtml(ctx.empresa, ctx.logo, {
    titulo: `Cotización · ${partes.length} ${partes.length === 1 ? 'parte' : 'partes'}, ${opciones.length} opciones`,
    numero: numeroEnvio,
    fecha: `Emitida el ${formatFecha(primera.fecha_emision)}`,
  })}

  <div class="bloques">
    ${clienteHtml(cliente)}
    <div class="bloque">
      <h2>Datos de la cotización</h2>
      <dl class="campos">
        <dt>Partes</dt><dd>${partes.map((p) => escapar(p.cat.nombre)).join(', ')}</dd>
        <dt>Emisión</dt><dd>${formatFecha(primera.fecha_emision)}</dd>
        <dt>Vence</dt><dd>${primera.fecha_vencimiento ? formatFecha(primera.fecha_vencimiento) : '—'}</dd>
      </dl>
    </div>
  </div>

  <p class="partes-intro">Para cada parte le ofrecemos varias opciones. Elija una por parte, o solo las partes que le interesen.</p>
  ${tarjetas}
  ${eleccion}

  <div class="detalle-titulo">Detalle de cada opción</div>
  ${detalle}

  ${pieHtml(primera.notas, ctx.cuentas)}`
  return documento(`Cotización ${numeroEnvio}`, cuerpo)
}

export function abrirYImprimir(html: string) {
  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(html)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 400)
}

/**
 * Descarga como imagen PNG el mismo documento que se imprime (una cotización
 * o el envío completo), para mandarlo por WhatsApp. Una cotización de varias
 * páginas sale como una sola imagen larga.
 */
export async function descargarImagen(html: string, nombreArchivo: string) {
  const png = await htmlAPng(html, ANCHO_CARTA_PX)
  descargarBlob(png, `${nombreArchivo}.png`)
}
