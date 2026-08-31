import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useToast } from '@/hooks/useToast'
import { useRegistrarGasto } from '@/hooks/useMovimientosCaja'
import { CATEGORIA_GASTO_LABEL, METODO_PAGO_LABEL } from '@/lib/pagos'
import { formatCOP, formatMiles, mensajeError, soloDigitos } from '@/lib/utils'
import type { CategoriaGasto, MetodoPago } from '@/types/database'

type Props = {
  /** Efectivo que hay ahora en el cajón: fondo + ventas en efectivo − gastos. */
  efectivoDisponible: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Registra una salida de dinero del turno. El turno lo resuelve el RPC, no esta
 * pantalla: el diálogo solo se abre con la caja abierta.
 */
export function RegistrarGastoDialog({ efectivoDisponible, open, onOpenChange }: Props) {
  const { toast } = useToast()
  const registrarGasto = useRegistrarGasto()

  const [categoria, setCategoria] = useState<CategoriaGasto>('domicilio')
  const [concepto, setConcepto] = useState('')
  const [monto, setMonto] = useState('')
  const [metodoPago, setMetodoPago] = useState<MetodoPago>('efectivo')

  // Cada apertura empieza en blanco: el diálogo se monta una sola vez y sin esto
  // el segundo gasto arrancaría con los datos del primero.
  useEffect(() => {
    if (!open) return
    setCategoria('domicilio')
    setConcepto('')
    setMonto('')
    setMetodoPago('efectivo')
  }, [open])

  const montoNum = Number(monto) || 0
  // Del cajón no puede salir plata que no está. Mensaje legible aquí, garantía
  // real en `registrar_gasto_caja`.
  const sobrepasa = metodoPago === 'efectivo' && montoNum > efectivoDisponible
  const puedeConfirmar =
    montoNum > 0 && concepto.trim().length > 0 && !sobrepasa && !registrarGasto.isPending

  const handleConfirmar = async () => {
    if (!puedeConfirmar) return
    try {
      await registrarGasto.mutateAsync({
        categoria,
        concepto: concepto.trim(),
        monto: montoNum,
        metodoPago,
      })
      toast({ title: 'Gasto registrado', variant: 'success' })
      onOpenChange(false)
    } catch (err) {
      toast({ title: mensajeError(err, 'Error al registrar el gasto'), variant: 'destructive' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Registrar gasto</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Categoría</Label>
            <Select value={categoria} onValueChange={(v) => setCategoria(v as CategoriaGasto)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(CATEGORIA_GASTO_LABEL) as CategoriaGasto[]).map((c) => (
                  <SelectItem key={c} value={c}>{CATEGORIA_GASTO_LABEL[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Concepto</Label>
            <Input
              autoComplete="off"
              placeholder="Ej: mensajero al centro"
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Monto</Label>
            {/* Mismo input de dinero que RegistrarPagoDialog: se teclean dígitos
                y se muestran agrupados, para no confundir 20.000 con 200.000. */}
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                $
              </span>
              <Input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="0"
                value={monto === '' ? '' : formatMiles(Number(monto))}
                onChange={(e) => setMonto(soloDigitos(e.target.value))}
                className="pl-7 text-right font-mono text-base"
              />
            </div>
            {metodoPago === 'efectivo' &&
              (sobrepasa ? (
                <p className="text-xs text-destructive">
                  No hay tanto efectivo en caja (disponible {formatCOP(efectivoDisponible)}).
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Quedan <span className="font-mono">{formatCOP(efectivoDisponible - montoNum)}</span> en
                  el cajón
                </p>
              ))}
          </div>

          <div className="space-y-1.5">
            <Label>Método de pago</Label>
            <Select value={metodoPago} onValueChange={(v) => setMetodoPago(v as MetodoPago)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(METODO_PAGO_LABEL) as MetodoPago[]).map((m) => (
                  <SelectItem key={m} value={m}>{METODO_PAGO_LABEL[m]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {metodoPago !== 'efectivo' && (
              <p className="text-xs text-muted-foreground">
                Solo los gastos en efectivo descuentan del arqueo del cierre.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={handleConfirmar} disabled={!puedeConfirmar}>
              {registrarGasto.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Registrar gasto
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
