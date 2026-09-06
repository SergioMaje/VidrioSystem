import { Badge } from '@/components/ui/badge'
import type { ClaseInventario } from '@/types/database'

interface StockBadgeProps {
  stockActual: number
  stockMinimo: number
  clase?: ClaseInventario
}

export function StockBadge({ stockActual, stockMinimo, clase }: StockBadgeProps) {
  if (stockActual === 0) {
    // Un sobre pedido nace y vive en 0 hasta que se elige en una orden: no es una alarma.
    if (clase === 'sobre_pedido') {
      return <Badge variant="outline">Sobre pedido</Badge>
    }
    return <Badge variant="destructive">Sin stock</Badge>
  }
  if (stockActual <= stockMinimo) {
    return <Badge variant="warning">Stock bajo</Badge>
  }
  return <Badge variant="success">OK</Badge>
}
