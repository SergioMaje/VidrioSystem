import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Handshake, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAprobarCredito } from '@/hooks/useCartera'
import { useToast } from '@/hooks/useToast'
import { textoCondicionCredito } from '@/lib/pagos'
import { formatCOP, mensajeError } from '@/lib/utils'
import type { Cliente, Cotizacion } from '@/types/database'

/**
 * Venta a crédito: el cliente (una empresa con crédito habilitado) aprueba y
 * paga contra entrega. Queda vendida y con su orden sin pasar por caja. La
 * cuenta de cobro se emite al entregar.
 */
export function AprobarCreditoDialog({
  cotizacion,
  cliente,
  open,
  onOpenChange,
  opcionesADescartar = [],
}: {
  cotizacion: Cotizacion
  cliente: Cliente
  open: boolean
  onOpenChange: (open: boolean) => void
  opcionesADescartar?: string[]
}) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const aprobar = useAprobarCredito()
  const [ordenCompra, setOrdenCompra] = useState('')
  const [fechaEntrega, setFechaEntrega] = useState('')

  useEffect(() => {
    if (open) {
      setOrdenCompra('')
      setFechaEntrega('')
    }
  }, [open])

  const confirmar = async () => {
    try {
      const orden = await aprobar.mutateAsync({
        cotizacionId: cotizacion.id,
        fechaEntrega: fechaEntrega || null,
        ordenCompra: ordenCompra.trim() || null,
      })
      toast({ title: 'Venta a crédito aprobada — la producción ya puede iniciar', variant: 'success' })
      onOpenChange(false)
      if (orden?.id) navigate(`/ordenes/${orden.id}`)
    } catch (err) {
      toast({ title: mensajeError(err, 'No se pudo aprobar a crédito'), variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Aprobar a crédito</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="rounded-md border bg-muted/40 px-3 py-2">
            <p className="font-medium">{cliente.empresa ?? `${cliente.nombre} ${cliente.apellido}`}</p>
            <p className="text-muted-foreground">
              {textoCondicionCredito(cliente.dias_credito)}
              {cliente.cupo_credito != null && ` · cupo ${formatCOP(cliente.cupo_credito)}`}
            </p>
            <p className="mt-1 font-mono text-base font-bold">{formatCOP(cotizacion.total)}</p>
          </div>
          <p className="text-muted-foreground">
            Se crea la orden de trabajo sin cobrar anticipo. Al entregar se emite la cuenta de cobro por el saldo,
            con vencimiento a {cliente.dias_credito} días.
          </p>
          {opcionesADescartar.length > 0 && (
            <p className="text-muted-foreground">
              Las opciones {opcionesADescartar.join(', ')} del envío quedarán descartadas.
            </p>
          )}
          <div className="space-y-1">
            <Label htmlFor="orden-compra">Orden de compra (opcional)</Label>
            <Input
              id="orden-compra"
              maxLength={60}
              placeholder="Ej: OC-2026-0142"
              value={ordenCompra}
              onChange={(e) => setOrdenCompra(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fecha-entrega-credito">Entrega estimada (opcional)</Label>
            <Input
              id="fecha-entrega-credito"
              type="date"
              value={fechaEntrega}
              onChange={(e) => setFechaEntrega(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={confirmar} disabled={aprobar.isPending}>
            {aprobar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Handshake className="mr-2 h-4 w-4" />}
            Aprobar a crédito
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
