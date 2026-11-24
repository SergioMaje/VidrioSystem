import { useState } from 'react'
import { Loader2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useResolverSolicitud, useSolicitudAnticipo } from '@/hooks/useSolicitudesAnticipo'
import { useToast } from '@/hooks/useToast'
import { anticipoMinimo } from '@/lib/pagos'
import { formatCOP, formatFechaHora, mensajeError } from '@/lib/utils'
import type { Cotizacion } from '@/types/database'

/**
 * Para el admin: la solicitud pendiente de un vendedor para cobrar un anticipo
 * menor al 50%. Aprobarla deja al vendedor cobrar desde ese monto; la
 * garantía está en el trigger del cobro.
 */
export function SolicitudAnticipoPanel({ cotizacion }: { cotizacion: Cotizacion }) {
  const { toast } = useToast()
  const { data: solicitud } = useSolicitudAnticipo(cotizacion.id)
  const resolver = useResolverSolicitud()
  const [rechazando, setRechazando] = useState(false)
  const [motivoRechazo, setMotivoRechazo] = useState('')

  if (!solicitud || solicitud.estado !== 'pendiente') return null

  const solicitante = solicitud.solicitante
    ? [solicitud.solicitante.nombre, solicitud.solicitante.apellido].filter(Boolean).join(' ')
    : 'Un vendedor'
  const pct = cotizacion.total > 0 ? Math.round((solicitud.monto_minimo / cotizacion.total) * 100) : 0

  const resolverSolicitud = async (aprobar: boolean) => {
    try {
      await resolver.mutateAsync({
        solicitudId: solicitud.id,
        cotizacionId: cotizacion.id,
        aprobar,
        motivoRechazo,
      })
      toast({
        title: aprobar ? 'Anticipo autorizado — el vendedor ya puede cobrar' : 'Solicitud rechazada',
        variant: 'success',
      })
      setRechazando(false)
      setMotivoRechazo('')
    } catch (err) {
      toast({ title: mensajeError(err, 'No se pudo resolver la solicitud'), variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-1">
          <p className="font-medium">
            {solicitante} pide cobrar un anticipo desde{' '}
            <span className="font-mono">{formatCOP(solicitud.monto_minimo)}</span> ({pct}% del total)
          </p>
          <p>
            <span className="font-medium">Motivo:</span> {solicitud.motivo}
          </p>
          <p className="text-xs opacity-80">
            Sin autorización, el mínimo es {formatCOP(anticipoMinimo(cotizacion.total))}. Pedida el{' '}
            {formatFechaHora(solicitud.created_at)}.
          </p>
        </div>
      </div>

      {rechazando ? (
        <div className="space-y-2">
          <textarea
            autoFocus
            className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            rows={2}
            placeholder="Motivo del rechazo (lo verá el vendedor)..."
            value={motivoRechazo}
            onChange={(e) => setMotivoRechazo(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={resolver.isPending} onClick={() => setRechazando(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={resolver.isPending || motivoRechazo.trim().length === 0}
              onClick={() => resolverSolicitud(false)}
            >
              {resolver.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Rechazar
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" disabled={resolver.isPending} onClick={() => setRechazando(true)}>
            Rechazar
          </Button>
          <Button size="sm" disabled={resolver.isPending} onClick={() => resolverSolicitud(true)}>
            {resolver.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Autorizar
          </Button>
        </div>
      )}
    </div>
  )
}
