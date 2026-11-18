import { escapar, membreteCss, membreteHtml } from '@/lib/documentos'
import { estaLiquidada } from '@/lib/pagos'
import { etiquetaDocumento, tablaItemsCss, tablaItemsHtml, totalesFilasHtml, type ContextoImpresion } from '@/lib/imprimirCotizacion'
import { numeroALetras } from '@/lib/numeroALetras'
import { ANCHO_CARTA_PX, descargarBlob, htmlAPng } from '@/lib/htmlAImagen'
import { supabase } from '@/lib/supabase'
import { formatCOP, formatFecha, formatFechaHora, hoyBogota } from '@/lib/utils'
import type { Cliente, Cotizacion, CotizacionItem, CuentaCobro, CotizacionSaldo } from '@/types/database'

/**
 * Cuenta de cobro: el documento con el que una empresa con crédito paga lo que
 * se le entregó. Va en carta, con el detalle del trabajo, el plazo y las
 * cuentas bancarias para consignar.
 *
 * No es una factura electrónica: sirve a la vidriería que no está obligada a
 * facturar. Si lo está, la DIAN será la fase 2 sobre este mismo documento.
 */

export interface DatosCuentaCobro {
  cuenta: CuentaCobro
  cotizacion: Pick<Cotizacion, 'id' | 'numero' | 'subtotal' | 'descuento_pct' | 'iva_pct' | 'total'> & {
    cliente: Cliente | null
    items: CotizacionItem[]
  }
  orden: { numero: string } | null
  /** Cómo va hoy: los abonos después de emitir bajan el saldo. */
  saldo: Pick<CotizacionSaldo, 'total_abonado' | 'saldo'>
}

/** Reúne los datos de la cuenta de cobro. Se llama al hacer clic, no al pintar. */
export async function obtenerDatosCuentaCobro(cuentaId: string): Promise<DatosCuentaCobro> {
  const { data: cuenta, error } = await supabase.from('cuentas_cobro').select('*').eq('id', cuentaId).single()
  if (error) throw error
  const cc = cuenta as CuentaCobro

  const [cot, orden, saldo] = await Promise.all([
    supabase
      .from('cotizaciones')
      .select('id, numero, subtotal, descuento_pct, iva_pct, total, cliente:clientes(*), items:cotizacion_items(*)')
      .eq('id', cc.cotizacion_id)
      .single(),
    cc.orden_id
      ? supabase.from('ordenes_trabajo').select('numero').eq('id', cc.orden_id).single()
      : Promise.resolve({ data: null, error: null }),
    supabase.from('cotizaciones_saldo').select('total_abonado, saldo').eq('cotizacion_id', cc.cotizacion_id).single(),
  ])
  if (cot.error) throw cot.error
  if (orden.error) throw orden.error
  if (saldo.error) throw saldo.error

  return {
    cuenta: cc,
    cotizacion: cot.data as unknown as DatosCuentaCobro['cotizacion'],
    orden: orden.data as { numero: string } | null,
    saldo: saldo.data as DatosCuentaCobro['saldo'],
  }
}

const css = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.35;color:#000;padding:1.2cm;
      -webkit-print-color-adjust:exact;print-color-adjust:exact}
${membreteCss}
    .deudor{margin:4px 0 12px;text-align:center}
    .deudor .razon{font-size:15px;font-weight:700}
    .deudor .doc{color:#555}
    .debe{margin:8px 0 2px;font-size:10px;font-weight:700;letter-spacing:.2em;color:#555}
    .campos{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;margin-bottom:12px}
    .campos dt{color:#555;white-space:nowrap}
    .campos dd{font-weight:600;word-break:break-word}
    .monto{font-size:16px;font-weight:700}
    .letras{display:block;font-weight:400;font-style:italic;color:#333;font-size:10px}
    .vence{color:#b45309}
${tablaItemsCss}
    .detalle h2,.caja h2{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px}
    .pie{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px;align-items:start}
    .caja{border:1px solid #999;padding:6px 9px;page-break-inside:avoid}
    .caja .row{display:flex;justify-content:space-between;padding:1.5px 0}
    .caja .final{border-top:1px solid #999;margin-top:3px;padding-top:4px;font-weight:700;font-size:12px}
    .caja .pagado{margin-top:4px;text-align:center;font-weight:700;color:#047857}
    .cuenta{padding:2px 0}
    .cuenta+.cuenta{border-top:1px solid #ddd;margin-top:2px}
    .cuenta-banco{font-weight:600}
    .cuenta-num{font-family:"Courier New",monospace}
    .cuenta-tit{font-size:10px;color:#555}
    .atte{margin-top:22px}
    .anulado{border:2px solid #b91c1c;color:#b91c1c;font-weight:700;text-align:center;
      padding:5px;margin-bottom:10px;font-size:13px;letter-spacing:.1em}
    .anulado span{display:block;font-size:10px;font-weight:400;letter-spacing:0}
    @media print{body{padding:0}@page{size:letter;margin:1.2cm}}`

/** A una empresa se le nombra por su razón social; a una persona, por su nombre. */
const nombreCliente = (cli: Cliente | null) =>
  !cli ? '—' : cli.empresa ?? `${cli.nombre} ${cli.apellido}`.trim()

export function htmlCuentaCobro(datos: DatosCuentaCobro, ctx: ContextoImpresion) {
  const { cuenta, cotizacion, orden, saldo } = datos
  const cli = cotizacion.cliente
  const plazo = Math.round(
    (new Date(cuenta.fecha_vencimiento + 'T00:00:00').getTime() - new Date(cuenta.fecha_emision + 'T00:00:00').getTime())
      / 86_400_000
  )

  const anulado = !cuenta.anulado_at ? '' : `
  <div class="anulado">ANULADA<span>El ${formatFechaHora(cuenta.anulado_at)}${
    cuenta.motivo_anulacion ? ` · ${escapar(cuenta.motivo_anulacion)}` : ''
  }</span></div>`

  const concepto = [
    `Trabajo de la cotización ${cotizacion.numero}`,
    orden ? `Orden ${orden.numero}` : null,
  ].filter(Boolean).join(' · ')

  const cuentasHtml = ctx.cuentas.length === 0 ? '' : `
    <div class="caja">
      <h2>Consignar a</h2>
      ${ctx.cuentas.map((c) => `
      <div class="cuenta">
        <span class="cuenta-banco">${escapar(c.banco)} · ${escapar(c.tipo_cuenta)}</span>
        <span class="cuenta-num">${escapar(c.numero_cuenta)}</span>
        <div class="cuenta-tit">${escapar(c.titular)}</div>
      </div>`).join('')}
    </div>`

  const estadoHtml = `
    <div class="caja">
      <h2>Estado de cuenta al ${formatFecha(hoyBogota())}</h2>
      <div class="row"><span>Total del trabajo</span><span>${formatCOP(cotizacion.total)}</span></div>
      <div class="row"><span>Pagos recibidos</span><span>${formatCOP(saldo.total_abonado)}</span></div>
      <div class="row final"><span>Saldo por pagar</span><span>${formatCOP(Math.max(0, saldo.saldo))}</span></div>
      ${estaLiquidada(saldo.saldo) ? '<div class="pagado">Cuenta pagada en su totalidad</div>' : ''}
    </div>`

  const empresa = ctx.empresa
  const acreedor = [empresa?.nombre, empresa?.nit ? `NIT ${empresa.nit}` : null].filter(Boolean).join(' · ')

  const cuerpo = `
  ${membreteHtml(ctx.empresa, ctx.logo, {
    titulo: 'Cuenta de cobro',
    numero: cuenta.numero,
    fecha: formatFecha(cuenta.fecha_emision),
  })}
  ${anulado}
  <div class="deudor">
    <div class="razon">${escapar(nombreCliente(cli))}</div>
    ${cli?.documento ? `<div class="doc">${etiquetaDocumento(cli.tipo)} ${escapar(cli.documento)}</div>` : ''}
    <div class="debe">DEBE A</div>
    <div class="razon">${escapar(acreedor)}</div>
  </div>

  <dl class="campos">
    <dt>La suma de</dt><dd><span class="monto">${formatCOP(cuenta.monto)}</span>
      <span class="letras">(${escapar(numeroALetras(cuenta.monto))})</span></dd>
    <dt>Por concepto de</dt><dd>${escapar(concepto)}</dd>
    ${cuenta.orden_compra ? `<dt>Orden de compra</dt><dd>${escapar(cuenta.orden_compra)}</dd>` : ''}
    <dt>Fecha de vencimiento</dt><dd class="vence">${formatFecha(cuenta.fecha_vencimiento)}${
      plazo > 0 ? ` <span style="font-weight:400;color:#555">(${plazo} días)</span>` : ''
    }</dd>
  </dl>

  <div class="detalle">
    <h2>Detalle del trabajo</h2>
    ${tablaItemsHtml(cotizacion.items ?? [])}
    <div class="totales">${totalesFilasHtml(cotizacion)}</div>
  </div>

  <div class="pie">${estadoHtml}${cuentasHtml}</div>

  <p class="atte">Atentamente,<br/><strong>${escapar(empresa?.nombre ?? '')}</strong></p>`

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>Cuenta de cobro ${escapar(cuenta.numero)}</title>
  <style>${css}</style>
</head>
<body>
${cuerpo}
</body>
</html>`
}

/**
 * Abre la cuenta de cobro para imprimir o guardar como PDF. La ventana se abre
 * antes de esperar los datos: el navegador bloquea un window.open posterior a
 * un await.
 */
export async function imprimirCuentaCobro(cuentaId: string, ctx: ContextoImpresion) {
  const win = window.open('', '_blank')
  if (!win) return
  win.document.write('<p style="font-family:Arial;padding:2rem;color:#555">Generando cuenta de cobro…</p>')
  try {
    const datos = await obtenerDatosCuentaCobro(cuentaId)
    win.document.open()
    win.document.write(htmlCuentaCobro(datos, ctx))
    win.document.close()
    win.focus()
    setTimeout(() => win.print(), 400)
  } catch (err) {
    win.document.open()
    win.document.write(`<p style="font-family:Arial;padding:2rem;color:#b91c1c">No se pudo generar la cuenta de cobro: ${
      escapar(err instanceof Error ? err.message : String(err))
    }</p>`)
    win.document.close()
  }
}

/** La misma cuenta de cobro como imagen PNG, para mandarla por WhatsApp o correo. */
export async function descargarCuentaCobroImagen(cuentaId: string, ctx: ContextoImpresion) {
  const datos = await obtenerDatosCuentaCobro(cuentaId)
  const png = await htmlAPng(htmlCuentaCobro(datos, ctx), ANCHO_CARTA_PX)
  descargarBlob(png, `Cuenta-de-cobro-${datos.cuenta.numero}.png`)
}
