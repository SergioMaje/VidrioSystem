import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Lock, DollarSign, ShoppingCart } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { useCajaActual, useAbrirCaja, useCerrarCaja } from '@/hooks/useCajaSesiones'
import { useVentasSesion } from '@/hooks/useVentasCaja'
import { TIPO_PAGO_LABEL } from '@/lib/pagos'
import { formatCOP, mensajeError } from '@/lib/utils'
import type { Venta } from '@/types/database'

const METODO_LABEL: Record<Venta['metodo_pago'], string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
}

/** Cifras del cierre, ya guardadas. Solo existen en un turno cerrado. */
export type Arqueo = {
  expected_amount: number | null
  counted_amount: number | null
  difference: number | null
}

/**
 * Movimiento de un turno de caja. Sirve a dos momentos distintos: con la caja
 * abierta (sin `arqueo`) proyecta el efectivo que debería haber en el cajón;
 * con el turno ya cerrado (con `arqueo`) muestra el conteo real y el descuadre.
 */
export function ResumenVentasSesion({
  sessionId,
  openingAmount,
  arqueo,
}: {
  sessionId: string
  openingAmount: number
  arqueo?: Arqueo
}) {
  const { data: ventas, isLoading } = useVentasSesion(sessionId)

  if (isLoading) return <LoadingSpinner className="py-8" />

  const totales = { efectivo: 0, tarjeta: 0, transferencia: 0 } as Record<Venta['metodo_pago'], number>
  for (const v of ventas ?? []) totales[v.metodo_pago] += v.monto
  const totalGeneral = totales.efectivo + totales.tarjeta + totales.transferencia
  const efectivoEsperado = openingAmount + totales.efectivo

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 text-sm">
        {(Object.keys(METODO_LABEL) as Venta['metodo_pago'][]).map((metodo) => (
          <div key={metodo} className="rounded-md border p-2 text-center">
            <p className="text-xs text-muted-foreground">{METODO_LABEL[metodo]}</p>
            <p className="font-mono font-semibold">{formatCOP(totales[metodo])}</p>
          </div>
        ))}
      </div>

      {!ventas || ventas.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">No se registraron pagos en este turno</p>
      ) : (
        <div className="max-h-48 overflow-y-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase text-muted-foreground">
                <th className="px-3 py-2">Cotización</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Método</th>
                <th className="px-3 py-2 text-right">Monto</th>
              </tr>
            </thead>
            <tbody>
              {ventas.map((v) => (
                <tr key={v.id} className="border-b last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">{v.cotizacion?.numero ?? '—'}</td>
                  <td className="px-3 py-2">
                    {v.cotizacion?.cliente ? `${v.cotizacion.cliente.nombre} ${v.cotizacion.cliente.apellido}` : '—'}
                  </td>
                  <td className="px-3 py-2">{TIPO_PAGO_LABEL[v.tipo]}</td>
                  <td className="px-3 py-2">{METODO_LABEL[v.metodo_pago]}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatCOP(v.monto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Separator />

      <div className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total cobrado ({ventas?.length ?? 0} pagos)</span>
          <span className="font-mono font-semibold">{formatCOP(totalGeneral)}</span>
        </div>
        <p className="pt-2 text-xs font-medium uppercase text-muted-foreground">Arqueo de efectivo</p>
        <div className="flex justify-between"><span className="text-muted-foreground">Fondo inicial</span><span className="font-mono">{formatCOP(openingAmount)}</span></div>

        {arqueo ? (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Esperado</span>
              <span className="font-mono">{arqueo.expected_amount != null ? formatCOP(arqueo.expected_amount) : '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Contado</span>
              <span className="font-mono">{arqueo.counted_amount != null ? formatCOP(arqueo.counted_amount) : '—'}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Diferencia</span>
              {arqueo.difference != null ? (
                <span className={`font-mono ${arqueo.difference === 0 ? '' : arqueo.difference > 0 ? 'text-emerald-600' : 'text-destructive'}`}>
                  {formatCOP(arqueo.difference)}
                </span>
              ) : <span className="font-mono">—</span>}
            </div>
          </>
        ) : (
          <div className="flex justify-between font-semibold">
            <span>Efectivo esperado en caja</span>
            <span className="font-mono text-primary">{formatCOP(efectivoEsperado)}</span>
          </div>
        )}

        <p className="pt-1 text-xs text-muted-foreground">
          El arqueo cubre solo el efectivo: transferencias y tarjetas no pasan por el cajón.
        </p>
      </div>
    </div>
  )
}

function AbrirCajaCard() {
  const { usuario } = useAuth()
  const { toast } = useToast()
  const abrirCaja = useAbrirCaja()
  const [monto, setMonto] = useState('')

  const handleAbrir = async () => {
    const opening_amount = Number(monto)
    if (!usuario || !monto || opening_amount < 0) return
    try {
      await abrirCaja.mutateAsync({ opening_amount, opened_by: usuario.id })
      toast({ title: 'Caja abierta', variant: 'success' })
      setMonto('')
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Error al abrir caja', variant: 'destructive' })
    }
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lock className="h-4 w-4" />
          Abrir caja
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Ingresa el fondo inicial en efectivo para empezar a registrar ventas.
        </p>
        <div className="space-y-1">
          <Label>Monto inicial</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            placeholder="0"
          />
        </div>
        <Button className="w-full" onClick={handleAbrir} disabled={abrirCaja.isPending || !monto}>
          {abrirCaja.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Abrir caja
        </Button>
      </CardContent>
    </Card>
  )
}

function CerrarCajaDialog({
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

export function CajaPage() {
  const { data: sesion, isLoading: cargandoSesion } = useCajaActual()
  const [cerrarOpen, setCerrarOpen] = useState(false)

  if (cargandoSesion) return <LoadingSpinner className="py-20" />

  if (!sesion) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold">Caja</h2>
        <AbrirCajaCard />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Caja</h2>
          <p className="text-sm text-muted-foreground">Fondo inicial: {formatCOP(sesion.opening_amount)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="success">Abierta</Badge>
          <Button variant="outline" onClick={() => setCerrarOpen(true)}>
            <DollarSign className="mr-2 h-4 w-4" />
            Cerrar caja
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Ventas del turno</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <ShoppingCart className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground max-w-sm">
              Las ventas se registran desde el detalle de cada cotización — cuando el cliente
              aprueba, se cobra ahí mismo y queda ligada a este turno de caja.
            </p>
            <Button variant="outline" asChild>
              <Link to="/cotizaciones">Ir a Cotizaciones</Link>
            </Button>
          </div>
          <Separator className="my-2" />
          <ResumenVentasSesion sessionId={sesion.id} openingAmount={sesion.opening_amount} />
        </CardContent>
      </Card>

      <CerrarCajaDialog
        sessionId={sesion.id}
        openingAmount={sesion.opening_amount}
        open={cerrarOpen}
        onOpenChange={setCerrarOpen}
      />
    </div>
  )
}
