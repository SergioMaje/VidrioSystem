import type { ItemInventario } from '@/types/database'
import {
  AZUL_CLARO, AZUL_ENCABEZADO, GRIS_BLOQUEADO,
  agregarFilaCebra, bordesCelda, descargarLibro, estilarEncabezado,
  columnasFaltantes, leerHoja, normalizar, nuevoLibro, numeroValido, texto,
  type ErrorImportacion,
} from './excel'

export type { ErrorImportacion }

/**
 * Encabezados de la hoja "Stock". A diferencia de la plantilla de productos, esta
 * no se baja vacía: viene con un renglón por item existente y sólo hay que llenar
 * la cantidad. El código es la llave contra el inventario, así que la plantilla lo
 * trae ya escrito para que nadie tenga que transcribirlo.
 */
export const COLUMNAS_STOCK = [
  'Código',
  'Nombre',
  'Unidad',
  'Stock actual',
  'Cantidad a ingresar',
  'Motivo',
] as const

/** Las cuatro primeras columnas son informativas; escribirlas no cambia nada. */
const COLUMNAS_BLOQUEADAS = 4

/** 'Motivo' queda fuera: es opcional, y borrar su columna no rompe la carga. */
const COLUMNAS_REQUERIDAS = COLUMNAS_STOCK.filter((c) => c !== 'Motivo')

export interface EntradaStock {
  item_id: string
  codigo: string
  nombre: string
  /** Lo que había cuando se bajó/leyó la plantilla; sólo para previsualizar. */
  stock_actual: number
  cantidad: number
  motivo: string | null
}

export interface ResultadoCargaStock {
  validos: EntradaStock[]
  errores: ErrorImportacion[]
  /** Filas con código válido y cantidad en blanco: no son error, se omiten. */
  omitidas: number
}

/**
 * Genera y descarga la plantilla de carga de stock con un renglón por item.
 * `items` debe venir ya filtrado y ordenado como se quiere ver en el Excel.
 */
export async function descargarPlantillaStock(items: ItemInventario[], nombreArchivo: string) {
  const wb = nuevoLibro()
  const hoja = wb.addWorksheet('Stock', { views: [{ state: 'frozen', ySplit: 1 }] })
  hoja.columns = COLUMNAS_STOCK.map((titulo, i) => ({ header: titulo, width: i === 1 ? 34 : 20 }))
  estilarEncabezado(hoja, AZUL_ENCABEZADO)

  items.forEach((item, i) => {
    const fila = agregarFilaCebra(
      hoja,
      [item.codigo, item.nombre, item.unidad_medida?.simbolo ?? '', item.stock_actual, null, null],
      i,
      AZUL_CLARO
    )
    // Gris en lo que no se toca: la vista sola dice dónde hay que escribir.
    for (let col = 1; col <= COLUMNAS_BLOQUEADAS; col++) {
      const celda = fila.getCell(col)
      celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_BLOQUEADO } }
      celda.font = { color: { argb: 'FF4B5563' } }
      celda.border = bordesCelda()
    }
    fila.getCell(1).font = { name: 'Consolas', color: { argb: 'FF4B5563' } }
  })

  const hojaAyuda = wb.addWorksheet('Instrucciones')
  hojaAyuda.columns = [{ header: 'Cómo cargar stock', width: 90 }]
  estilarEncabezado(hojaAyuda, AZUL_ENCABEZADO)
  ;[
    'Llena sólo la columna "Cantidad a ingresar" del item que recibiste.',
    'La cantidad es lo que ENTRA, no el stock final: si hay 10 y llegaron 5, escribe 5.',
    'Deja en blanco los items que no recibiste; esas filas se ignoran.',
    'No cambies el código: es lo que amarra la fila con el item del inventario.',
    'El motivo es opcional (ej: factura del proveedor) y queda en el historial del item.',
    'Cada cantidad se registra como un movimiento de entrada, con su rastro de auditoría.',
  ].forEach((linea, i) => agregarFilaCebra(hojaAyuda, [linea], i, AZUL_CLARO))

  await descargarLibro(wb, `plantilla-stock-${nombreArchivo}`)
}

/** Lee el .xlsx de carga de stock y valida cada fila contra el inventario. */
export async function leerStockExcel(file: File, items: ItemInventario[]): Promise<ResultadoCargaStock> {
  const hoja = await leerHoja(file, 'Stock')
  if (!hoja) return { validos: [], errores: [{ fila: 0, motivo: 'No se encontró la hoja "Stock" en el archivo' }], omitidas: 0 }

  // Sin esta guarda, una columna renombrada haría que todas las filas se leyeran
  // sin cantidad y el resultado sería un tranquilizador "0 entradas" en vez de un error.
  const faltantes = columnasFaltantes(hoja.encabezados, COLUMNAS_REQUERIDAS)
  if (faltantes.length > 0) {
    return {
      validos: [],
      errores: [{ fila: 1, motivo: `Faltan columnas en la hoja: ${faltantes.join(', ')}. Vuelve a bajar la plantilla.` }],
      omitidas: 0,
    }
  }

  const itemsPorCodigo = new Map(items.map((i) => [normalizar(i.codigo), i]))
  const codigosVistos = new Set<string>()

  const validos: EntradaStock[] = []
  const errores: ErrorImportacion[] = []
  let omitidas = 0

  hoja.filas.forEach(({ numero: numeroFila, datos: fila }) => {
    const codigo = texto(fila, 'Código')
    const cantidadCruda = fila['Cantidad a ingresar']
    const motivo = texto(fila, 'Motivo')

    // Fila vacía del final: ni error ni omitida, simplemente no existe.
    if (!codigo && (cantidadCruda === '' || cantidadCruda === undefined)) return

    const item = itemsPorCodigo.get(normalizar(codigo))
    const cantidad = numeroValido(cantidadCruda)

    // La plantilla trae todos los items, así que lo normal es que la mayoría de
    // filas venga sin cantidad. Eso no es un error: es "no recibí este item".
    // Tampoco se valida su código: una fila que no pide nada no puede bloquear la
    // carga, aunque su item ya no exista (se dio de baja después de bajar la plantilla).
    if (cantidad === null) {
      omitidas++
      return
    }

    const motivos: string[] = []
    if (!codigo) motivos.push('Falta el código')
    else if (!item) motivos.push(`El código no existe en el inventario: ${codigo}`)
    else if (codigosVistos.has(normalizar(codigo))) motivos.push(`Código repetido en el archivo: ${codigo}`)

    if (Number.isNaN(cantidad)) motivos.push('Cantidad inválida: debe ser un número positivo')
    else if (cantidad === 0) motivos.push('La cantidad debe ser mayor a cero (deja la celda vacía para omitir la fila)')

    if (motivos.length > 0) {
      errores.push({ fila: numeroFila, motivo: motivos.join('; ') })
      return
    }

    codigosVistos.add(normalizar(codigo))
    validos.push({
      item_id: item!.id,
      codigo: item!.codigo,
      nombre: item!.nombre,
      stock_actual: item!.stock_actual,
      cantidad: cantidad!,
      motivo: motivo || null,
    })
  })

  return { validos, errores, omitidas }
}
