import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useToast } from '@/hooks/useToast'
import { useCerrarCaja } from '@/hooks/useCajaSesiones'
import { formatCOP, mensajeError } from '@/lib/utils'
import { ResumenVentasSesion } from './ResumenVentasSesion'

export function CerrarCajaDialog({
  sessionId,
  openingAmount,
  open,
  onOpenChange,
}: {
  sessionId: string
  openingAmount: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { toast } = useToast()
  const cerrarCaja = useCerrarCaja()
  const [conteo, setConteo] = useState('')
  const [resultado, setResultado] = useState<{ expected_amount: number; counted_amount: number; difference: number } | null>(null)

  const handleCerrar = async () => {
    const counted_amount = Number(conteo)
    if (!conteo || counted_amount < 0) return
    try {
      const sesion = await cerrarCaja.mutateAsync({ sessionId, counted_amount })
      setResultado({
        expected_amount: sesion.expected_amount ?? 0,
        counted_amount: sesion.counted_amount ?? counted_amount,
        difference: sesion.difference ?? 0,
      })
      toast({ title: 'Caja cerrada', variant: 'success' })
    } catch (err) {
      toast({ title: mensajeError(err, 'Error al cerrar caja'), variant: 'destructive' })
    }
  }

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setConteo('')
      setResultado(null)
    }
    onOpenChange(isOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Cerrar caja</DialogTitle>
        </DialogHeader>
        {resultado ? (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Esperado</span><span className="font-mono">{formatCOP(resultado.expected_amount)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Contado</span><span className="font-mono">{formatCOP(resultado.counted_amount)}</span></div>
            <Separator />
            <div className="flex justify-between font-semibold">
              <span>Diferencia</span>
              <span className={`font-mono ${resultado.difference === 0 ? '' : resultado.difference > 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                {formatCOP(resultado.difference)}
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <ResumenVentasSesion sessionId={sessionId} openingAmount={openingAmount} />
            <div className="space-y-1">
              <Label>Conteo físico de efectivo</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={conteo}
                onChange={(e) => setConteo(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>
        )}
        <DialogFooter>
          {resultado ? (
            <Button onClick={() => handleClose(false)}>Listo</Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => handleClose(false)}>Cancelar</Button>
              <Button onClick={handleCerrar} disabled={cerrarCaja.isPending || !conteo}>
                {cerrarCaja.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirmar cierre
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
