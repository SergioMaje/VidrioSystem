import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { useVentasSesion } from '@/hooks/useVentasCaja'
import { useMovimientosSesion } from '@/hooks/useMovimientosCaja'
import { useAuth } from '@/hooks/useAuth'
import type { VentaConCotizacion } from '@/hooks/useVentasCaja'
import {
  METODO_PAGO_LABEL,
  TIPO_PAGO_LABEL,
  esGastoVivo,
  esReversoAnulacion,
  esVentaAnulada,
  origenDeVenta,
  totalGastosEfectivo,
} from '@/lib/pagos'
import { formatCOP } from '@/lib/utils'
import type { MetodoPago } from '@/types/database'
import { AnularVentaDialog, BadgeAnulada } from './AnularVentaDialog'

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
  const { data: movimientos } = useMovimientosSesion(sessionId)
  const { usuario } = useAuth()
  const [aAnular, setAAnular] = useState<VentaConCotizacion | null>(null)
  // Cosmético: la regla de que solo un admin anula vive en el RPC anular_venta.
  const esAdmin = usuario?.rol === 'admin'

  if (isLoading) return <LoadingSpinner className="py-8" />

  // Las ventas del turno no incluyen los cobros anulados.
  const totales: Record<MetodoPago, number> = { efectivo: 0, tarjeta: 0, transferencia: 0, financiera: 0 }
  const activas = (ventas ?? []).filter((v) => !esVentaAnulada(v))
  for (const v of activas) totales[v.metodo_pago] += v.monto
  const totalGeneral = Object.values(totales).reduce((suma, t) => suma + t, 0)

  // El arqueo sí cuenta todo lo que entró al cajón, anulado o no: el cobro
  // anulado entró, y su reverso lo compensa como egreso. Es la misma cuenta de
  // `cerrar_caja`. Con el turno cerrado no se recalcula nada: manda `arqueo`.
  const ingresosEfectivo = (ventas ?? []).reduce(
    (suma, v) => (v.metodo_pago === 'efectivo' ? suma + v.monto : suma),
    0
  )
  const vivos = (movimientos ?? []).filter(esGastoVivo)
  const gastosEfectivo = totalGastosEfectivo(vivos.filter((m) => !esReversoAnulacion(m)))
  const reversosEfectivo = totalGastosEfectivo(vivos.filter(esReversoAnulacion))
  const efectivoEsperado = openingAmount + ingresosEfectivo - gastosEfectivo - reversosEfectivo

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {(Object.keys(METODO_PAGO_LABEL) as MetodoPago[]).map((metodo) => (
          <div key={metodo} className="rounded-md border p-2 text-center">
            <p className="text-xs text-muted-foreground">{METODO_PAGO_LABEL[metodo]}</p>
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
                <th className="px-3 py-2">N° Documento</th>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Método</th>
                <th className="px-3 py-2 text-right">Monto</th>
                {esAdmin && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {ventas.map((v) => {
                const origen = origenDeVenta(v)
                const anulada = esVentaAnulada(v)
                return (
                  <tr key={v.id} className={`border-b last:border-0 ${anulada ? 'text-muted-foreground' : ''}`}>
                    <td className="px-3 py-2 font-mono text-xs">
                      <span className={anulada ? 'line-through' : ''}>{origen.numero}</span>
                      {anulada && <BadgeAnulada motivo={v.motivo_anulacion} />}
                    </td>
                    <td className="px-3 py-2">{origen.cliente}</td>
                    <td className="px-3 py-2">{TIPO_PAGO_LABEL[v.tipo]}</td>
                    <td className="px-3 py-2">{METODO_PAGO_LABEL[v.metodo_pago]}</td>
                    <td className={`px-3 py-2 text-right font-mono ${anulada ? 'line-through' : ''}`}>
                      {formatCOP(v.monto)}
                    </td>
                    {esAdmin && (
                      <td className="px-3 py-2 text-right">
                        {!anulada && (
                          <Button size="sm" variant="ghost" onClick={() => setAAnular(v)}>
                            Anular
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Separator />

      <div className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total cobrado ({activas.length} pagos)</span>
          <span className="font-mono font-semibold">{formatCOP(totalGeneral)}</span>
        </div>
        {totales.financiera > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">de ello, a crédito de financiera (por desembolsar)</span>
            <span className="font-mono">{formatCOP(totales.financiera)}</span>
          </div>
        )}
        <p className="pt-2 text-xs font-medium uppercase text-muted-foreground">Arqueo de efectivo</p>
        <div className="flex justify-between"><span className="text-muted-foreground">Fondo inicial</span><span className="font-mono">{formatCOP(openingAmount)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Cobros en efectivo (+)</span><span className="font-mono">{formatCOP(ingresosEfectivo)}</span></div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Gastos en efectivo (−)</span>
          <span className={`font-mono ${gastosEfectivo > 0 ? 'text-destructive' : ''}`}>
            {formatCOP(gastosEfectivo)}
          </span>
        </div>
        {reversosEfectivo > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Reversos de ventas anuladas (−)</span>
            <span className="font-mono text-destructive">{formatCOP(reversosEfectivo)}</span>
          </div>
        )}

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
          El arqueo cubre solo el efectivo: transferencias, tarjetas y créditos de financiera no pasan
          por el cajón.
        </p>
      </div>

      <AnularVentaDialog
        venta={aAnular}
        documento={aAnular ? origenDeVenta(aAnular).numero : ''}
        onClose={() => setAAnular(null)}
      />
    </div>
  )
}
