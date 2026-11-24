import { Link } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { useSolicitudesPendientes } from '@/hooks/useSolicitudesAnticipo'
import { formatCOP } from '@/lib/utils'

/**
 * Aviso al admin en todas las pantallas: hay vendedores esperando que autorice
 * un anticipo menor al 50%. Se aprueba o rechaza desde la cotización.
 */
export function SolicitudesAnticipoBanner() {
  // La consulta solo corre para el admin; para los demás queda vacía.
  const { data: pendientes } = useSolicitudesPendientes()

  if (!pendientes?.length) return null

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 lg:px-6">
      <ShieldAlert className="h-4 w-4 shrink-0" />
      <span>
        {pendientes.length === 1
          ? 'Hay una solicitud para autorizar un anticipo menor al 50%:'
          : `Hay ${pendientes.length} solicitudes para autorizar anticipos menores al 50%:`}
      </span>
      {pendientes.map((s) => (
        <Link key={s.id} to={`/cotizaciones/${s.cotizacion_id}`} className="font-medium underline">
          {s.cotizacion?.numero ?? 'Cotización'} · <span className="font-mono">{formatCOP(s.monto_minimo)}</span>
        </Link>
      ))}
    </div>
  )
}
