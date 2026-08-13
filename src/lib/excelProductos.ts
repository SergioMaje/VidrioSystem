import * as XLSX from 'xlsx'
import ExcelJS from 'exceljs'
import type { Categoria, UnidadMedida } from '@/types/database'

/** Encabezados exactos que debe tener la hoja "Productos" del Excel. */
export const COLUMNAS_PLANTILLA = [
  'Código',
  'Nombre',
  'Categoría',
  'Unidad de medida',
  'Precio costo',
  'Precio venta',
] as const

export interface ProductoImportado {
  codigo: string
  nombre: string
  categoria_id: string
  unidad_medida_id: string
  precio_costo: number
  precio_venta: number
}

export interface ErrorImportacion {
  fila: number
  motivo: string
}

export interface ResultadoImportacion {
  validos: ProductoImportado[]
  errores: ErrorImportacion[]
}

const AZUL_ENCABEZADO = 'FF1E3A8A'
const AZUL_CLARO = 'FFDCE6F7'
const GRIS_EJEMPLO = 'FFF3F4F6'
const VERDE_ENCABEZADO = 'FF166534'
const VERDE_CLARO = 'FFDCFCE7'
const BORDE_GRIS: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFB0B0B0' } }

function bordesCelda(): Partial<ExcelJS.Borders> {
  return { top: BORDE_GRIS, left: BORDE_GRIS, bottom: BORDE_GRIS, right: BORDE_GRIS }
}

/** Genera y descarga la plantilla .xlsx con las columnas exigidas, estilo visual y los catálogos válidos de referencia. */
export async function descargarPlantillaProductos(categorias: Categoria[], unidades: UnidadMedida[], nombreProveedor: string) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Glazz'

  const hoja = wb.addWorksheet('Productos', { views: [{ state: 'frozen', ySplit: 1 }] })
  hoja.columns = COLUMNAS_PLANTILLA.map((titulo) => ({ header: titulo, width: 22 }))

  const filaEncabezado = hoja.getRow(1)
  filaEncabezado.eachCell((celda) => {
    celda.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL_ENCABEZADO } }
    celda.alignment = { vertical: 'middle', horizontal: 'center' }
    celda.border = bordesCelda()
  })
  filaEncabezado.height = 22

  const filaEjemplo = hoja.addRow(['ALU-001', 'Perfil de aluminio 3"', categorias[0]?.nombre ?? '', unidades[0]?.nombre ?? '', 25000, 35000])
  filaEjemplo.eachCell((celda) => {
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_EJEMPLO } }
    celda.font = { italic: true, color: { argb: 'FF6B7280' } }
    celda.border = bordesCelda()
  })

  for (let i = 0; i < 30; i++) {
    const fila = hoja.addRow([])
    fila.eachCell({ includeEmpty: true }, (celda) => {
      celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i % 2 === 0 ? 'FFFFFFFF' : AZUL_CLARO } }
      celda.border = bordesCelda()
    })
  }

  const hojaCatalogos = wb.addWorksheet('Catálogos')
  hojaCatalogos.columns = [
    { header: 'Categorías válidas', width: 30 },
    { header: 'Unidades de medida válidas', width: 30 },
  ]
  hojaCatalogos.getRow(1).eachCell((celda) => {
    celda.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE_ENCABEZADO } }
    celda.alignment = { vertical: 'middle', horizontal: 'center' }
    celda.border = bordesCelda()
  })
  hojaCatalogos.getRow(1).height = 22

  const filas = Math.max(categorias.length, unidades.length)
  for (let i = 0; i < filas; i++) {
    const fila = hojaCatalogos.addRow([categorias[i]?.nombre ?? '', unidades[i]?.nombre ?? ''])
    fila.eachCell({ includeEmpty: true }, (celda) => {
      celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i % 2 === 0 ? 'FFFFFFFF' : VERDE_CLARO } }
      celda.border = bordesCelda()
    })
  }

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `plantilla-productos-${nombreProveedor.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

function normalizar(texto: string) {
  return texto.trim().toLowerCase()
}

function numeroValido(valor: unknown): number | null {
  if (valor === undefined || valor === null || valor === '') return null
  const n = typeof valor === 'number' ? valor : Number(String(valor).replace(/,/g, ''))
  return Number.isFinite(n) && n >= 0 ? n : NaN
}

/** Lee el archivo .xlsx y valida estrictamente cada fila contra los catálogos existentes. */
export async function leerProductosExcel(
  file: File,
  categorias: Categoria[],
  unidades: UnidadMedida[],
  codigosExistentes: Set<string>
): Promise<ResultadoImportacion> {
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array' })
  const hoja = wb.Sheets['Productos'] ?? wb.Sheets[wb.SheetNames[0]]
  if (!hoja) return { validos: [], errores: [{ fila: 0, motivo: 'No se encontró la hoja "Productos" en el archivo' }] }

  const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(hoja, { defval: '' })

  const categoriasPorNombre = new Map(categorias.map((c) => [normalizar(c.nombre), c.id]))
  const unidadesPorNombre = new Map(unidades.map((u) => [normalizar(u.nombre), u.id]))
  const codigosVistos = new Set<string>()

  const validos: ProductoImportado[] = []
  const errores: ErrorImportacion[] = []

  filas.forEach((fila, idx) => {
    const numeroFila = idx + 2
    const motivos: string[] = []

    const codigo = String(fila['Código'] ?? '').trim()
    const nombre = String(fila['Nombre'] ?? '').trim()
    const categoriaTexto = String(fila['Categoría'] ?? '').trim()
    const unidadTexto = String(fila['Unidad de medida'] ?? '').trim()

    if (!codigo) motivos.push('Falta el código')
    else if (codigosVistos.has(normalizar(codigo))) motivos.push(`Código duplicado en el archivo: ${codigo}`)
    else if (codigosExistentes.has(normalizar(codigo))) motivos.push(`El código ya existe en el sistema: ${codigo}`)

    if (!nombre) motivos.push('Falta el nombre')

    const categoriaId = categoriasPorNombre.get(normalizar(categoriaTexto))
    if (!categoriaTexto) motivos.push('Falta la categoría')
    else if (!categoriaId) motivos.push(`Categoría no reconocida: "${categoriaTexto}" (ver hoja Catálogos)`)

    const unidadId = unidadesPorNombre.get(normalizar(unidadTexto))
    if (!unidadTexto) motivos.push('Falta la unidad de medida')
    else if (!unidadId) motivos.push(`Unidad de medida no reconocida: "${unidadTexto}" (ver hoja Catálogos)`)

    const precioCosto = numeroValido(fila['Precio costo'])
    if (precioCosto === null) motivos.push('Falta el precio de costo')
    else if (Number.isNaN(precioCosto)) motivos.push('Precio de costo inválido')

    const precioVenta = numeroValido(fila['Precio venta'])
    if (precioVenta === null) motivos.push('Falta el precio de venta')
    else if (Number.isNaN(precioVenta)) motivos.push('Precio de venta inválido')

    // Fila totalmente vacía (usuario dejó espacio de más al final): se ignora sin error.
    const filaVacia = !codigo && !nombre && !categoriaTexto && !unidadTexto && fila['Precio costo'] === '' && fila['Precio venta'] === ''
    if (filaVacia) return

    if (motivos.length > 0) {
      errores.push({ fila: numeroFila, motivo: motivos.join('; ') })
      return
    }

    codigosVistos.add(normalizar(codigo))
    validos.push({
      codigo,
      nombre,
      categoria_id: categoriaId!,
      unidad_medida_id: unidadId!,
      precio_costo: precioCosto!,
      precio_venta: precioVenta!,
    })
  })

  return { validos, errores }
}
