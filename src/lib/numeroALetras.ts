/**
 * Monto en letras para el recibo de pago: 833000 → "ochocientos treinta y
 * tres mil pesos". Solo pesos enteros (los cobros no llevan centavos); cubre
 * hasta los miles de millones.
 */

const UNIDADES = [
  '', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
  'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete',
  'veintiocho', 'veintinueve',
]
const DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
const CENTENAS = [
  '', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos',
  'seiscientos', 'setecientos', 'ochocientos', 'novecientos',
]

/** 0–99, con "uno" al final (se apocopa después según lo que siga). */
function decenas(n: number): string {
  if (n < 30) return UNIDADES[n]
  const d = Math.floor(n / 10)
  const u = n % 10
  return u === 0 ? DECENAS[d] : `${DECENAS[d]} y ${UNIDADES[u]}`
}

/** 0–999. */
function centenas(n: number): string {
  if (n === 100) return 'cien'
  const c = Math.floor(n / 100)
  const resto = n % 100
  return [CENTENAS[c], decenas(resto)].filter(Boolean).join(' ')
}

/**
 * Antes de "mil", "millones" o "pesos", "uno" pierde la o: "un peso",
 * "veintiún mil", "treinta y un millones".
 */
const apocopar = (texto: string) => texto.replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un')

/** 0–999.999 */
function miles(n: number): string {
  const m = Math.floor(n / 1000)
  const resto = n % 1000
  const parteMiles = m === 0 ? '' : m === 1 ? 'mil' : `${apocopar(centenas(m))} mil`
  return [parteMiles, centenas(resto)].filter(Boolean).join(' ')
}

export function numeroALetras(valor: number): string {
  const n = Math.round(Math.abs(valor))
  if (n === 0) return 'cero pesos'
  if (n >= 1_000_000_000_000) return `${n} pesos`

  const millones = Math.floor(n / 1_000_000)
  const resto = n % 1_000_000

  const parteMillones =
    millones === 0 ? '' : millones === 1 ? 'un millón' : `${apocopar(miles(millones))} millones`
  const parteResto = apocopar(miles(resto))

  // "un millón de pesos", pero "un millón doscientos mil pesos".
  const texto = [parteMillones, parteResto].filter(Boolean).join(' ')
  const conDe = resto === 0 && millones > 0 ? ' de' : ''
  return `${texto}${conDe} ${n === 1 ? 'peso' : 'pesos'}`
}
