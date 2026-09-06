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
  'Descripción',
  'Categoría',
  'Unidad de medida',
  'Clase de inventario',
  'Precio costo',
  'Precio venta',
  'Stock mínimo',
  'Ancho lámina (cm)',
  'Alto lámina (cm)',
] as const

/**
 * Clases que la plantilla acepta. 'desperdicio' no está: un recorte solo nace de
 * "Registrar recorte" sobre una lámina existente, igual que en el formulario.
 */
const CLASES_VALIDAS: { etiqueta: string; alias: string[]; valor: ClaseImportada }[] = [
  // El alias es la etiqueta corta del badge (CLASE_INVENTARIO_LABELS), para que
  // quien copie lo que ve en el inventario también acierte.
  { etiqueta: 'Stock normal', alias: ['Stock'], valor: 'stock_normal' },
  { etiqueta: 'Sobre pedido', alias: [], valor: 'sobre_pedido' },
]

type ClaseImportada = 'stock_normal' | 'sobre_pedido'

/**
 * Columna extra de la plantilla global (la que se baja desde Inventario, sin un
 * proveedor de contexto): ahí cada fila dice de quién es el producto. Desde la
 * ficha de un proveedor la columna no existe porque el proveedor ya está fijo.
 */
export const COLUMNA_PROVEEDOR = 'Proveedor'

export interface ProductoImportado {
  codigo: string
  nombre: string
  descripcion: string | null
  categoria_id: string
  unidad_medida_id: string
  clase_inventario: ClaseImportada
  precio_costo: number
  precio_venta: number
  stock_minimo: number
  /** Medida estándar de la lámina. Las dos o ninguna: media medida no sirve. */
  ancho_cm: number | null
  alto_cm: number | null
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

  // Dos ejemplos en vez de uno: la segunda fila es la que enseña, sin instrucciones,
  // que un material por m² lleva la medida de la lámina y uno por unidad no.
  const unidadArea = unidades.find((u) => u.tipo === 'area')
  const categoriaVidrio = categorias.find((c) => normalizar(c.nombre).includes('vidrio')) ?? categorias[0]
  const categoriaOtra = categorias.find((c) => c.id !== categoriaVidrio?.id) ?? categorias[0]
  const ejemplos: (string | number)[][] = [
    [
      'ALU-001', 'Perfil de aluminio 3"', 'Perfil estructural natural',
      categoriaOtra?.nombre ?? '', unidades[0]?.nombre ?? '', 'Stock normal',
      25000, 35000, 10, '', '',
    ],
    [
      'VID-001', 'Vidrio templado 6mm claro', 'Lámina estándar',
      categoriaVidrio?.nombre ?? '', unidadArea?.nombre ?? unidades[0]?.nombre ?? '', 'Stock normal',
      90000, 130000, 5, 240, 180,
    ],
  ]
  if (proveedores) ejemplos.forEach((e) => e.push(proveedores[0]?.nombre ?? ''))

  for (const ejemplo of ejemplos) {
    const filaEjemplo = hoja.addRow(ejemplo)
    filaEjemplo.eachCell({ includeEmpty: true }, (celda) => {
      celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_EJEMPLO } }
      celda.font = { italic: true, color: { argb: 'FF6B7280' } }
      celda.border = bordesCelda()
    })
  }

  for (let i = 0; i < 30; i++) agregarFilaCebra(hoja, [], i, AZUL_CLARO)

  const catalogos = [
    { titulo: 'Categorías válidas', valores: categorias.map((c) => c.nombre) },
    { titulo: 'Unidades de medida válidas', valores: unidades.map((u) => u.nombre) },
    { titulo: 'Clases de inventario válidas', valores: CLASES_VALIDAS.map((c) => c.etiqueta) },
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
  // Se guarda la unidad completa, no sólo el id: el tipo decide si la fila debe
  // traer la medida de la lámina.
  const unidadesPorNombre = new Map(unidades.map((u) => [normalizar(u.nombre), u]))
  const clasesPorEtiqueta = new Map(
    CLASES_VALIDAS.flatMap((c) => [c.etiqueta, ...c.alias].map((t) => [normalizar(t), c.valor] as const))
  )
  const proveedoresPorNombre = new Map((proveedores ?? []).map((p) => [normalizar(p.nombre), p.id]))
  const codigosVistos = new Set<string>()

  const validos: ProductoImportado[] = []
  const errores: ErrorImportacion[] = []

  hoja.filas.forEach(({ numero: numeroFila, datos: fila }) => {
    const motivos: string[] = []

    const codigo = texto(fila, 'Código')
    const nombre = texto(fila, 'Nombre')
    const descripcion = texto(fila, 'Descripción')
    const categoriaTexto = texto(fila, 'Categoría')
    const unidadTexto = texto(fila, 'Unidad de medida')
    const claseTexto = texto(fila, 'Clase de inventario')
    const proveedorTexto = texto(fila, COLUMNA_PROVEEDOR)

    // Fila totalmente vacía (usuario dejó espacio de más al final): se ignora sin error.
    const filaVacia = !codigo && !nombre && !descripcion && !categoriaTexto && !unidadTexto
      && !claseTexto && !proveedorTexto
      && fila['Precio costo'] === '' && fila['Precio venta'] === ''
      && fila['Stock mínimo'] === '' && fila['Ancho lámina (cm)'] === '' && fila['Alto lámina (cm)'] === ''
    if (filaVacia) return

    if (!codigo) motivos.push('Falta el código')
    else if (codigosVistos.has(normalizar(codigo))) motivos.push(`Código duplicado en el archivo: ${codigo}`)
    else if (codigosExistentes.has(normalizar(codigo))) motivos.push(`El código ya existe en el sistema: ${codigo}`)

    if (!nombre) motivos.push('Falta el nombre')

    const categoriaId = categoriasPorNombre.get(normalizar(categoriaTexto))
    if (!categoriaTexto) motivos.push('Falta la categoría')
    else if (!categoriaId) motivos.push(`Categoría no reconocida: "${categoriaTexto}" (ver hoja Catálogos)`)

    const unidad = unidadesPorNombre.get(normalizar(unidadTexto))
    if (!unidadTexto) motivos.push('Falta la unidad de medida')
    else if (!unidad) motivos.push(`Unidad de medida no reconocida: "${unidadTexto}" (ver hoja Catálogos)`)

    // Vacío = stock normal: es lo que era antes de que la columna existiera.
    const clase = claseTexto ? clasesPorEtiqueta.get(normalizar(claseTexto)) : 'stock_normal'
    if (claseTexto && !clase) {
      motivos.push(
        `Clase de inventario no reconocida: "${claseTexto}". Valores válidos: ${CLASES_VALIDAS.map((c) => c.etiqueta).join(' o ')}`
      )
    }

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

    // Vacío = 0, que es como nacían los items antes de existir la columna.
    const stockMinimo = numeroValido(fila['Stock mínimo'])
    if (stockMinimo !== null && Number.isNaN(stockMinimo)) motivos.push('Stock mínimo inválido')

    const ancho = numeroValido(fila['Ancho lámina (cm)'])
    const alto = numeroValido(fila['Alto lámina (cm)'])
    if (ancho !== null && (Number.isNaN(ancho) || ancho <= 0)) motivos.push('Ancho de lámina inválido: debe ser un número mayor a cero')
    if (alto !== null && (Number.isNaN(alto) || alto <= 0)) motivos.push('Alto de lámina inválido: debe ser un número mayor a cero')

    // Media medida no sirve para nada: ni se muestra ni valida que un recorte
    // quepa, porque las dos comprobaciones exigen los dos lados.
    if ((ancho === null) !== (alto === null)) {
      motivos.push('La medida de la lámina va completa: ancho y alto, o ninguno de los dos')
    }

    // Un material que se almacena por m² y vive en bodega sin su medida deja
    // apagada, en silencio, la validación de que un recorte quepa en su lámina.
    if (unidad?.tipo === 'area' && clase === 'stock_normal' && ancho === null && alto === null) {
      motivos.push('Falta la medida de la lámina (ancho y alto): es obligatoria en un material por área que se guarda en bodega')
    }

    if (motivos.length > 0) {
      errores.push({ fila: numeroFila, motivo: motivos.join('; ') })
      return
    }

    codigosVistos.add(normalizar(codigo))
    validos.push({
      codigo,
      nombre,
      descripcion: descripcion || null,
      categoria_id: categoriaId!,
      unidad_medida_id: unidad!.id,
      clase_inventario: clase!,
      precio_costo: precioCosto!,
      precio_venta: precioVenta!,
      stock_minimo: stockMinimo ?? 0,
      ancho_cm: ancho,
      alto_cm: alto,
      proveedor_id: proveedorId,
    })
  })

  return { validos, errores }
}
