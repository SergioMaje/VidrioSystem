import { useHistorialCaja, useSesionCaja } from '@/hooks/useCajaSesiones'
import { formatCOP, formatDuracion, formatFecha, formatHora } from '@/lib/utils'

/** Cuántos cierres anteriores entran en el promedio de referencia. */
const CIERRES_PROMEDIO = 20

const nombre = (u: { nombre: string; apellido: string } | null) => (u ? `${u.nombre} ${u.apellido}` : '—')

/**
 * Fecha, horas y responsables del turno, y como referencia el descuadre
 * promedio de los cierres anteriores.
 */
export function EncabezadoTurno({ sessionId }: { sessionId: string }) {
  const { data: sesion } = useSesionCaja(sessionId)
  const { data: historial } = useHistorialCaja()
  if (!sesion) return null

  const anteriores = (historial ?? [])
    .filter((s) => s.id !== sessionId && s.difference != null)
    .slice(0, CIERRES_PROMEDIO)
  const promedio = anteriores.length
    ? anteriores.reduce((s, c) => s + (c.difference ?? 0), 0) / anteriores.length
    : null

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-4">
      <Dato titulo="Turno del">{formatFecha(sesion.opened_at)}</Dato>
      <Dato titulo="Horario">
        <span className="tabular-nums">
          {formatHora(sesion.opened_at)} → {sesion.closed_at ? formatHora(sesion.closed_at) : 'abierta'}
        </span>
        {sesion.closed_at && (
          <span className="block text-xs text-muted-foreground">{formatDuracion(sesion.opened_at, sesion.closed_at)}</span>
        )}
      </Dato>
      <Dato titulo="Abrió">{nombre(sesion.abierta_por)}</Dato>
      <Dato titulo="Cerró">{sesion.closed_at ? nombre(sesion.cerrada_por) : '—'}</Dato>
      {promedio != null && (
        <p className="col-span-2 text-xs text-muted-foreground sm:col-span-4">
          Referencia: en los últimos {anteriores.length} cierres la diferencia promedio fue{' '}
          <span className="font-medium tabular-nums text-foreground">{formatCOP(promedio, { signo: true })}</span>.
        </p>
      )}
    </dl>
  )
}

function Dato({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{titulo}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  )
}
