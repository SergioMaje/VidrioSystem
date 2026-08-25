import { useState } from 'react'
import { Loader2, Lock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { useAbrirCaja } from '@/hooks/useCajaSesiones'

export function AbrirCajaCard() {
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
          Ingresa el fondo inicial en efectivo para empezar a vender y a cobrar cotizaciones.
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
