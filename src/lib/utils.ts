import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCOP(amount: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

/** Agrupa en miles sin símbolo de moneda, para inputs: 1500000 → "1.500.000". */
export function formatMiles(valor: number): string {
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(valor)
}

/** Deja solo los dígitos de lo que el usuario escribió en un input de dinero. */
export function soloDigitos(texto: string): string {
  return texto.replace(/\D/g, '')
}

export function formatFecha(dateStr: string): string {
  const date = new Date(dateStr)
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

export function formatFechaHora(dateStr: string): string {
  const date = new Date(dateStr)
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function getSaludo(nombre: string): string {
  const hora = new Date().getHours()
  let saludo = 'Buenos días'
  if (hora >= 12 && hora < 18) saludo = 'Buenas tardes'
  else if (hora >= 18) saludo = 'Buenas noches'
  return `${saludo}, ${nombre}`
}

/** Días de diferencia entre hoy y una fecha (YYYY-MM-DD). Negativo si ya pasó. */
export function diasHasta(fecha: string): number {
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const objetivo = new Date(fecha + 'T00:00:00')
  const msPorDia = 1000 * 60 * 60 * 24
  return Math.round((objetivo.getTime() - hoy.getTime()) / msPorDia)
}
