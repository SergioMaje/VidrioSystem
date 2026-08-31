import type {
  ItemInventario,
  OpcionCotizacion,
  PlantillaComponente,
  RolConfigurador,
  VidrioTipo,
} from '@/types/database'
import { cantidadPorFormula, type Medidas } from './produccion'

export const ROL_LABELS: Record<RolConfigurador, string> = {
  vidrio: 'Vidrio',
  chapa: 'Chapa / cerradura',
  pelicula: 'Película de seguridad',
}

export const VIDRIO_TIPOS: VidrioTipo[] = ['crudo', 'templado', 'laminado']

/** Acabados que se reconocen en el nombre del item cuando no hay dato explícito. */
const ACABADOS_CONOCIDOS = [
  'claro', 'esmerilado', 'polarizado', 'bronce', 'reflectivo', 'satinado', 'ahumado', 'opaco',
]

function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

/**
 * Rol del item en el configurador. Usa la columna explícita si el administrador la
 * llenó; si no, la infiere de la categoría y del nombre para que el inventario que ya
 * existe funcione sin recapturarlo.
 */
export function rolDeItem(item: ItemInventario): RolConfigurador | null {
  if (item.rol_configurador) return item.rol_configurador

  const categoria = normalizar(item.categoria?.nombre ?? '')
  const texto = normalizar(`${categoria} ${item.nombre} ${item.descripcion ?? ''}`)

  if (texto.includes('pelicula')) return 'pelicula'
  if (texto.includes('chapa') || texto.includes('cerradura')) return 'chapa'
  if (categoria.includes('vidrio')) return 'vidrio'
  return null
}

export function esComponenteDeVidrio(componente: PlantillaComponente): boolean {
  return !!componente.item && rolDeItem(componente.item) === 'vidrio'
}

export interface AtributosVidrio {
  tipo: VidrioTipo | null
  calibre_mm: number | null
  acabado: string | null
}

/** Atributos del vidrio: columna explícita, o lo que se pueda leer del nombre. */
export function atributosVidrio(item: ItemInventario): AtributosVidrio {
  const texto = normalizar(`${item.nombre} ${item.descripcion ?? ''}`)
  const calibreTexto = texto.match(/(\d+(?:[.,]\d+)?)\s*mm/)?.[1]

  return {
    tipo: item.vidrio_tipo ?? VIDRIO_TIPOS.find((t) => texto.includes(t)) ?? null,
    calibre_mm: item.vidrio_calibre_mm ?? (calibreTexto ? parseFloat(calibreTexto.replace(',', '.')) : null),
    acabado: item.vidrio_acabado ?? ACABADOS_CONOCIDOS.find((a) => texto.includes(a)) ?? null,
  }
}

export interface OpcionDisponible {
  item: ItemInventario
  rol: RolConfigurador
  vidrio: AtributosVidrio
}

export interface CatalogoOpciones {
  vidrios: OpcionDisponible[]
  chapas: OpcionDisponible[]
  peliculas: OpcionDisponible[]
}

/** Agrupa el inventario en las listas que alimentan los selects del configurador. */
export function catalogoOpciones(items: ItemInventario[] | undefined): CatalogoOpciones {
  const catalogo: CatalogoOpciones = { vidrios: [], chapas: [], peliculas: [] }

  for (const item of items ?? []) {
    const rol = rolDeItem(item)
    if (!rol) continue
    const disponible: OpcionDisponible = { item, rol, vidrio: atributosVidrio(item) }
    if (rol === 'vidrio') catalogo.vidrios.push(disponible)
    else if (rol === 'chapa') catalogo.chapas.push(disponible)
    else catalogo.peliculas.push(disponible)
  }
  return catalogo
}

/**
 * Fórmula de cálculo para una opción que no viene de la plantilla BOM: se deriva del
 * tipo de unidad de medida del item (m² → área, ml → perímetro, unidad → cantidad fija).
 */
export function formulaPorUnidad(
  item: ItemInventario
): { formula: PlantillaComponente['formula']; cantidad_fija: number | null } {
  switch (item.unidad_medida?.tipo) {
    case 'area':     return { formula: 'area', cantidad_fija: null }
    case 'longitud': return { formula: 'perimetro', cantidad_fija: null }
    default:         return { formula: 'fijo', cantidad_fija: 1 }
  }
}

type BaseCalculo = Pick<PlantillaComponente, 'formula' | 'cantidad_fija' | 'desperdicio_pct'>

/**
 * Arma la opción a guardar en el ítem de cotización. Si viene de un componente de la
 * plantilla (el vidrio fijo del BOM) hereda su fórmula y su % de desperdicio.
 */
export function crearOpcion(
  rol: RolConfigurador,
  item: ItemInventario,
  base?: BaseCalculo | null
): OpcionCotizacion {
  const calculo: BaseCalculo = base ?? { ...formulaPorUnidad(item), desperdicio_pct: 0 }
  const vidrio = rol === 'vidrio' ? atributosVidrio(item) : null

  return {
    rol,
    item_id: item.id,
    nombre: item.nombre,
    unidad_simbolo: item.unidad_medida?.simbolo ?? null,
    formula: calculo.formula,
    cantidad_fija: calculo.cantidad_fija,
    desperdicio_pct: calculo.desperdicio_pct,
    precio_costo: item.precio_costo,
    vidrio_tipo: vidrio?.tipo ?? null,
    vidrio_calibre_mm: vidrio?.calibre_mm ?? null,
    vidrio_acabado: vidrio?.acabado ?? null,
  }
}

export interface OpcionCalculada {
  opcion: OpcionCotizacion
  cantidad_calculada: number
  costo_total: number
}

export function calcularOpciones(
  opciones: OpcionCotizacion[] | undefined,
  medidas: Medidas,
  unidades = 1
): OpcionCalculada[] {
  return (opciones ?? []).map((opcion) => {
    const cantidad = cantidadPorFormula(
      opcion.formula,
      opcion.cantidad_fija,
      opcion.desperdicio_pct,
      medidas,
      unidades
    )
    return { opcion, cantidad_calculada: cantidad, costo_total: cantidad * opcion.precio_costo }
  })
}

/** Texto de la opción para el resumen del ítem y para la ficha impresa. */
export function etiquetaOpcion(opcion: OpcionCotizacion): string {
  if (opcion.rol === 'vidrio') {
    const partes = [
      'Vidrio',
      opcion.vidrio_tipo,
      opcion.vidrio_calibre_mm != null ? `${opcion.vidrio_calibre_mm}mm` : null,
      opcion.vidrio_acabado,
    ].filter(Boolean)
    return partes.length > 1 ? partes.join(' ') : opcion.nombre
  }

  const nombre = normalizar(opcion.nombre)
  if (opcion.rol === 'chapa') {
    return nombre.includes('chapa') || nombre.includes('cerradura') ? opcion.nombre : `Chapa ${opcion.nombre}`
  }
  return nombre.includes('pelicula') ? opcion.nombre : `Película ${opcion.nombre}`
}

export function resumenOpciones(opciones: OpcionCotizacion[] | undefined): string[] {
  return (opciones ?? []).map(etiquetaOpcion)
}

export interface LineaMaterial {
  key: string
  nombre: string
  simbolo: string
  cantidad: number
}

/** Las opciones expresadas como líneas de material, para las fichas de producción. */
export function lineasDeOpciones(
  opciones: OpcionCotizacion[] | undefined,
  medidas: Medidas,
  unidades = 1
): LineaMaterial[] {
  return calcularOpciones(opciones, medidas, unidades).map(({ opcion, cantidad_calculada }) => ({
    key: `opcion-${opcion.rol}-${opcion.item_id}`,
    nombre: etiquetaOpcion(opcion),
    simbolo: opcion.unidad_simbolo ?? '',
    cantidad: cantidad_calculada,
  }))
}
