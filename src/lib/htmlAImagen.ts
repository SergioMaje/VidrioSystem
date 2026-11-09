/**
 * Convierte un documento HTML completo (los de imprimirCotizacion o
 * imprimirRecibo) en una imagen PNG, sin dependencias.
 *
 * Cómo: el documento se monta en un iframe fuera de pantalla para medir su
 * alto, se serializa como XHTML dentro de un SVG <foreignObject>, y ese SVG se
 * dibuja en un canvas. Funciona porque todo es autocontenido: los estilos van
 * en el <style> del documento y el logo es un data URI. Una imagen externa
 * (una URL http) no se dibujaría.
 */

/** Monta el HTML en un iframe invisible del ancho pedido y espera a que carguen sus imágenes. */
async function montar(html: string, ancho: number): Promise<HTMLIFrameElement> {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${ancho}px;height:10px;border:0;visibility:hidden`
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument!
  doc.open()
  doc.write(html)
  doc.close()
  await Promise.all(
    Array.from(doc.images).map((img) =>
      img.complete ? Promise.resolve() : new Promise<void>((res) => { img.onload = img.onerror = () => res() })
    )
  )
  return iframe
}

function cargarImagen(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = () => rej(new Error('El navegador no pudo dibujar el documento como imagen'))
    img.src = src
  })
}

/**
 * @param ancho ancho en px CSS del documento (816 px = 21,6 cm a 96 dpi).
 * @param escala resolución: 2 = el doble de píxeles, nítida en el celular.
 */
export async function htmlAPng(html: string, ancho: number, escala = 2): Promise<Blob> {
  const iframe = await montar(html, ancho)
  try {
    const doc = iframe.contentDocument!
    const alto = Math.ceil(doc.documentElement.scrollHeight)
    // XMLSerializer produce XHTML bien formado, con el namespace que exige foreignObject.
    const xhtml = new XMLSerializer().serializeToString(doc.documentElement)
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}" height="${alto}">` +
      `<foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject></svg>`
    const img = await cargarImagen(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)

    const canvas = document.createElement('canvas')
    canvas.width = ancho * escala
    canvas.height = alto * escala
    const ctx = canvas.getContext('2d')!
    // Fondo blanco: un PNG transparente se ve negro en algunos visores (WhatsApp).
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.scale(escala, escala)
    ctx.drawImage(img, 0, 0)

    return await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo generar la imagen'))), 'image/png')
    )
  } finally {
    iframe.remove()
  }
}

/** Dispara la descarga de un blob con el nombre dado. */
export function descargarBlob(blob: Blob, nombreArchivo: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Se libera después: revocarlo en el mismo tick cancela la descarga en algunos navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
