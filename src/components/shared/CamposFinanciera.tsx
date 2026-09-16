import { Landmark } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { comisionEstimada } from '@/lib/pagos'
import { formatCOP } from '@/lib/utils'
import type { Financiera } from '@/types/database'

type Props = {
  financieras: Financiera[]
  financieraId: string
  onFinanciera: (id: string) => void
  referencia: string
  onReferencia: (valor: string) => void
  /** Lo que la financiera le financia al cliente: el total de la venta. */
  monto: number
  financiera: Financiera | undefined
}

/**
 * Financiera y código de aprobación de una venta a crédito, con el aviso de que
 * el dinero no entra hoy. Compartido por el cobro de cotizaciones y el mostrador.
 */
export function CamposFinanciera({
  financieras,
  financieraId,
  onFinanciera,
  referencia,
  onReferencia,
  monto,
  financiera,
}: Props) {
  const comision = financiera ? comisionEstimada(monto, financiera.comision_pct) : 0

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Financiera</Label>
        <Select value={financieraId} onValueChange={onFinanciera}>
          <SelectTrigger>
            <SelectValue placeholder="Selecciona Addi, Sistecrédito..." />
          </SelectTrigger>
          <SelectContent>
            {financieras.map((f) => (
              <SelectItem key={f.id} value={f.id}>{f.nombre}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Referencia del crédito (opcional)</Label>
        <Input
          autoComplete="off"
          placeholder="Código de aprobación o N° de crédito"
          value={referencia}
          onChange={(e) => onReferencia(e.target.value)}
        />
      </div>

      <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
        <Landmark className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-0.5">
          <p>
            El cliente queda a paz y salvo, pero el dinero <strong>no entra hoy</strong>: llega al banco
            cuando la financiera desembolse
            {financiera ? ` (plazo pactado: ${financiera.dias_desembolso} días)` : ''}.
          </p>
          {financiera && financiera.comision_pct > 0 && (
            <p>
              Comisión estimada ({financiera.comision_pct}%):{' '}
              <span className="font-mono">{formatCOP(comision)}</span> · recibirías aprox.{' '}
              <span className="font-mono">{formatCOP(monto - comision)}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
