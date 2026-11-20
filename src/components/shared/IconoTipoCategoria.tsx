import { AppWindow, Columns2, DoorClosed, FlipHorizontal2, Package, Tag, type LucideProps } from 'lucide-react'
import { estiloCategoria, type CategoriaConTipo, type TipoCategoria } from '@/lib/cotizaciones'

const ICONOS: Record<TipoCategoria, React.ComponentType<LucideProps>> = {
  puerta: DoorClosed,
  ventana: AppWindow,
  division: Columns2,
  espejo: FlipHorizontal2,
  otro: Package,
}

/**
 * Ícono de una categoría del envío, en el color de su tipo. Un tipo propio de
 * la vidriería usa una etiqueta en su color.
 */
export function IconoTipoCategoria({ categoria, ...props }: { categoria: CategoriaConTipo } & LucideProps) {
  const estilo = estiloCategoria(categoria)
  const Icono = estilo.personalizado ? Tag : ICONOS[categoria.tipo]
  return <Icono color={estilo.color} aria-hidden {...props} />
}
