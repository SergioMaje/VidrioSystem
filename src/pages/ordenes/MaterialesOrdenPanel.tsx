import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/shared/LoadingSpinner'
import { useOrdenMateriales } from '@/hooks/useOrdenMateriales'
import { ORIGEN_MATERIAL_LABELS } from '@/lib/materiales'
import { formatCOP } from '@/lib/utils'
import { AsignarMaterialDialog } from './AsignarMaterialDialog'
import { CapturarCostoDialog } from './CapturarCostoDialog'
import type { OrdenMaterial, OrdenTrabajo } from '@/types/database'

const ESTADO_LABELS: Record<OrdenMaterial['estado'], string> = {
  pendiente: 'Sin asignar',
  asignado: 'Asignado',
  consumido: 'Descontado',
}

interface MaterialesOrdenPanelProps {
  ordenId: string
  estado: OrdenTrabajo['estado']
}

export function MaterialesOrdenPanel({ ordenId, estado }: MaterialesOrdenPanelProps) {
  const { data: materiales, isLoading } = useOrdenMateriales(ordenId)
  const [asignarMaterial, setAsignarMaterial] = useState<OrdenMaterial | null>(null)
  const [costoMaterial, setCostoMaterial] = useState<OrdenMaterial | null>(null)

  if (isLoading) return <LoadingSpinner className="py-8" />
  if (!materiales || materiales.length === 0) return null

  const puedeEditar = estado === 'pendiente' || estado === 'en_produccion'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Materiales</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {materiales.map((m) => {
          const faltaCosto = m.origen === 'sobre_pedido' && m.costo_unitario_real == null && m.estado !== 'consumido'
          return (
            <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <div>
                <p className="font-medium">{m.item_requerido?.nombre ?? m.item?.nombre ?? '—'}</p>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variant="outline" className="text-xs">{ORIGEN_MATERIAL_LABELS[m.origen]}</Badge>
                  {m.item && m.item.id !== m.item_requerido_id && <span>usado: {m.item.nombre}</span>}
                  <span>
                    {m.cantidad_asignada > 0 ? m.cantidad_asignada : m.cantidad_requerida} {m.item_requerido?.unidad_medida?.simbolo ?? ''}
                  </span>
                  <span>·</span>
                  <span>{ESTADO_LABELS[m.estado]}</span>
                  {m.costo_unitario_real != null && <span>· {formatCOP(m.costo_unitario_real)}</span>}
                </div>
                {faltaCosto && (
                  <p className="mt-1 text-xs font-medium text-amber-700">Falta registrar el costo</p>
                )}
              </div>
              {puedeEditar && m.estado !== 'consumido' && (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setAsignarMaterial(m)}>
                    Elegir material
                  </Button>
                  {m.origen === 'sobre_pedido' && (
                    <Button variant="outline" size="sm" onClick={() => setCostoMaterial(m)}>
                      Registrar costo
                    </Button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </CardContent>

      {asignarMaterial && (
        <AsignarMaterialDialog
          material={asignarMaterial}
          open={!!asignarMaterial}
          onOpenChange={(open) => { if (!open) setAsignarMaterial(null) }}
        />
      )}
      {costoMaterial && (
        <CapturarCostoDialog
          material={costoMaterial}
          open={!!costoMaterial}
          onOpenChange={(open) => { if (!open) setCostoMaterial(null) }}
        />
      )}
    </Card>
  )
}
