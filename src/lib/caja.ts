// El día de caja se corta a medianoche hora Colombia, igual que
// `caja_es_del_dia` en Postgres: la base es la que bloquea, esto solo avisa antes.
const fechaBogota = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' })

/** La sesión se abrió en un día anterior y ya solo admite cerrarse. */
export function cajaVencida(openedAt: string): boolean {
  return fechaBogota.format(new Date(openedAt)) !== fechaBogota.format(new Date())
}
