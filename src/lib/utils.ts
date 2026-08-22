import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Texto legible de un error. Los errores de supabase-js son objetos planos
 * (`PostgrestError`), no instancias de `Error`, así que un `instanceof Error`
 * solo se queda con el mensaje genérico y esconde lo que dijo la base.
 */
export function mensajeError(err: unknown, porDefecto: string): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const mensaje = (err as { message: unknown }).message
    if (typeof mensaje === 'string' && mensaje.trim()) return mensaje
  }
  return porDefecto
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

/** Solo la hora: "08:14". Para cuando la fecha ya está en el contexto. */
export function formatHora(dateStr: string): string {
  return new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit' }).format(new Date(dateStr))
}

export function getSaludo(nombre: string): string {
  const hora = new Date().getHours()
  let saludo = 'Buenos días'
  if (hora >= 12 && hora < 18) saludo = 'Buenas tardes'
  else if (hora >= 18) saludo = 'Buenas noches'
  return `${saludo}, ${nombre}`
}

/** Clave YYYY-MM-DD en zona horaria local (no UTC): `toISOString()` adelanta el día. */
export function fechaISOLocal(fecha: Date | string): string {
  const d = typeof fecha === 'string' ? new Date(fecha) : fecha
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

/**
 * Instante absoluto del inicio del día siguiente, para usarlo como límite
 * superior exclusivo (`.lt`) de un rango. Mandar `fecha + 'T23:59:59'` sin
 * offset hace que Postgres lo lea como UTC y recorte la tarde en zonas
 * negativas: en Colombia (UTC-5) el corte real caía a las 18:59:59.
 */
export function finDeDia(fecha: string): string {
  const d = new Date(fecha + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  return d.toISOString()
}

/** Duración entre dos instantes, legible: "3h 25m". */
export function formatDuracion(desde: string, hasta: string): string {
  const minutos = Math.max(0, Math.round((new Date(hasta).getTime() - new Date(desde).getTime()) / 60000))
  const horas = Math.floor(minutos / 60)
  return horas > 0 ? `${horas}h ${minutos % 60}m` : `${minutos}m`
}

/** Días de diferencia entre hoy y una fecha (YYYY-MM-DD). Negativo si ya pasó. */
export function diasHasta(fecha: string): number {
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const objetivo = new Date(fecha + 'T00:00:00')
  const msPorDia = 1000 * 60 * 60 * 24
  return Math.round((objetivo.getTime() - hoy.getTime()) / msPorDia)
}
