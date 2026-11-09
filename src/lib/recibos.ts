import type { ConfiguracionEmpresa } from '@/types/database'

/** Texto que lleva el recibo si la vidriería no configuró el suyo. */
export const MENSAJE_RECIBO_DEFECTO = '¡Gracias por confiar en {empresa}!'

/** Largo máximo del mensaje (check de configuracion_empresa.mensaje_recibo). */
export const MENSAJE_RECIBO_MAX = 200

/**
 * El agradecimiento que cierra el recibo. `{empresa}` se reemplaza por el
 * nombre de la vidriería; si el mensaje no lo usa, se imprime tal cual.
 */
export function textoAgradecimiento(
  empresa: Pick<ConfiguracionEmpresa, 'nombre' | 'mensaje_recibo'> | null | undefined,
  mensaje?: string | null,
): string {
  const plantilla = (mensaje ?? empresa?.mensaje_recibo)?.trim() || MENSAJE_RECIBO_DEFECTO
  const nombre = empresa?.nombre?.trim() || 'nosotros'
  return plantilla.replace(/\{empresa\}/gi, nombre)
}
