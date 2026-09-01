import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ErrorImportacion } from '@/lib/excel'

interface ResultadoImportacionDialogProps {
  open: boolean
  onClose: () => void
  titulo: string
  /** Línea verde de arriba: qué se va a aplicar si confirma. */
  resumen: string
  /** Aviso neutro opcional (ej: filas sin cantidad que se omiten). */
  nota?: string
  errores: ErrorImportacion[]
  /** Aviso al lado del contador de errores, para explicar qué pasa con esas filas. */
  destinoErrores?: string
  /** Tabla de previsualización de las filas válidas; la arma cada importador. */
  children?: ReactNode
  textoConfirmar: string
  puedeConfirmar: boolean
  confirmando: boolean
  onConfirmar: () => void
}

/**
 * Cáscara común de las dos importaciones por Excel (productos y stock): el
 * contador de válidos, la tabla de errores fila por fila y el botón de confirmar.
 * Lo único que cambia entre las dos es la tabla de previsualización, que entra
 * como children.
 */
export function ResultadoImportacionDialog({
  open, onClose, titulo, resumen, nota, errores, destinoErrores = 'no se importarán',
  children, textoConfirmar, puedeConfirmar, confirmando, onConfirmar,
}: ResultadoImportacionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(abierto) => { if (!abierto) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>{resumen}</span>
          </div>

          {nota && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Info className="h-4 w-4" />
              <span>{nota}</span>
            </div>
          )}

          {errores.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" />
                <span>{errores.length} fila(s) con errores ({destinoErrores})</span>
              </div>
              <div className="rounded-md border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left">
                      <th className="px-3 py-2">Fila</th>
                      <th className="px-3 py-2">Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errores.map((err) => (
                      <tr key={err.fila} className="border-b last:border-0">
                        <td className="px-3 py-2">{err.fila}</td>
                        <td className="px-3 py-2 text-muted-foreground">{err.motivo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {children}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
          <Button onClick={onConfirmar} disabled={!puedeConfirmar || confirmando}>
            {confirmando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {textoConfirmar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
