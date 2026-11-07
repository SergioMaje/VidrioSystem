import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useAtajoConfirmar } from '@/hooks/useAtajoConfirmar'
import { PistaConfirmar } from '@/components/shared/Kbd'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  onConfirm: () => void
  loading?: boolean
  confirmLabel?: string
  variant?: 'destructive' | 'default'
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  loading = false,
  confirmLabel = 'Confirmar',
  variant = 'destructive',
}: ConfirmDialogProps) {
  // Lo destructivo (eliminar) pide Ctrl+Enter: un Enter de más no debe borrar nada.
  const conCtrl = variant === 'destructive'
  const atajo = useAtajoConfirmar(onConfirm, { habilitado: open && !loading, conCtrl })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={atajo}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button variant={variant} onClick={onConfirm} disabled={loading}>
            {loading ? 'Procesando...' : confirmLabel}
            {!loading && <PistaConfirmar conCtrl={conCtrl} />}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
