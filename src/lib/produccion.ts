import type {
  CotizacionItem,
  FormulaCorte,
  PlantillaComponente,
  ReferenciaCorte,
} from '@/types/database'

export const COLORES_PERFIL = [
  { value: '#9CA3AF', label: 'Natural' },
  { value: '#111827', label: 'Negro' },
  { value: '#B45309', label: 'Bronce' },
  { value: '#FFFFFF', label: 'Blanco' },
]

export function nombreColorPerfil(hex: string | null): string | null {
  if (!hex) return null
  return COLORES_PERFIL.find((c) => c.value === hex)?.label ?? hex
}

export const TIPO_LABELS: Record<string, string> = {
  ventana: 'Ventana',
  puerta: 'Puerta',
  division: 'División',
  espejo: 'Espejo',
  otro: 'Otro',
}

/**
 * Las cuatro medidas de un vano. En un vano a escuadra los dos anchos son iguales
 * entre si y los dos altos tambien, y todo el sistema se comporta como cuando solo
 * existian `anchoCm` y `altoCm`.
 */
export interface Medidas {
  anchoSuperiorCm: number
  anchoInferiorCm: number
  altoIzquierdoCm: number
  altoDerechoCm: number
}

/** Vano rectangular: los cuatro lados colapsan al par nominal. */
export function medidasRegulares(anchoCm: number, altoCm: number): Medidas {
  return {
    anchoSuperiorCm: anchoCm,
    anchoInferiorCm: anchoCm,
    altoIzquierdoCm: altoCm,
    altoDerechoCm: altoCm,
  }
}

/**
 * Medida nominal: el lado mayor de cada par, o sea el rectangulo que contiene al
 * vano. Es lo que se compra, lo que se dibuja y lo que se escribe en la descripcion.
 */
export function anchoNominal(m: Medidas): number {
  return Math.max(m.anchoSuperiorCm, m.anchoInferiorCm)
}

export function altoNominal(m: Medidas): number {
  return Math.max(m.altoIzquierdoCm, m.altoDerechoCm)
}

/** Si el vano esta a escuadra. Un vano regular no necesita mostrar cuatro medidas. */
export function esRegular(m: Medidas): boolean {
  return m.anchoSuperiorCm === m.anchoInferiorCm && m.altoIzquierdoCm === m.altoDerechoCm
}

/**
 * Medidas de un item ya cotizado.
 *
 * El criterio es si el item trae las cuatro columnas, no la bandera
 * `medidas_irregulares`: esa dejo de ser un modo que se elige al cotizar y hoy solo
 * dice si el vano quedo fuera de escuadra. Los items guardados antes de las medidas
 * por lado traen las cuatro en NULL y caen al par nominal: eran vanos rectangulares
 * y se siguen calculando igual.
 */
export function medidasDeItem(
  item: Pick<
    CotizacionItem,
    'ancho_cm' | 'alto_cm' | 'ancho_sup_cm' | 'ancho_inf_cm' | 'alto_izq_cm' | 'alto_der_cm'
  >
): Medidas {
  const anchoCm = item.ancho_cm ?? 0
  const altoCm = item.alto_cm ?? 0

  const sinLados =
    item.ancho_sup_cm == null &&
    item.ancho_inf_cm == null &&
    item.alto_izq_cm == null &&
    item.alto_der_cm == null
  if (sinLados) return medidasRegulares(anchoCm, altoCm)

  return {
    anchoSuperiorCm: item.ancho_sup_cm ?? anchoCm,
    anchoInferiorCm: item.ancho_inf_cm ?? anchoCm,
    altoIzquierdoCm: item.alto_izq_cm ?? altoCm,
    altoDerechoCm: item.alto_der_cm ?? altoCm,
  }
}

export type LadoMedida = 'izquierda' | 'derecha' | 'superior' | 'inferior'

export const LADO_MEDIDA_ABREV: Record<LadoMedida, string> = {
  izquierda: 'izq',
  derecha: 'der',
  superior: 'sup',
  inferior: 'inf',
}

/**
 * Las formulas regulares se desdoblan: una fila "Jamba, alto, x2" en un vano fuera de
 * escuadra produce una jamba izquierda y una derecha, cada una con su medida y su
 * descuento. Las formulas por lado nombran su lado explicitamente y nunca se desdoblan.
 */
const EJE_DESDOBLABLE: Partial<Record<FormulaCorte, [LadoMedida, LadoMedida]>> = {
  alto:               ['izquierda', 'derecha'],
  alto_menos_margen:  ['izquierda', 'derecha'],
  mitad_alto:         ['izquierda', 'derecha'],
  ancho:              ['superior', 'inferior'],
  ancho_menos_margen: ['superior', 'inferior'],
  mitad_ancho:        ['superior', 'inferior'],
}

const LADO_EXPLICITO: Partial<Record<FormulaCorte, LadoMedida>> = {
  alto_izquierdo: 'izquierda',
  alto_derecho:   'derecha',
  ancho_superior: 'superior',
  ancho_inferior: 'inferior',
}

export type CorteCalculado = ReferenciaCorte & {
  valor_cm: number
  /** Lado del vano del que salio la medida. null cuando la formula no depende de un lado. */
  lado: LadoMedida | null
  /**
   * Clave estable y unica en la lista: una fila desdoblada produce dos entradas que
   * comparten `id`, asi que `id` no sirve como key de React.
   */
  key: string
}

function medidaDeLado(m: Medidas, lado: LadoMedida): number {
  switch (lado) {
    case 'izquierda': return m.altoIzquierdoCm
    case 'derecha':   return m.altoDerechoCm
    case 'superior':  return m.anchoSuperiorCm
    case 'inferior':  return m.anchoInferiorCm
  }
}

/** El descuento del lado si lo tiene; si no, el base. Un valor negativo suma. */
function margenDeLado(c: ReferenciaCorte, lado: LadoMedida | null): number {
  if (!lado) return c.margen_cm
  const porLado: Record<LadoMedida, number | null> = {
    izquierda: c.margen_izq_cm,
    derecha:   c.margen_der_cm,
    superior:  c.margen_sup_cm,
    inferior:  c.margen_inf_cm,
  }
  return porLado[lado] ?? c.margen_cm
}

function valorCorte(c: ReferenciaCorte, base: number, margen: number): number {
  switch (c.formula) {
    case 'fijo':
      return c.cantidad_fija_cm ?? 0
    case 'mitad_ancho':
    case 'mitad_alto':
      return base / 2
    case 'ancho':
    case 'alto':
      return base
    case 'ancho_menos_margen':
    case 'alto_menos_margen':
    case 'alto_izquierdo':
    case 'alto_derecho':
    case 'ancho_superior':
    case 'ancho_inferior':
      return base - margen
  }
}

function pieza(
  c: ReferenciaCorte,
  m: Medidas,
  lado: LadoMedida | null,
  piezas: number,
  key: string
): CorteCalculado {
  const esDeAncho = c.formula.startsWith('ancho') || c.formula === 'mitad_ancho'
  const base = lado ? medidaDeLado(m, lado) : esDeAncho ? anchoNominal(m) : altoNominal(m)
  return {
    ...c,
    cantidad_piezas: piezas,
    lado,
    key,
    valor_cm: Math.max(0, valorCorte(c, base, margenDeLado(c, lado))),
  }
}

export function calcularCortes(cortes: ReferenciaCorte[], m: Medidas): CorteCalculado[] {
  return cortes.flatMap((c) => {
    const explicito = LADO_EXPLICITO[c.formula]
    if (explicito) return [pieza(c, m, explicito, c.cantidad_piezas, `${c.id}-${explicito}`)]

    const eje = EJE_DESDOBLABLE[c.formula]
    if (eje) {
      const [a, b] = eje
      // Solo tiene sentido desdoblar si los dos lados difieren. Y una cantidad impar
      // no se puede repartir entre dos lados: en ese caso se corta a la medida mayor,
      // que es el error recuperable (sobra material, no falta).
      if (medidaDeLado(m, a) !== medidaDeLado(m, b) && c.cantidad_piezas % 2 === 0) {
        const mitad = c.cantidad_piezas / 2
        return [
          pieza(c, m, a, mitad, `${c.id}-${a}`),
          pieza(c, m, b, mitad, `${c.id}-${b}`),
        ]
      }
    }
    return [pieza(c, m, null, c.cantidad_piezas, c.id)]
  })
}

/** Nombre de la pieza con su lado, para las etiquetas del despiece. */
export function nombrePiezaConLado(c: CorteCalculado): string {
  return c.lado ? `${c.nombre_pieza} (${LADO_MEDIDA_ABREV[c.lado]})` : c.nombre_pieza
}

export type MaterialCalculado<T extends PlantillaComponente = PlantillaComponente> = T & {
  cantidad_calculada: number
}

/**
 * Cantidad de material que consume una medida segun su formula, incluyendo el
 * desperdicio. Lo usan tanto los componentes de la plantilla BOM como las opciones
 * adicionales elegidas al cotizar.
 *
 * Con un vano irregular el material se compra por el rectangulo que lo contiene: el
 * vidrio se corta de una lamina rectangular y se recorta, y un perfil se compra a la
 * medida mayor. El perimetro es la excepcion, porque ahi si se recorre el contorno
 * real. En un vano a escuadra las cuatro formulas dan el mismo numero de siempre.
 */
export function cantidadPorFormula(
  formula: PlantillaComponente['formula'],
  cantidadFija: number | null,
  desperdicioPct: number,
  m: Medidas,
  unidades = 1
): number {
  const anchoM = anchoNominal(m) / 100
  const altoM = altoNominal(m) / 100

  let cantidad = 0
  switch (formula) {
    case 'area':      cantidad = anchoM * altoM; break
    case 'perimetro':
      cantidad =
        (m.anchoSuperiorCm + m.anchoInferiorCm + m.altoIzquierdoCm + m.altoDerechoCm) / 100
      break
    case 'ancho':     cantidad = anchoM; break
    case 'alto':      cantidad = altoM; break
    case 'fijo':      cantidad = cantidadFija ?? 1; break
  }
  return cantidad * (1 + desperdicioPct / 100) * unidades
}

export function calcularMateriales<T extends PlantillaComponente>(
  componentes: T[],
  m: Medidas,
  unidades = 1
): MaterialCalculado<T>[] {
  return componentes.map((comp) => ({
    ...comp,
    cantidad_calculada: cantidadPorFormula(
      comp.formula,
      comp.cantidad_fija,
      comp.desperdicio_pct,
      m,
      unidades
    ),
  }))
}

/** Area del vano en m2, con el mismo criterio de bounding box que la formula `area`. */
export function areaM2(m: Medidas): number {
  return (anchoNominal(m) / 100) * (altoNominal(m) / 100)
}

/**
 * Las cuatro medidas en una linea, para el panel de items, el PDF y la ficha de
 * produccion. Devuelve null cuando el vano esta a escuadra y basta con el nominal.
 */
export function detalleMedidasPorLado(m: Medidas): string | null {
  if (esRegular(m)) return null
  return (
    `Ancho sup ${m.anchoSuperiorCm} / inf ${m.anchoInferiorCm} · ` +
    `Alto izq ${m.altoIzquierdoCm} / der ${m.altoDerechoCm} cm`
  )
}
