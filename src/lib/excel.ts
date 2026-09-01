import ExcelJS from 'exceljs'

/**
 * Mecánica compartida de las plantillas .xlsx: estilos, lectura tolerante de
 * celdas y validación de campos. Vive aparte de excelProductos/excelStock
 * porque las dos plantillas son la misma máquina con distintas columnas — una
 * crea items y la otra les mete stock — y la única diferencia real está en qué
 * valida cada fila.
 */

export const AZUL_ENCABEZADO = 'FF1E3A8A'
export const AZUL_CLARO = 'FFDCE6F7'
export const GRIS_EJEMPLO = 'FFF3F4F6'
export const VERDE_ENCABEZADO = 'FF166534'
export const VERDE_CLARO = 'FFDCFCE7'
/** Las columnas que el usuario no debe tocar (código y nombre ya resueltos). */
export const GRIS_BLOQUEADO = 'FFE5E7EB'

const BORDE_GRIS: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFB0B0B0' } }

export function bordesCelda(): Partial<ExcelJS.Borders> {
  return { top: BORDE_GRIS, left: BORDE_GRIS, bottom: BORDE_GRIS, right: BORDE_GRIS }
}

/** Encabezado en blanco sobre color, centrado y con la fila más alta. */
export function estilarEncabezado(hoja: ExcelJS.Worksheet, colorFondo: string) {
  const fila = hoja.getRow(1)
  fila.eachCell((celda) => {
    celda.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorFondo } }
    celda.alignment = { vertical: 'middle', horizontal: 'center' }
    celda.border = bordesCelda()
  })
  fila.height = 22
}

/** Fila de datos con cebra y bordes; devuelve la fila para seguir estilándola. */
export function agregarFilaCebra(
  hoja: ExcelJS.Worksheet,
  valores: unknown[],
  indice: number,
  colorAlterno: string
): ExcelJS.Row {
  const fila = hoja.addRow(valores)
  fila.eachCell({ includeEmpty: true }, (celda) => {
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: indice % 2 === 0 ? 'FFFFFFFF' : colorAlterno } }
    celda.border = bordesCelda()
  })
  return fila
}

/** Escribe el libro y lo dispara como descarga con nombre saneado. */
export async function descargarLibro(wb: ExcelJS.Workbook, nombreArchivo: string) {
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${nombreArchivo.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

export function nuevoLibro(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Glazz'
  return wb
}

/**
 * Hoja "Catálogos" de solo lectura: cada columna es la lista de valores que la
 * plantilla acepta en su columna equivalente, para que el usuario copie de ahí
 * en vez de adivinar cómo se escribe una categoría.
 */
export function agregarHojaCatalogos(wb: ExcelJS.Workbook, columnas: { titulo: string; valores: string[] }[]) {
  const hoja = wb.addWorksheet('Catálogos')
  hoja.columns = columnas.map((c) => ({ header: c.titulo, width: 30 }))
  estilarEncabezado(hoja, VERDE_ENCABEZADO)

  const filas = Math.max(...columnas.map((c) => c.valores.length), 0)
  for (let i = 0; i < filas; i++) {
    agregarFilaCebra(hoja, columnas.map((c) => c.valores[i] ?? ''), i, VERDE_CLARO)
  }
  return hoja
}

export function normalizar(texto: string) {
  return texto.trim().toLowerCase()
}

/**
 * `null` = la celda venía vacía, `NaN` = traía algo que no es un número >= 0.
 * Se distinguen porque el mensaje de error no es el mismo: falta un dato o el
 * dato está mal escrito.
 */
export function numeroValido(valor: unknown): number | null {
  if (valor === undefined || valor === null || valor === '') return null
  const n = typeof valor === 'number' ? valor : Number(String(valor).replace(/,/g, ''))
  return Number.isFinite(n) && n >= 0 ? n : NaN
}

/**
 * Aplana el valor de una celda: ExcelJS no siempre entrega un primitivo, una celda
 * puede venir como fórmula, texto enriquecido, hipervínculo o error.
 */
export function valorCelda(valor: ExcelJS.CellValue): string | number {
  if (valor === null || valor === undefined) return ''
  if (typeof valor === 'number' || typeof valor === 'string') return valor
  if (typeof valor === 'boolean') return String(valor)
  if (valor instanceof Date) return valor.toISOString()
  if (typeof valor === 'object') {
    if ('error' in valor) return ''
    if ('result' in valor) return valorCelda(valor.result as ExcelJS.CellValue)
    if ('richText' in valor) return valor.richText.map((t) => t.text).join('')
    if ('text' in valor) return String(valor.text)
  }
  return String(valor)
}

export interface FilaLeida {
  /** Número real de fila en Excel, para que el error apunte a lo que el usuario ve. */
  numero: number
  datos: Record<string, string | number>
}

export interface HojaLeida {
  encabezados: string[]
  filas: FilaLeida[]
}

/**
 * Abre el .xlsx y devuelve las filas de la hoja indicada indexadas por el texto
 * de su encabezado. `row.values` es 1-indexado (la posición 0 va vacía), así que
 * encabezados y valores se alinean por índice sin corrimientos.
 *
 * Los encabezados se devuelven aparte para poder distinguir "la columna no está"
 * de "la columna está vacía": si el usuario renombró o borró una columna, todas
 * las filas se leerían en blanco y el error sería incomprensible.
 */
export async function leerHoja(file: File, nombreHoja: string): Promise<HojaLeida | null> {
  const buffer = await file.arrayBuffer()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const hoja = wb.getWorksheet(nombreHoja) ?? wb.worksheets[0]
  if (!hoja) return null

  // Sin filtrar los vacíos: la posición en este arreglo es la columna del Excel.
  const columnas = (hoja.getRow(1).values as ExcelJS.CellValue[]).map((v) => String(valorCelda(v)).trim())

  const filas: FilaLeida[] = []
  hoja.eachRow((fila, numero) => {
    if (numero === 1) return
    const valores = fila.values as ExcelJS.CellValue[]
    const datos: Record<string, string | number> = {}
    columnas.forEach((titulo, i) => {
      if (!titulo) return
      datos[titulo] = valorCelda(valores[i])
    })
    filas.push({ numero, datos })
  })
  return { encabezados: columnas.filter((t) => t !== ''), filas }
}

/** Devuelve los encabezados exigidos que no aparecen en la hoja. */
export function columnasFaltantes(encabezados: string[], requeridas: readonly string[]) {
  const presentes = new Set(encabezados.map(normalizar))
  return requeridas.filter((c) => !presentes.has(normalizar(c)))
}

export function texto(fila: Record<string, string | number>, columna: string) {
  return String(fila[columna] ?? '').trim()
}

export interface ErrorImportacion {
  fila: number
  motivo: string
}
