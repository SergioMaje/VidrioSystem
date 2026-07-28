import type { LadoCorredizo, LadoMedicion } from '@/types/database'

export const LADO_MEDICION_LABELS: Record<LadoMedicion, string> = {
  exterior: 'Exterior (fachada / calle)',
  interior: 'Interior (dentro de la casa)',
}

export const LADO_CORREDIZO_LABELS: Record<LadoCorredizo, string> = {
  izquierda: 'Izquierda',
  derecha: 'Derecha',
}

function ladoOpuesto(lado: LadoCorredizo): LadoCorredizo {
  return lado === 'izquierda' ? 'derecha' : 'izquierda'
}

/**
 * ÚNICO lugar del sistema donde se invierte la mano de un lado.
 *
 * El ítem guarda el lado tal como lo dictó quien midió, junto con el lado desde el
 * que midió. El marco canónico de dibujo y de fichas es SIEMPRE el exterior: si la
 * medida se tomó desde el interior, izquierda y derecha se intercambian.
 *
 * Devuelve null cuando el ítem no tiene lado registrado (ítems anteriores a esta
 * función, o productos fijos). Si falta `ladoMedicion` se asume exterior, que es
 * el marco canónico y por tanto la opción que no altera el dato.
 */
export function ladoCorredizoExterior(
  ladoCorredizo: LadoCorredizo | null | undefined,
  ladoMedicion: LadoMedicion | null | undefined
): LadoCorredizo | null {
  if (!ladoCorredizo) return null
  return ladoMedicion === 'interior' ? ladoOpuesto(ladoCorredizo) : ladoCorredizo
}

/** Texto largo y autoexplicativo, para taller y fichas impresas. */
export function textoLadoCorredizo(
  ladoCorredizo: LadoCorredizo | null | undefined,
  ladoMedicion: LadoMedicion | null | undefined
): string | null {
  const lado = ladoCorredizoExterior(ladoCorredizo, ladoMedicion)
  if (!lado) return null
  return `Hoja corrediza a la ${LADO_CORREDIZO_LABELS[lado].toLowerCase()} mirando desde el exterior`
}

/** Texto corto, para la descripción del ítem de cotización. */
export function etiquetaLadoCorredizo(
  ladoCorredizo: LadoCorredizo | null | undefined,
  ladoMedicion: LadoMedicion | null | undefined
): string | null {
  const lado = ladoCorredizoExterior(ladoCorredizo, ladoMedicion)
  if (!lado) return null
  return `Corrediza ${LADO_CORREDIZO_LABELS[lado].toLowerCase()} (vista ext.)`
}
