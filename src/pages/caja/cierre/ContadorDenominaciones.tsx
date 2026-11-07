import { Input } from '@/components/ui/input'
import { DENOMINACIONES_COP, totalDenominaciones, type Cantidades } from '@/lib/caja'
import { formatCOP, soloDigitos } from '@/lib/utils'
import { Monto } from './Monto'

const TIPO: Record<(typeof DENOMINACIONES_COP)[number]['tipo'], string> = {
  billete: 'Billete',
  moneda: 'Moneda',
  ambos: 'Billete o moneda',
}

/**
 * Cuántos billetes y monedas hay de cada valor; el total se calcula solo.
 * Controlado: el padre guarda las cantidades y usa el total como conteo.
 */
export function ContadorDenominaciones({
  cantidades,
  onChange,
}: {
  cantidades: Cantidades
  onChange: (c: Cantidades) => void
}) {
  const total = totalDenominaciones(cantidades)
  return (
    <div className="min-w-0 space-y-2">
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {DENOMINACIONES_COP.map((d) => {
          const cantidad = cantidades[d.valor] ?? ''
          const id = `denominacion-${d.valor}`
          return (
            <div key={d.valor} className="flex items-center gap-2">
              <label htmlFor={id} className="min-w-0 flex-1 text-sm">
                <span className="font-medium tabular-nums">{formatCOP(d.valor)}</span>
                <span className="block text-xs text-muted-foreground">{TIPO[d.tipo]}</span>
              </label>
              <span className="text-xs text-muted-foreground" aria-hidden>×</span>
              <Input
                id={id}
                inputMode="numeric"
                autoComplete="off"
                placeholder="0"
                value={cantidad}
                onChange={(e) => onChange({ ...cantidades, [d.valor]: soloDigitos(e.target.value) })}
                className="h-9 w-16 text-right tabular-nums"
              />
              <Monto
                valor={d.valor * Number(cantidad || 0)}
                className={`w-28 text-right text-sm ${cantidad ? '' : 'text-muted-foreground'}`}
              />
            </div>
          )
        })}
      </div>
      <div className="flex items-baseline justify-between rounded-md bg-muted/50 px-3 py-2 font-semibold">
        <span>Total contado</span>
        <Monto valor={total} className="text-lg" />
      </div>
    </div>
  )
}
