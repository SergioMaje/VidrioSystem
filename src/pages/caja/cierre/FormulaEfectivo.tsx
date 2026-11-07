import { ChevronRight } from 'lucide-react'
import type { CifrasTurno } from '@/lib/caja'
import type { MetodoPago } from '@/types/database'
import { Monto } from './Monto'

export type SeccionDetalle = 'ventas' | 'gastos' | 'retiros' | 'devoluciones'

/** A qué parte del detalle lleva cada término de la fórmula. */
export type Destino = { seccion: SeccionDetalle; metodo?: MetodoPago }

type Termino = { signo: '+' | '−' | ''; nombre: string; valor: number; destino?: Destino; siempre?: boolean }

/**
 * La cuenta del efectivo esperado, término por término, como la hace
 * `cerrar_caja`. Cada término abre las transacciones que lo componen. Los
 * reversos solo aparecen si los hubo.
 */
export function FormulaEfectivo({ cifras, onVer }: { cifras: CifrasTurno; onVer: (d: Destino) => void }) {
  const terminos: Termino[] = [
    { signo: '', nombre: 'Base inicial', valor: cifras.fondo, siempre: true },
    {
      signo: '+',
      nombre: 'Ventas en efectivo',
      valor: cifras.ventasEfectivo,
      destino: { seccion: 'ventas', metodo: 'efectivo' },
      siempre: true,
    },
    { signo: '−', nombre: 'Gastos en efectivo', valor: cifras.gastos, destino: { seccion: 'gastos', metodo: 'efectivo' }, siempre: true },
    { signo: '−', nombre: 'Retiros de efectivo', valor: cifras.retiros, destino: { seccion: 'retiros', metodo: 'efectivo' }, siempre: true },
    {
      signo: '−',
      nombre: 'Devoluciones (reversos de anulación)',
      valor: cifras.reversos,
      destino: { seccion: 'devoluciones' },
    },
  ]

  return (
    <div className="min-w-0 rounded-md border">
      <p className="border-b bg-muted/50 px-3 py-2 text-xs font-medium uppercase text-muted-foreground">
        Cómo se calcula el efectivo esperado
      </p>
      <ul className="divide-y text-sm">
        {terminos
          .filter((t) => t.siempre || t.valor !== 0)
          .map((t) => (
            <li key={t.nombre}>
              {t.destino ? (
                <button
                  type="button"
                  onClick={() => onVer(t.destino!)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                  title="Ver las transacciones"
                >
                  <FilaTermino termino={t} />
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground print:hidden" aria-hidden />
                </button>
              ) : (
                <div className="flex items-center gap-2 px-3 py-2">
                  <FilaTermino termino={t} />
                  <span className="w-4 shrink-0 print:hidden" />
                </div>
              )}
            </li>
          ))}
        <li className="flex items-center gap-2 bg-muted/30 px-3 py-2 font-semibold">
          <span className="w-4 shrink-0 text-center">=</span>
          <span className="min-w-0 flex-1">Efectivo esperado</span>
          <Monto valor={cifras.efectivoEsperado} className="text-primary" />
          <span className="w-4 shrink-0 print:hidden" />
        </li>
      </ul>
    </div>
  )
}

function FilaTermino({ termino }: { termino: Termino }) {
  return (
    <>
      <span className="w-4 shrink-0 text-center font-semibold text-muted-foreground" aria-hidden>
        {termino.signo}
      </span>
      <span className="min-w-0 flex-1">
        {termino.signo === '+' && <span className="sr-only">más </span>}
        {termino.signo === '−' && <span className="sr-only">menos </span>}
        {termino.nombre}
      </span>
      <Monto valor={termino.valor} className={termino.signo === '−' && termino.valor > 0 ? 'text-destructive' : ''} />
    </>
  )
}
