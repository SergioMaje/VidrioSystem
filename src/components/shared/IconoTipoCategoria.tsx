import { AppWindow, Columns2, DoorClosed, FlipHorizontal2, Package, type LucideProps } from 'lucide-react'
import { TIPO_CATEGORIA_CONFIG, type TipoCategoria } from '@/lib/cotizaciones'

const ICONOS: Record<TipoCategoria, React.ComponentType<LucideProps>> = {
  puerta: DoorClosed,
  ventana: AppWindow,
  division: Columns2,
  espejo: FlipHorizontal2,
  otro: Package,
}

/** Ícono de una categoría del envío, en el color de su tipo. */
export function IconoTipoCategoria({ tipo, ...props }: { tipo: TipoCategoria } & LucideProps) {
  const Icono = ICONOS[tipo]
  return <Icono color={TIPO_CATEGORIA_CONFIG[tipo].color} aria-hidden {...props} />
}
