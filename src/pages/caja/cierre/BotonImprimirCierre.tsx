import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSesionCaja } from '@/hooks/useCajaSesiones'
import { useConfiguracionEmpresa, useLogoEmpresaDataUri } from '@/hooks/useConfiguracionEmpresa'
import { useMovimientosSesion } from '@/hooks/useMovimientosCaja'
import { useVentasSesion } from '@/hooks/useVentasCaja'
import { imprimirCierreCaja } from '@/lib/imprimirCierreCaja'

/**
 * Abre el cierre de caja como documento aparte (membrete, todas las
 * transacciones y firmas) para imprimirlo o guardarlo como PDF. Los datos ya
 * están en caché: los cargó el resumen del turno que está en pantalla.
 *
 * Espera a que la sesión en caché ya esté cerrada: justo después de
 * `cerrar_caja` se vuelve a pedir, y antes no tiene el conteo ni quién cerró.
 */
export function BotonImprimirCierre({ sessionId }: { sessionId: string }) {
  const { data: sesion } = useSesionCaja(sessionId)
  const { data: ventas } = useVentasSesion(sessionId)
  const { data: movimientos } = useMovimientosSesion(sessionId)
  const { data: empresa } = useConfiguracionEmpresa()
  const { data: logo } = useLogoEmpresaDataUri()

  const listo = !!sesion?.closed_at && !!ventas && !!movimientos

  const imprimir = () => {
    if (!sesion || !ventas || !movimientos) return
    imprimirCierreCaja({ sesion, ventas, movimientos }, { empresa, logo })
  }

  return (
    <Button variant="outline" onClick={imprimir} disabled={!listo}>
      <Printer className="mr-2 h-4 w-4" />
      Imprimir / PDF
    </Button>
  )
}
