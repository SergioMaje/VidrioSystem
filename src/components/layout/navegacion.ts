import {
  LayoutDashboard, Package, Boxes, FileText, Users, ClipboardList,
  Truck, BarChart2, DollarSign, Settings,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type ItemNavegacion = {
  to: string
  label: string
  icon: LucideIcon
  /** Letra de la secuencia G + letra que lleva a esta sección. */
  atajo: string
  soloAdmin?: boolean
}

/**
 * Secciones del menú lateral y su atajo. Las letras siguen el nombre cuando
 * se puede; las que chocan toman otra letra de la palabra (proVeedores,
 * cotizaciones = K, cLientes) o la del inglés (Settings).
 */
export const NAV_ITEMS: ItemNavegacion[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, atajo: 'D' },
  { to: '/inventario', label: 'Inventario', icon: Boxes, atajo: 'I' },
  { to: '/proveedores', label: 'Proveedores', icon: Truck, atajo: 'V' },
  { to: '/productos', label: 'Productos', icon: Package, atajo: 'P' },
  { to: '/cotizaciones', label: 'Cotizaciones', icon: FileText, atajo: 'K' },
  { to: '/ordenes', label: 'Órdenes', icon: ClipboardList, atajo: 'O' },
  { to: '/clientes', label: 'Clientes', icon: Users, atajo: 'L' },
  { to: '/caja', label: 'Caja', icon: DollarSign, atajo: 'C' },
  { to: '/reportes', label: 'Reportes', icon: BarChart2, atajo: 'R' },
  { to: '/configuracion', label: 'Configuración', icon: Settings, atajo: 'S', soloAdmin: true },
]

/**
 * A dónde lleva Escape desde una página: el nivel de arriba. Null en los
 * listados, donde Escape no hace nada.
 */
export function rutaPadre(pathname: string): string | null {
  const editar = pathname.match(/^\/cotizaciones\/([^/]+)\/editar$/)
  if (editar) return `/cotizaciones/${editar[1]}`
  const detalle = pathname.match(/^\/(cotizaciones|ordenes|proveedores|clientes)\/[^/]+$/)
  if (detalle) return `/${detalle[1]}`
  return null
}
