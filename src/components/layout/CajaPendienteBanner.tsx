import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { useCajaActual } from '@/hooks/useCajaSesiones'
import { cajaVencida } from '@/lib/caja'
import { formatFecha } from '@/lib/utils'

/**
 * Aviso en todas las pantallas cuando la caja quedó abierta de un día anterior:
 * mientras no se cierre, la base rechaza ventas, cobros y gastos.
 */
export function CajaPendienteBanner() {
  const { data: sesion } = useCajaActual()

  if (!sesion || !cajaVencida(sesion.opened_at)) return null

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 lg:px-6">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>
        La caja quedó abierta desde el {formatFecha(sesion.opened_at)}. Ciérrala antes de seguir vendiendo.
      </span>
      <Link to="/caja" className="font-medium underline">
        Ir a Caja
      </Link>
    </div>
  )
}
