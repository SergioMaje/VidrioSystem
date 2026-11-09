import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'

/** Lo que `CotizacionDetalle` lee para que su flecha vuelva a donde se vino. */
export type OrigenNavegacion = { desde: string; desdeEtiqueta: string }

const ETIQUETAS: Record<string, string> = {
  '/caja': 'Caja',
  '/reportes': 'Reportes',
}

/**
 * El número de un documento de cobro. Si viene de una cotización, enlaza a su
 * detalle y recuerda la página actual (con su `?tab=`) para poder volver. Las
 * ventas de mostrador no tienen detalle: quedan como texto.
 */
export function EnlaceDocumento({
  cotizacionId,
  children,
  className,
}: {
  cotizacionId?: string | null
  children: ReactNode
  className?: string
}) {
  const location = useLocation()

  if (!cotizacionId) return <span className={className}>{children}</span>

  const state: OrigenNavegacion = {
    desde: location.pathname + location.search,
    desdeEtiqueta: ETIQUETAS[location.pathname] ?? 'la página anterior',
  }

  return (
    <Link
      to={`/cotizaciones/${cotizacionId}`}
      state={state}
      title="Ver la cotización"
      className={cn(
        'text-primary underline-offset-2 hover:underline print:text-inherit print:no-underline',
        className
      )}
    >
      {children}
    </Link>
  )
}
