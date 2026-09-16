import type { ConfiguracionEmpresa } from '@/types/database'

/**
 * Los documentos se arman como strings de HTML que se escriben en una ventana nueva, asi
 * que todo texto que venga de la base de datos tiene que pasar por aqui antes de entrar
 * al markup.
 */
export const escapar = (texto: string) =>
  texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Nombre a mostrar cuando la fila de configuracion todavia no cargo. */
export const nombreEmpresa = (empresa?: ConfiguracionEmpresa | null) => empresa?.nombre ?? ''

export const membreteCss = `
    .membrete{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;
      padding-bottom:8px;border-bottom:1.5px solid #000;margin-bottom:12px}
    .emisor{display:flex;align-items:flex-start;gap:12px}
    /* Alto fijo y object-fit: un logo apaisado y uno cuadrado ocupan lo mismo y el
       membrete no cambia de alto segun el archivo que suba cada vidrieria. */
    .emisor img{max-height:56px;max-width:190px;object-fit:contain}
    .marca{font-size:17px;font-weight:700;letter-spacing:-.01em}
    .marca span{display:block;font-size:10px;font-weight:400;color:#555;letter-spacing:0}
    .marca .contacto{font-size:9px;color:#555;line-height:1.45;margin-top:3px}
    .doc{text-align:right}
    .doc h1{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#555}
    .doc .numero{font-size:17px;font-weight:700}
    .doc .fecha{font-size:10px;color:#555}`

interface DatosDocumento {
  titulo: string
  numero: string
  fecha: string
}

/**
 * Membrete con el logo y los datos de la empresa a la izquierda y la identificacion del
 * documento a la derecha.
 *
 * `logo` es un data URI, no una URL: ver `useLogoEmpresaDataUri`. Si no hay logo ni datos
 * de contacto, el bloque queda igual que cuando la marca estaba escrita en el codigo.
 */
export function membreteHtml(
  empresa: ConfiguracionEmpresa | null | undefined,
  logo: string | null | undefined,
  { titulo, numero, fecha }: DatosDocumento,
) {
  const logoHtml = logo ? `<img src="${logo}" alt=""/>` : ''

  const direccion = [empresa?.direccion, empresa?.ciudad].filter(Boolean).join(', ')
  const contacto = [
    empresa?.nit ? `NIT ${empresa.nit}` : null,
    direccion || null,
    empresa?.telefono ? `Tel. ${empresa.telefono}` : null,
    empresa?.email ?? null,
  ].filter((linea): linea is string => !!linea)

  const contactoHtml = contacto.length === 0 ? '' :
    `<div class="contacto">${contacto.map(escapar).join(' · ')}</div>`

  const eslogan = empresa?.eslogan ? `<span>${escapar(empresa.eslogan)}</span>` : ''

  return `<div class="membrete">
    <div class="emisor">
      ${logoHtml}
      <div class="marca">${escapar(empresa?.nombre ?? '')}${eslogan}${contactoHtml}</div>
    </div>
    <div class="doc">
      <h1>${escapar(titulo)}</h1>
      <div class="numero">${escapar(numero)}</div>
      <div class="fecha">${escapar(fecha)}</div>
    </div>
  </div>`
}
