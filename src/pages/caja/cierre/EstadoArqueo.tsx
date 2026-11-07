import { AlertTriangle, CheckCircle2, Clock, XCircle } from 'lucide-react'
import { TOLERANCIA_CAJA, estadoArqueo, textoDiferencia, type EstadoArqueo as Estado } from '@/lib/caja'
import { cn, formatCOP } from '@/lib/utils'
import { Monto } from './Monto'

const ESTILO: Record<Estado, { caja: string; texto: string; icono: typeof CheckCircle2; detalle: string }> = {
  cuadra: {
    caja: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    texto: 'text-emerald-700',
    icono: CheckCircle2,
    detalle: 'El efectivo contado coincide con el sistema.',
  },
  tolerancia: {
    caja: 'border-amber-200 bg-amber-50 text-amber-800',
    texto: 'text-amber-700',
    icono: AlertTriangle,
    detalle: `Dentro de la tolerancia de ${formatCOP(TOLERANCIA_CAJA)}.`,
  },
  fuera: {
    caja: 'border-red-200 bg-red-50 text-red-800',
    texto: 'text-red-700',
    icono: XCircle,
    detalle: `Supera la tolerancia de ${formatCOP(TOLERANCIA_CAJA)}: requiere una observación.`,
  },
}

/**
 * Lo primero que se lee en el cierre: la diferencia en grande, con ícono y
 * texto ("Faltan $12.000"), y debajo las tres cifras que la producen.
 * `contado` es null mientras el cajero no ha digitado el conteo.
 */
export function EstadoArqueo({ esperado, contado }: { esperado: number; contado: number | null }) {
  const diferencia = contado == null ? null : contado - esperado

  return (
    <div className="space-y-3">
      {diferencia == null ? (
        <div className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-muted-foreground">
          <Clock className="h-8 w-8 shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="text-lg font-semibold">Pendiente de conteo</p>
            <p className="text-sm">Digita o cuenta el efectivo del cajón para ver si cuadra.</p>
          </div>
        </div>
      ) : (
        <BannerDiferencia diferencia={diferencia} />
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Tarjeta titulo="Esperado en sistema">
          <Monto valor={esperado} />
        </Tarjeta>
        <Tarjeta titulo="Contado físicamente">
          {contado == null ? <span className="text-muted-foreground">—</span> : <Monto valor={contado} />}
        </Tarjeta>
        <Tarjeta titulo="Diferencia">
          {diferencia == null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <Monto valor={diferencia} signo className={ESTILO[estadoArqueo(diferencia)].texto} />
          )}
        </Tarjeta>
      </div>
    </div>
  )
}

function BannerDiferencia({ diferencia }: { diferencia: number }) {
  const estado = estadoArqueo(diferencia)
  const { caja, icono: Icono, detalle } = ESTILO[estado]
  return (
    <div role="status" className={cn('flex items-center gap-3 rounded-lg border p-4', caja)}>
      <Icono className="h-9 w-9 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-tight tabular-nums [overflow-wrap:anywhere] sm:text-3xl">
          {textoDiferencia(diferencia)}
        </p>
        <p className="text-sm">{detalle}</p>
      </div>
    </div>
  )
}

function Tarjeta({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2 rounded-md border p-3 sm:block">
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className="text-lg font-semibold sm:mt-1 sm:text-right sm:text-xl">{children}</p>
    </div>
  )
}
