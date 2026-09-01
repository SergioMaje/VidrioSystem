import { useState } from 'react'
import { Link } from 'react-router-dom'
import { DollarSign } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { useCajaActual } from '@/hooks/useCajaSesiones'
import { formatCOP } from '@/lib/utils'
import { AbrirCajaCard } from './AbrirCajaCard'
import { CerrarCajaDialog } from './CerrarCajaDialog'
import { MovimientosTab } from './MovimientosTab'
import { ResumenVentasSesion } from './ResumenVentasSesion'
import { VenderTab } from './VenderTab'

export function CajaPage() {
  const { data: sesion, isLoading: cargandoSesion } = useCajaActual()
  const [cerrarOpen, setCerrarOpen] = useState(false)

  if (cargandoSesion) return <LoadingSpinner className="py-20" />

  // Sin turno abierto no hay nada que vender ni que arquear: abrir caja es el
  // primer paso obligatorio, así que es lo único que se muestra.
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
      {/* El estado del turno y su cierre viven fuera de las pestañas: deben
          estar a la vista tanto vendiendo como revisando. */}
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

      <Tabs defaultValue="vender">
        <TabsList>
          <TabsTrigger value="vender">Vender</TabsTrigger>
          <TabsTrigger value="movimientos">Movimientos</TabsTrigger>
          <TabsTrigger value="turno">Turno</TabsTrigger>
        </TabsList>

        <TabsContent value="vender" className="mt-4">
          <VenderTab />
        </TabsContent>

        <TabsContent value="movimientos" className="mt-4">
          <MovimientosTab sesion={sesion} />
        </TabsContent>

        <TabsContent value="turno" className="mt-4 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Ventas del turno</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <ResumenVentasSesion sessionId={sesion.id} openingAmount={sesion.opening_amount} />
              <p className="text-xs text-muted-foreground">
                Aquí entra todo lo cobrado en este turno: las ventas de mostrador de la pestaña{' '}
                <span className="font-medium">Vender</span> y los anticipos y abonos que se registran
                desde el detalle de cada <Link to="/cotizaciones" className="underline">cotización</Link>.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <CerrarCajaDialog
        sessionId={sesion.id}
        openingAmount={sesion.opening_amount}
        open={cerrarOpen}
        onOpenChange={setCerrarOpen}
      />
    </div>
  )
}
