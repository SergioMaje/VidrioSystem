import { cn, formatCOP } from '@/lib/utils'

/**
 * Un monto en pesos para tablas y tarjetas: cifras de ancho fijo (tabular-nums)
 * para que las columnas se alineen. Con `signo`, marca +/− y pinta los
 * negativos en rojo; el signo es explícito, así que el color no es la única
 * pista. Un sobrante no se pinta de verde: si es grande también es descuadre.
 */
export function Monto({
  valor,
  signo = false,
  className,
}: {
  valor: number
  signo?: boolean
  className?: string
}) {
  const color = signo && Math.round(valor) < 0 ? 'text-destructive' : ''
  return <span className={cn('whitespace-nowrap tabular-nums', color, className)}>{formatCOP(valor, { signo })}</span>
}
