import {
  LayoutDashboard, Package, Boxes, FileText, Users, ClipboardList,
  Truck, BarChart2, DollarSign, Settings,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type ItemNavegacion = {
  to: string
  label: string
  icon: LucideIcon
  soloAdmin?: boolean
}

/**
 * Secciones del menú lateral. Alt+↑/↓ las recorre en este mismo orden.
 */
export const NAV_ITEMS: ItemNavegacion[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/inventario', label: 'Inventario', icon: Boxes },
  { to: '/proveedores', label: 'Proveedores', icon: Truck },
  { to: '/productos', label: 'Productos', icon: Package },
  { to: '/cotizaciones', label: 'Cotizaciones', icon: FileText },
  { to: '/ordenes', label: 'Órdenes', icon: ClipboardList },
  { to: '/clientes', label: 'Clientes', icon: Users },
  { to: '/caja', label: 'Caja', icon: DollarSign },
  { to: '/reportes', label: 'Reportes', icon: BarChart2 },
  { to: '/configuracion', label: 'Configuración', icon: Settings, soloAdmin: true },
]

/**
 * A dónde lleva Escape desde una página que no marca su botón `data-volver`:
 * el nivel de arriba. Null en los listados, donde Escape no hace nada.
 */
export function rutaPadre(pathname: string): string | null {
  const editar = pathname.match(/^\/cotizaciones\/([^/]+)\/editar$/)
  if (editar) return `/cotizaciones/${editar[1]}`
  const detalle = pathname.match(/^\/(cotizaciones|ordenes|proveedores|clientes)\/[^/]+$/)
  if (detalle) return `/${detalle[1]}`
  return null
}
