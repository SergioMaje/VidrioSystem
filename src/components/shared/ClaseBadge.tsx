import { Badge } from '@/components/ui/badge'
import { CLASE_INVENTARIO_LABELS, CLASE_INVENTARIO_VARIANTS } from '@/lib/materiales'
import type { ClaseInventario } from '@/types/database'

interface ClaseBadgeProps {
  clase: ClaseInventario
}

export function ClaseBadge({ clase }: ClaseBadgeProps) {
  return <Badge variant={CLASE_INVENTARIO_VARIANTS[clase]}>{CLASE_INVENTARIO_LABELS[clase]}</Badge>
}
