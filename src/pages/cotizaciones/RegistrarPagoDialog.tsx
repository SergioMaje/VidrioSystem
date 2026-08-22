import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Loader2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useCajaActual } from '@/hooks/useCajaSesiones'
import { useRegistrarAnticipo, useRegistrarAbono, useSaldoCotizacion } from '@/hooks/useVentasCaja'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { anticipoMinimo, cumpleAnticipoMinimo, excedeSaldo } from '@/lib/pagos'
import { formatCOP, formatMiles, mensajeError, soloDigitos } from '@/lib/utils'
import type { Cotizacion, Venta } from '@/types/database'

type Props = {
  cotizacion: Cotizacion
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Cobra un pago de la cotización. El primer pago es el anticipo —cierra la venta,
 * crea la orden y exige el mínimo del 50%—; los siguientes son abonos libres.
 * Cuál de los dos es no lo decide quien abre el diálogo sino lo ya abonado, para
 * que la regla del mínimo no dependa del punto de entrada.
 */
export function RegistrarPagoDialog({ cotizacion, open, onOpenChange }: Props) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { usuario } = useAuth()
  const { data: sesionCaja } = useCajaActual()
  const { data: saldoInfo, isSuccess: saldoListo } = useSaldoCotizacion(cotizacion.id)
  const registrarAnticipo = useRegistrarAnticipo()
  const registrarAbono = useRegistrarAbono()

  const total = cotizacion.total
  const abonado = saldoInfo?.total_abonado ?? 0
  const saldo = saldoInfo?.saldo ?? total
  const minimo = anticipoMinimo(total)
  const esAdmin = usuario?.rol === 'admin'
  // Mientras el saldo no ha cargado se asume anticipo: es el lado que exige el
  // mínimo, así nunca se ofrece un cobro más laxo del que corresponde.
  const esAnticipo = abonado <= 0

  const [monto, setMonto] = useState('')
  const [metodoPago, setMetodoPago] = useState<Venta['metodo_pago']>('efectivo')
  const [fechaEntrega, setFechaEntrega] = useState('')
  const [autorizar, setAutorizar] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [inicializado, setInicializado] = useState(false)

  // Al abrir se precarga el monto habitual: el mínimo en el anticipo, el saldo
  // completo cuando se viene a liquidar. Se espera a conocer lo abonado —de eso
  // depende cuál de los dos es— y se hace una sola vez por apertura para no
  // pisar lo que el usuario escriba.
  useEffect(() => {
    if (!open) {
      setInicializado(false)
      return
    }
    if (inicializado || !saldoListo) return
    setMonto(String(esAnticipo ? minimo : Math.round(saldo)))
    setMetodoPago('efectivo')
    setFechaEntrega('')
    setAutorizar(false)
    setMotivo('')
    setInicializado(true)
  }, [open, inicializado, esAnticipo, minimo, saldo, saldoListo])

  const montoNum = Number(monto) || 0
  const bajoMinimo = esAnticipo && !cumpleAnticipoMinimo(montoNum, total)
  const sobrepasa = excedeSaldo(montoNum, esAnticipo ? total : saldo)
  const requiereAutorizacion = bajoMinimo && !(esAdmin && autorizar && motivo.trim().length > 0)
  const pendiente = registrarAnticipo.isPending || registrarAbono.isPending
  const puedeConfirmar = montoNum > 0 && !sobrepasa && !requiereAutorizacion && !pendiente

  const handleConfirmar = async () => {
    if (!usuario) return
    try {
      if (esAnticipo) {
        await registrarAnticipo.mutateAsync({
          cotizacion,
          sessionId: sesionCaja?.id,
          metodoPago,
          monto: montoNum,
          usuarioId: usuario.id,
          fechaEntregaEstimada: fechaEntrega || undefined,
          autorizadoPor: bajoMinimo ? usuario.id : undefined,
          motivoAutorizacion: bajoMinimo ? motivo : undefined,
        })
        toast({ title: 'Anticipo registrado — la producción ya puede iniciar', variant: 'success' })
      } else {
        await registrarAbono.mutateAsync({
          cotizacionId: cotizacion.id,
          sessionId: sesionCaja?.id,
          metodoPago,
          monto: montoNum,
          usuarioId: usuario.id,
        })
        toast({ title: 'Abono registrado', variant: 'success' })
      }
      onOpenChange(false)
    } catch (err) {
      toast({
        title: mensajeError(err, 'Error al registrar el pago'),
        variant: 'destructive',
      })
    }
  }

  const saldoResultante = Math.max(0, (esAnticipo ? total : saldo) - montoNum)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{esAnticipo ? 'Registrar anticipo' : 'Registrar abono'}</DialogTitle>
        </DialogHeader>

        {!sesionCaja ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              Debes abrir caja antes de registrar un pago.
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={() => navigate('/caja')}>Ir a Caja</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total cotización</span>
                <span className="font-mono">{formatCOP(total)}</span>
              </div>
              {abonado > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Abonado</span>
                  <span className="font-mono">{formatCOP(abonado)}</span>
                </div>
              )}
              <div className="flex justify-between font-medium">
                <span>Saldo pendiente</span>
                <span className="font-mono">{formatCOP(saldo)}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Monto a recibir</Label>
              {/* Se escribe solo en dígitos y se muestra agrupado en miles, para
                  no confundir 150.000 con 1.500.000 al teclear. */}
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
              <div className="flex gap-2 pt-0.5">
                {esAnticipo && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setMonto(String(minimo))}>
                    50% ({formatCOP(minimo)})
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setMonto(String(Math.round(esAnticipo ? total : saldo)))}
                >
                  {esAnticipo ? 'Total' : 'Saldo completo'}
                </Button>
              </div>
              {sobrepasa ? (
                <p className="text-xs text-destructive">
                  El monto excede el saldo pendiente ({formatCOP(esAnticipo ? total : saldo)}).
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Queda un saldo de <span className="font-mono">{formatCOP(saldoResultante)}</span>
                </p>
              )}
            </div>

            {bajoMinimo && (
              <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    El anticipo mínimo es el 50% del total (<span className="font-mono">{formatCOP(minimo)}</span>).
                    {!esAdmin && ' Pide a un administrador que autorice un monto menor.'}
                  </span>
                </div>
                {esAdmin && (
                  <div className="space-y-2 pt-1">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-amber-400 accent-amber-600"
                        checked={autorizar}
                        onChange={(e) => setAutorizar(e.target.checked)}
                      />
                      Autorizar anticipo menor al 50%
                    </label>
                    {autorizar && (
                      <textarea
                        className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        rows={2}
                        placeholder="Motivo de la autorización..."
                        value={motivo}
                        onChange={(e) => setMotivo(e.target.value)}
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Método de pago</Label>
              <Select value={metodoPago} onValueChange={(v) => setMetodoPago(v as Venta['metodo_pago'])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="efectivo">Efectivo</SelectItem>
                  <SelectItem value="tarjeta">Tarjeta</SelectItem>
                  <SelectItem value="transferencia">Transferencia</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {esAnticipo && (
              <div className="space-y-1.5">
                <Label>Fecha de entrega estimada</Label>
                <Input type="date" value={fechaEntrega} onChange={(e) => setFechaEntrega(e.target.value)} />
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={handleConfirmar} disabled={!puedeConfirmar}>
                {pendiente && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {esAnticipo ? 'Confirmar anticipo' : 'Confirmar abono'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
