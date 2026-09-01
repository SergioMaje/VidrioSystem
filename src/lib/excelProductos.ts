import type { Categoria, Proveedor, UnidadMedida } from '@/types/database'
import {
  AZUL_CLARO, AZUL_ENCABEZADO, GRIS_EJEMPLO,
  agregarFilaCebra, agregarHojaCatalogos, bordesCelda, descargarLibro, estilarEncabezado,
  columnasFaltantes, leerHoja, normalizar, nuevoLibro, numeroValido, texto,
  type ErrorImportacion,
} from './excel'

export type { ErrorImportacion }

/** Encabezados exactos que debe tener la hoja "Productos" del Excel. */
export const COLUMNAS_PLANTILLA = [
  'Código',
  'Nombre',
  'Categoría',
  'Unidad de medida',
  'Precio costo',
  'Precio venta',
] as const

/**
 * Columna extra de la plantilla global (la que se baja desde Inventario, sin un
 * proveedor de contexto): ahí cada fila dice de quién es el producto. Desde la
 * ficha de un proveedor la columna no existe porque el proveedor ya está fijo.
 */
export const COLUMNA_PROVEEDOR = 'Proveedor'

export interface ProductoImportado {
  codigo: string
  nombre: string
  categoria_id: string
  unidad_medida_id: string
  precio_costo: number
  precio_venta: number
  /** Sólo lo llena la plantilla global; con proveedor fijo queda en null. */
  proveedor_id: string | null
}

export interface ResultadoImportacion {
  validos: ProductoImportado[]
  errores: ErrorImportacion[]
}

/**
 * Genera y descarga la plantilla .xlsx con las columnas exigidas, estilo visual
 * y los catálogos válidos de referencia.
 *
 * `proveedores` presente = plantilla global: se agrega la columna Proveedor y su
 * catálogo. Ausente = plantilla de un proveedor concreto.
 */
export async function descargarPlantillaProductos(
  categorias: Categoria[],
  unidades: UnidadMedida[],
  nombreArchivo: string,
  proveedores?: Proveedor[]
) {
  const wb = nuevoLibro()
  const columnas = proveedores ? [...COLUMNAS_PLANTILLA, COLUMNA_PROVEEDOR] : [...COLUMNAS_PLANTILLA]

  const hoja = wb.addWorksheet('Productos', { views: [{ state: 'frozen', ySplit: 1 }] })
  hoja.columns = columnas.map((titulo) => ({ header: titulo, width: 22 }))
  estilarEncabezado(hoja, AZUL_ENCABEZADO)

  const ejemplo: (string | number)[] = [
    'ALU-001', 'Perfil de aluminio 3"', categorias[0]?.nombre ?? '', unidades[0]?.nombre ?? '', 25000, 35000,
  ]
  if (proveedores) ejemplo.push(proveedores[0]?.nombre ?? '')

  const filaEjemplo = hoja.addRow(ejemplo)
  filaEjemplo.eachCell((celda) => {
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_EJEMPLO } }
    celda.font = { italic: true, color: { argb: 'FF6B7280' } }
    celda.border = bordesCelda()
  })

  for (let i = 0; i < 30; i++) agregarFilaCebra(hoja, [], i, AZUL_CLARO)

  const catalogos = [
    { titulo: 'Categorías válidas', valores: categorias.map((c) => c.nombre) },
    { titulo: 'Unidades de medida válidas', valores: unidades.map((u) => u.nombre) },
  ]
  if (proveedores) catalogos.push({ titulo: 'Proveedores válidos', valores: proveedores.map((p) => p.nombre) })
  agregarHojaCatalogos(wb, catalogos)

  await descargarLibro(wb, `plantilla-productos-${nombreArchivo}`)
}

/**
 * Lee el archivo .xlsx y valida estrictamente cada fila contra los catálogos
 * existentes. `proveedores` sólo se pasa para la plantilla global: con él la
 * columna Proveedor pasa a ser obligatoria en cada fila.
 */
export async function leerProductosExcel(
  file: File,
  categorias: Categoria[],
  unidades: UnidadMedida[],
  codigosExistentes: Set<string>,
  proveedores?: Proveedor[]
): Promise<ResultadoImportacion> {
  const hoja = await leerHoja(file, 'Productos')
  if (!hoja) return { validos: [], errores: [{ fila: 0, motivo: 'No se encontró la hoja "Productos" en el archivo' }] }

  const requeridas = proveedores ? [...COLUMNAS_PLANTILLA, COLUMNA_PROVEEDOR] : COLUMNAS_PLANTILLA
  const faltantes = columnasFaltantes(hoja.encabezados, requeridas)
  if (faltantes.length > 0) {
    return { validos: [], errores: [{ fila: 1, motivo: `Faltan columnas en la hoja: ${faltantes.join(', ')}. Vuelve a bajar la plantilla.` }] }
  }

  const categoriasPorNombre = new Map(categorias.map((c) => [normalizar(c.nombre), c.id]))
  const unidadesPorNombre = new Map(unidades.map((u) => [normalizar(u.nombre), u.id]))
  const proveedoresPorNombre = new Map((proveedores ?? []).map((p) => [normalizar(p.nombre), p.id]))
  const codigosVistos = new Set<string>()

  const validos: ProductoImportado[] = []
  const errores: ErrorImportacion[] = []

  hoja.filas.forEach(({ numero: numeroFila, datos: fila }) => {
    const motivos: string[] = []

    const codigo = texto(fila, 'Código')
    const nombre = texto(fila, 'Nombre')
    const categoriaTexto = texto(fila, 'Categoría')
    const unidadTexto = texto(fila, 'Unidad de medida')
    const proveedorTexto = texto(fila, COLUMNA_PROVEEDOR)

    // Fila totalmente vacía (usuario dejó espacio de más al final): se ignora sin error.
    const filaVacia = !codigo && !nombre && !categoriaTexto && !unidadTexto && !proveedorTexto
      && fila['Precio costo'] === '' && fila['Precio venta'] === ''
    if (filaVacia) return

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

    let proveedorId: string | null = null
    if (proveedores) {
      proveedorId = proveedoresPorNombre.get(normalizar(proveedorTexto)) ?? null
      if (!proveedorTexto) motivos.push('Falta el proveedor')
      else if (!proveedorId) motivos.push(`Proveedor no reconocido: "${proveedorTexto}" (ver hoja Catálogos)`)
    }

    const precioCosto = numeroValido(fila['Precio costo'])
    if (precioCosto === null) motivos.push('Falta el precio de costo')
    else if (Number.isNaN(precioCosto)) motivos.push('Precio de costo inválido')

    const precioVenta = numeroValido(fila['Precio venta'])
    if (precioVenta === null) motivos.push('Falta el precio de venta')
    else if (Number.isNaN(precioVenta)) motivos.push('Precio de venta inválido')

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
      proveedor_id: proveedorId,
    })
  })

  return { validos, errores }
}
