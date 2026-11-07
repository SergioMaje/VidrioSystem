import { useRef, useState } from 'react'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { useVentasSesion } from '@/hooks/useVentasCaja'
import { useMovimientosSesion } from '@/hooks/useMovimientosCaja'
import { useAuth } from '@/hooks/useAuth'
import type { VentaConCotizacion } from '@/hooks/useVentasCaja'
import { calcularArqueo } from '@/lib/caja'
import { origenDeVenta } from '@/lib/pagos'
import type { MetodoPago } from '@/types/database'
import { AnularVentaDialog } from './AnularVentaDialog'
import { DesgloseMetodos } from './cierre/DesgloseMetodos'
import { DetalleMovimientos } from './cierre/DetalleMovimientos'
import { EstadoArqueo } from './cierre/EstadoArqueo'
import { FormulaEfectivo, type Destino, type SeccionDetalle } from './cierre/FormulaEfectivo'

/** Cifras del cierre, ya guardadas. Solo existen en un turno cerrado. */
export type Arqueo = {
  expected_amount: number | null
  counted_amount: number | null
  difference: number | null
  observacion_cierre?: string | null
}

/**
 * Arqueo de un turno de caja, en tres momentos:
 * - caja abierta (sin `contado` ni `arqueo`): proyecta lo que debería haber;
 * - cerrando (`contado`, null mientras no se digita): compara en vivo con el
 *   conteo. La cifra que vale es la que calcula `cerrar_caja`;
 * - turno cerrado (`arqueo`): muestra el conteo real, el descuadre y la observación.
 */
export function ResumenVentasSesion({
  sessionId,
  openingAmount,
  arqueo,
  contado,
}: {
  sessionId: string
  openingAmount: number
  arqueo?: Arqueo
  contado?: number | null
}) {
  const { data: ventas, isLoading } = useVentasSesion(sessionId)
  const { data: movimientos } = useMovimientosSesion(sessionId)
  const { usuario } = useAuth()
  const [aAnular, setAAnular] = useState<VentaConCotizacion | null>(null)
  const [detalleAbierto, setDetalleAbierto] = useState(false)
  const [seccion, setSeccion] = useState<SeccionDetalle>('ventas')
  const [metodo, setMetodo] = useState<MetodoPago | 'todos'>('todos')
  const detalleRef = useRef<HTMLDivElement>(null)
  // Cosmético: la regla de que solo un admin anula vive en el RPC anular_venta.
  const esAdmin = usuario?.rol === 'admin'

  if (isLoading) return <LoadingSpinner className="py-8" />

  const cifras = calcularArqueo(ventas, movimientos, openingAmount)

  // Con el turno cerrado no se recalcula el esperado: manda lo que guardó cerrar_caja.
  const esperado = arqueo?.expected_amount ?? cifras.efectivoEsperado
  const conteo = arqueo ? arqueo.counted_amount : contado ?? null
  const cifrasDesglose = { ...cifras, efectivoEsperado: esperado }

  const verDetalle = ({ seccion, metodo }: Destino) => {
    setSeccion(seccion)
    setMetodo(metodo ?? 'todos')
    setDetalleAbierto(true)
    requestAnimationFrame(() => detalleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  return (
    <div className="min-w-0 space-y-4">
      {(arqueo || contado !== undefined) && <EstadoArqueo esperado={esperado} contado={conteo} />}

      {arqueo?.observacion_cierre && (
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <p className="text-xs font-medium uppercase text-muted-foreground">Observación del cierre</p>
          <p className="whitespace-pre-wrap">{arqueo.observacion_cierre}</p>
        </div>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Desglose por método de pago</h3>
        <DesgloseMetodos cifras={cifrasDesglose} contado={conteo} />
        <p className="text-xs text-muted-foreground">
          {cifras.numCobros === 1 ? '1 cobro vigente' : `${cifras.numCobros} cobros vigentes`}. Solo el efectivo se cuenta en el cajón: tarjeta y transferencia
          se verifican contra el banco, y el crédito de financiera aún no es dinero recibido.
        </p>
      </section>

      <FormulaEfectivo cifras={cifras} onVer={verDetalle} />

      <div ref={detalleRef} className="scroll-mt-4">
        <DetalleMovimientos
          ventas={ventas ?? []}
          movimientos={movimientos ?? []}
          abierto={detalleAbierto}
          onAbiertoChange={setDetalleAbierto}
          seccion={seccion}
          onSeccionChange={setSeccion}
          metodo={metodo}
          onMetodoChange={setMetodo}
          onAnular={esAdmin ? setAAnular : undefined}
        />
      </div>

      <AnularVentaDialog
        venta={aAnular}
        documento={aAnular ? origenDeVenta(aAnular).numero : ''}
        onClose={() => setAAnular(null)}
      />
    </div>
  )
}
