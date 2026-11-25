import type { SesionCajaHistorial } from '@/hooks/useCajaSesiones'
import type { VentaConCotizacion } from '@/hooks/useVentasCaja'
import { TOLERANCIA_CAJA, calcularArqueo, estadoArqueo, textoDiferencia, type EstadoArqueo } from '@/lib/caja'
import { escapar, membreteCss, membreteHtml } from '@/lib/documentos'
import { abrirYImprimir } from '@/lib/imprimirCotizacion'
import { METODO_PAGO_LABEL } from '@/lib/pagos'
import {
  SECCIONES_TURNO, agruparTransacciones, nombrePersona, type GrupoTurno,
} from '@/lib/transaccionesTurno'
import { formatCOP, formatDuracion, formatFecha, formatFechaHora, formatHora } from '@/lib/utils'
import type { ConfiguracionEmpresa, MovimientoCajaConUsuario } from '@/types/database'

/**
 * Cierre de caja para imprimir o guardar como PDF: el acta del turno que firma
 * quien entrega la caja. Lleva siempre todas las transacciones, sin los filtros
 * que el usuario tenga puestos en pantalla.
 */

export interface ContextoCierre {
  empresa: ConfiguracionEmpresa | null | undefined
  /** Data URI del logo (ver useLogoEmpresaDataUri). */
  logo: string | null | undefined
}

export interface DatosCierre {
  sesion: SesionCajaHistorial
  ventas: VentaConCotizacion[]
  movimientos: MovimientoCajaConUsuario[]
}

const css = `
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;font-size:10.5px;line-height:1.35;color:#000;padding:1.2cm;
      -webkit-print-color-adjust:exact;print-color-adjust:exact}
${membreteCss}
    h2{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;
      padding-bottom:3px;border-bottom:1px solid #999;margin:14px 0 6px}
    .turno{display:grid;grid-template-columns:repeat(4,1fr);gap:4px 16px}
    .turno dt{color:#555;font-size:9px}
    .turno dd{font-weight:600}
    .turno .sub{display:block;font-weight:400;color:#555;font-size:9.5px}
    /* El resultado es lo primero que busca quien recibe el cierre. */
    .resultado{display:grid;grid-template-columns:1.3fr 1fr 1fr 1fr;border:1.5px solid #000;margin-top:12px;
      page-break-inside:avoid}
    .resultado>div{padding:7px 10px}
    .resultado>div+div{border-left:1px solid #999}
    .resultado .et{font-size:9px;color:#555;text-transform:uppercase;letter-spacing:.05em}
    .resultado .val{font-size:14px;font-weight:700;white-space:nowrap}
    .resultado .estado .val{font-size:15px}
    .resultado .estado.fuera .val{color:#b91c1c}
    .resultado .nota{font-size:9px;color:#333;margin-top:1px}
    .observacion{border:1px solid #999;padding:6px 9px;margin-top:8px;white-space:pre-wrap;page-break-inside:avoid}
    .observacion b{display:block;font-size:9px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px}
    .dos{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
    table{width:100%;border-collapse:collapse}
    th{text-align:left;padding:3px 5px;font-size:8.5px;text-transform:uppercase;letter-spacing:.05em;
      border-bottom:1.5px solid #000;border-top:1px solid #000}
    td{padding:3px 5px;border-bottom:1px solid #ddd;vertical-align:top}
    tr{page-break-inside:avoid}
    .r{text-align:right;white-space:nowrap}
    /* Anchos fijos: las tablas de ventas, gastos, retiros y devoluciones alinean sus columnas. */
    table.tx{table-layout:fixed}
    table.tx td{overflow-wrap:anywhere}
    .dim{color:#555;font-size:9px}
    .grupo td{font-weight:700;font-size:9.5px;padding-top:7px;border-bottom:1px solid #999}
    .pie td{font-weight:600;background:#f3f4f6}
    .pie td:first-child{text-align:right;font-size:9.5px}
    .total td{font-weight:700;border-top:1.5px solid #000;border-bottom:3px double #000}
    .anulada td{color:#666}
    .anulada .tachar{text-decoration:line-through}
    .marca-anulada{font-size:8.5px;font-weight:700;color:#b91c1c;text-decoration:none}
    .mono{font-family:"Courier New",monospace;font-size:10px}
    .vacio{color:#555;font-style:italic;padding:3px 0}
    .seccion{margin-top:8px}
    .seccion h3{font-size:10px;font-weight:700;margin-bottom:2px}
    .firmas{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:42px;page-break-inside:avoid}
    .firma{border-top:1px solid #000;padding-top:4px;font-size:9.5px}
    .firma b{display:block;font-size:10.5px}
    @media print{body{padding:0}@page{size:letter;margin:1.2cm}}`

const ESTADO_TEXTO: Record<EstadoArqueo, string> = {
  cuadra: 'El efectivo contado coincide con el sistema.',
  tolerancia: `Dentro de la tolerancia de ${formatCOP(TOLERANCIA_CAJA)}.`,
  fuera: `Supera la tolerancia de ${formatCOP(TOLERANCIA_CAJA)}.`,
}

const monto = (valor: number, signo = false) => formatCOP(valor, { signo })

function turnoHtml(sesion: SesionCajaHistorial) {
  // Un turno que cruza la medianoche dice el día del cierre: "04:43 p. m. → 01:13 p. m." solo no se entiende.
  const mismoDia = !!sesion.closed_at && formatFecha(sesion.opened_at) === formatFecha(sesion.closed_at)
  const cierre = !sesion.closed_at ? 'abierta' : mismoDia ? formatHora(sesion.closed_at) : formatFechaHora(sesion.closed_at)
  const horario = `${formatHora(sesion.opened_at)} → ${cierre}`
  const duracion = sesion.closed_at ? `<span class="sub">${formatDuracion(sesion.opened_at, sesion.closed_at)}</span>` : ''
  return `
  <dl class="turno">
    <div><dt>Turno del</dt><dd>${formatFecha(sesion.opened_at)}</dd></div>
    <div><dt>Horario</dt><dd>${horario}${duracion}</dd></div>
    <div><dt>Abrió</dt><dd>${escapar(nombrePersona(sesion.abierta_por))}</dd></div>
    <div><dt>Cerró</dt><dd>${sesion.closed_at ? escapar(nombrePersona(sesion.cerrada_por)) : '—'}</dd></div>
  </dl>`
}

function resultadoHtml(esperado: number, contado: number | null) {
  if (contado == null) {
    return `
  <div class="resultado">
    <div class="estado"><div class="et">Resultado</div><div class="val">Sin conteo</div></div>
    <div><div class="et">Esperado</div><div class="val">${monto(esperado)}</div></div>
    <div><div class="et">Contado</div><div class="val">—</div></div>
    <div><div class="et">Diferencia</div><div class="val">—</div></div>
  </div>`
  }
  const diferencia = contado - esperado
  const estado = estadoArqueo(diferencia)
  return `
  <div class="resultado">
    <div class="estado ${estado}">
      <div class="et">Resultado</div>
      <div class="val">${textoDiferencia(diferencia)}</div>
      <div class="nota">${ESTADO_TEXTO[estado]}</div>
    </div>
    <div><div class="et">Esperado en sistema</div><div class="val">${monto(esperado)}</div></div>
    <div><div class="et">Contado físicamente</div><div class="val">${monto(contado)}</div></div>
    <div><div class="et">Diferencia</div><div class="val">${monto(diferencia, true)}</div></div>
  </div>`
}

function formulaHtml(cifras: ReturnType<typeof calcularArqueo>, esperadoGuardado: number) {
  const terminos: [string, string, number, boolean][] = [
    ['', 'Base inicial', cifras.fondo, true],
    ['+', 'Ventas en efectivo (incluye anuladas)', cifras.ventasEfectivo, true],
    ['−', 'Gastos en efectivo', cifras.gastos, true],
    ['−', 'Retiros de efectivo', cifras.retiros, true],
    ['−', 'Devoluciones (reversos de anulación)', cifras.reversos, false],
  ]
  const filas = terminos
    .filter(([, , valor, siempre]) => siempre || valor !== 0)
    .map(([signo, nombre, valor]) => `<tr><td>${signo} ${nombre}</td><td class="r">${monto(valor)}</td></tr>`)
    .join('')
  // La cifra que vale es la que guardó cerrar_caja; si algo cambió después, se dice.
  const difiere = Math.round(cifras.efectivoEsperado) !== Math.round(esperadoGuardado)
  return `
  <div>
    <h2>Cómo se calcula el efectivo esperado</h2>
    <table>
      <tbody>${filas}
        <tr class="total"><td>= Efectivo esperado</td><td class="r">${monto(cifras.efectivoEsperado)}</td></tr>
      </tbody>
    </table>
    ${difiere ? `<p class="dim" style="margin-top:3px">Cifra registrada al cerrar: <b>${monto(esperadoGuardado)}</b>. Hubo cambios en el turno después del cierre.</p>` : ''}
  </div>`
}

function desgloseHtml(cifras: ReturnType<typeof calcularArqueo>, esperado: number) {
  const tarjeta = cifras.porMetodo.tarjeta
  const transferencia = cifras.porMetodo.transferencia
  return `
  <div>
    <h2>Desglose por método de pago</h2>
    <table>
      <thead><tr><th>Método</th><th class="r">Esperado</th></tr></thead>
      <tbody>
        <tr><td>Efectivo en cajón <span class="dim">(fondo + cobros − egresos)</span></td><td class="r">${monto(esperado)}</td></tr>
        <tr><td>${METODO_PAGO_LABEL.tarjeta} <span class="dim">(se verifica en el banco)</span></td><td class="r">${monto(tarjeta)}</td></tr>
        <tr><td>${METODO_PAGO_LABEL.transferencia} <span class="dim">(Nequi y similares)</span></td><td class="r">${monto(transferencia)}</td></tr>
        <tr class="total"><td>Total dinero</td><td class="r">${monto(esperado + tarjeta + transferencia)}</td></tr>
        ${cifras.creditoFinanciera > 0 ? `
        <tr><td>${METODO_PAGO_LABEL.financiera} <span class="dim">(a crédito: no entró a caja)</span></td><td class="r">${monto(cifras.creditoFinanciera)}</td></tr>` : ''}
      </tbody>
    </table>
    <p class="dim" style="margin-top:3px">${cifras.numCobros === 1 ? '1 cobro vigente' : `${cifras.numCobros} cobros vigentes`} en el turno.</p>
  </div>`
}

function tablaGruposHtml(grupos: GrupoTurno[]) {
  if (grupos.length === 0) return '<p class="vacio">Sin movimientos.</p>'
  const cuerpo = grupos.map((g) => {
    const titulo = g.titulo ? `<tr class="grupo"><td colspan="6">${escapar(g.titulo)}</td></tr>` : ''
    const filas = g.filas.map((f) => {
      const recibo = f.venta?.numero_recibo ? `<div class="dim mono">${escapar(f.venta.numero_recibo)}</div>` : ''
      const anulada = f.anulada
        ? `<div class="marca-anulada">ANULADA${f.motivoAnulacion ? `: ${escapar(f.motivoAnulacion)}` : ''}</div>`
        : ''
      const nota = f.nota ? `<div class="dim">${escapar(f.nota)}</div>` : ''
      return `
        <tr${f.anulada ? ' class="anulada"' : ''}>
          <td class="r">${f.hora}</td>
          <td><span class="tachar${f.venta ? ' mono' : ''}">${escapar(f.documento)}</span>${recibo}${anulada}</td>
          <td>${escapar(f.detalle)}${nota}</td>
          <td>${METODO_PAGO_LABEL[f.metodo]}</td>
          <td>${escapar(f.cajero)}</td>
          <td class="r"><span class="tachar">${monto(f.monto)}</span></td>
        </tr>`
    }).join('')
    const pie = g.pie.map((p) => `
        <tr class="pie"><td colspan="5">${escapar(p.etiqueta)}</td><td class="r">${monto(p.valor)}</td></tr>`).join('')
    return titulo + filas + pie
  }).join('')
  return `
    <table class="tx">
      <colgroup><col style="width:9%"/><col style="width:25%"/><col style="width:26%"/><col style="width:12%"/><col style="width:14%"/><col style="width:14%"/></colgroup>
      <thead><tr><th class="r">Hora</th><th>Documento / concepto</th><th>Detalle</th><th>Método</th><th>Cajero</th><th class="r">Monto</th></tr></thead>
      <tbody>${cuerpo}</tbody>
    </table>`
}

export function htmlCierreCaja({ sesion, ventas, movimientos }: DatosCierre, ctx: ContextoCierre) {
  const cifras = calcularArqueo(ventas, movimientos, sesion.opening_amount)
  // Con el turno cerrado manda lo que guardó cerrar_caja, no el recálculo.
  const esperado = sesion.expected_amount ?? cifras.efectivoEsperado
  // En papel, en orden de hora: la pantalla muestra los gastos del más reciente al más viejo.
  const enOrden = [...movimientos].sort((x, y) => x.created_at.localeCompare(y.created_at))
  const grupos = agruparTransacciones(ventas, enOrden)
  const secciones = SECCIONES_TURNO
    .filter((s) => s.id === 'ventas' || grupos[s.id].length > 0)
    .map((s) => `
  <div class="seccion">
    <h3>${s.nombre}</h3>
    ${tablaGruposHtml(grupos[s.id])}
  </div>`).join('')

  const cuerpo = `
  ${membreteHtml(ctx.empresa, ctx.logo, {
    titulo: 'Cierre de caja',
    numero: formatFecha(sesion.opened_at),
    fecha: `Impreso el ${formatFechaHora(new Date().toISOString())}`,
  })}
  ${turnoHtml(sesion)}
  ${resultadoHtml(esperado, sesion.counted_amount)}
  ${sesion.observacion_cierre ? `
  <div class="observacion"><b>Observación del cierre</b>${escapar(sesion.observacion_cierre)}</div>` : ''}

  <div class="dos">
    ${formulaHtml(cifras, esperado)}
    ${desgloseHtml(cifras, esperado)}
  </div>

  <h2>Transacciones del turno</h2>
  ${secciones}

  <div class="firmas">
    <div class="firma"><b>${sesion.closed_at ? escapar(nombrePersona(sesion.cerrada_por)) : '&nbsp;'}</b>Entregó la caja</div>
    <div class="firma"><b>&nbsp;</b>Recibió / revisó</div>
  </div>`

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>Cierre de caja ${escapar(formatFecha(sesion.opened_at))}</title>
  <style>${css}
  </style>
</head>
<body>
${cuerpo}
</body>
</html>`
}

export function imprimirCierreCaja(datos: DatosCierre, ctx: ContextoCierre) {
  abrirYImprimir(htmlCierreCaja(datos, ctx))
}
