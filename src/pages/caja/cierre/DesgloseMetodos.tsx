import type { CifrasTurno } from '@/lib/caja'
import { METODO_PAGO_LABEL } from '@/lib/pagos'
import type { MetodoPago } from '@/types/database'
import { Monto } from './Monto'

type Fila = {
  metodo: MetodoPago
  nombre: string
  nota?: string
  esperado: number
  /** null: no se cuenta (no pasa por el cajón). */
  contado: number | null | 'pendiente'
}

/**
 * Método | Esperado | Contado | Diferencia. Solo el efectivo se cuenta: tarjeta
 * y transferencia se verifican contra el banco, y el crédito de financiera no es
 * dinero recibido, así que va en su propio grupo y no suma al total.
 */
export function DesgloseMetodos({ cifras, contado }: { cifras: CifrasTurno; contado: number | null }) {
  const dinero: Fila[] = [
    {
      metodo: 'efectivo',
      nombre: 'Efectivo en cajón',
      nota: 'Fondo + cobros − gastos',
      esperado: cifras.efectivoEsperado,
      contado: contado ?? 'pendiente',
    },
    { metodo: 'tarjeta', nombre: METODO_PAGO_LABEL.tarjeta, esperado: cifras.porMetodo.tarjeta, contado: null },
    {
      metodo: 'transferencia',
      nombre: METODO_PAGO_LABEL.transferencia,
      nota: 'Incluye Nequi y similares',
      esperado: cifras.porMetodo.transferencia,
      contado: null,
    },
  ]
  const totalEsperado = dinero.reduce((s, f) => s + f.esperado, 0)
  const diferenciaEfectivo = contado == null ? null : contado - cifras.efectivoEsperado
  const credito: Fila = {
    metodo: 'financiera',
    nombre: METODO_PAGO_LABEL.financiera,
    nota: 'Por desembolsar: no entró a caja',
    esperado: cifras.creditoFinanciera,
    contado: null,
  }

  return (
    <div className="min-w-0">
      {/* Pantallas medianas en adelante: tabla. */}
      <div className="hidden overflow-x-auto rounded-md border sm:block print:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-xs font-medium uppercase text-muted-foreground">
              <th className="px-3 py-2 text-left">Método</th>
              <th className="px-3 py-2 text-right">Esperado</th>
              <th className="px-3 py-2 text-right">Contado</th>
              <th className="px-3 py-2 text-right">Diferencia</th>
            </tr>
          </thead>
          <tbody>
            <FilaGrupo titulo="Dinero recibido" />
            {dinero.map((f) => (
              <FilaTabla key={f.metodo} fila={f} />
            ))}
            <tr className="border-b bg-muted/30 font-semibold">
              <td className="px-3 py-2">Total dinero</td>
              <td className="px-3 py-2 text-right"><Monto valor={totalEsperado} /></td>
              <td className="px-3 py-2 text-right text-xs font-normal text-muted-foreground">Solo efectivo</td>
              <td className="px-3 py-2 text-right">
                {diferenciaEfectivo == null ? <Vacio /> : <Monto valor={diferenciaEfectivo} signo />}
              </td>
            </tr>
            {cifras.creditoFinanciera > 0 && (
              <>
                <FilaGrupo titulo="A crédito (no es dinero recibido)" />
                <FilaTabla fila={credito} />
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* Celular: una tarjeta por método, sin columnas que se aprieten. */}
      <div className="space-y-2 sm:hidden print:hidden">
        {dinero.map((f) => (
          <TarjetaMetodo key={f.metodo} fila={f} />
        ))}
        <div className="flex items-baseline justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm font-semibold">
          <span>Total dinero</span>
          <Monto valor={totalEsperado} />
        </div>
        {cifras.creditoFinanciera > 0 && <TarjetaMetodo fila={credito} />}
      </div>
    </div>
  )
}

function Vacio() {
  return <span className="text-muted-foreground">—</span>
}

function FilaGrupo({ titulo }: { titulo: string }) {
  return (
    <tr className="border-b">
      <td colSpan={4} className="px-3 pb-1 pt-3 text-xs font-medium text-muted-foreground">
        {titulo}
      </td>
    </tr>
  )
}

function ContadoCelda({ contado }: { contado: Fila['contado'] }) {
  if (contado === null) return <span className="text-xs text-muted-foreground">No se cuenta</span>
  if (contado === 'pendiente') return <span className="text-xs text-muted-foreground">Pendiente</span>
  return <Monto valor={contado} />
}

function DiferenciaCelda({ fila }: { fila: Fila }) {
  if (typeof fila.contado !== 'number') return <Vacio />
  return <Monto valor={fila.contado - fila.esperado} signo />
}

function FilaTabla({ fila }: { fila: Fila }) {
  return (
    <tr className="border-b last:border-0">
      <td className="px-3 py-2">
        <p>{fila.nombre}</p>
        {fila.nota && <p className="text-xs text-muted-foreground">{fila.nota}</p>}
      </td>
      <td className="px-3 py-2 text-right"><Monto valor={fila.esperado} /></td>
      <td className="px-3 py-2 text-right"><ContadoCelda contado={fila.contado} /></td>
      <td className="px-3 py-2 text-right"><DiferenciaCelda fila={fila} /></td>
    </tr>
  )
}

function TarjetaMetodo({ fila }: { fila: Fila }) {
  return (
    <div className="rounded-md border p-3 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-medium">{fila.nombre}</p>
        <Monto valor={fila.esperado} className="font-semibold" />
      </div>
      {fila.nota && <p className="text-xs text-muted-foreground">{fila.nota}</p>}
      <div className="mt-2 flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span>Contado</span>
        <ContadoCelda contado={fila.contado} />
      </div>
      {typeof fila.contado === 'number' && (
        <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
          <span>Diferencia</span>
          <DiferenciaCelda fila={fila} />
        </div>
      )}
    </div>
  )
}
