import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { LogOut, Menu, X, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Kbd } from '@/components/shared/Kbd'
import { ATAJO_ALT } from '@/hooks/useAtajoConfirmar'
import { useAuth } from '@/hooks/useAuth'
import { cn } from '@/lib/utils'
import { NAV_ITEMS } from './navegacion'

function SidebarContent({ onClose }: { onClose?: () => void }) {
  const { usuario, signOut } = useAuth()
  const location = useLocation()

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-5">
        <div className="flex items-center gap-2">
          <Layers className="h-6 w-6 text-primary" />
          <span className="text-lg font-bold">VidrioSystem</span>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose} className="lg:hidden">
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>

      <Separator />

      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV_ITEMS
          .filter(({ soloAdmin }) => !soloAdmin || usuario?.rol === 'admin')
          .map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onClose}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
                isActive || location.pathname.startsWith(to)
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Pista de los atajos; solo en escritorio, donde hay teclado. */}
      <p className="hidden items-center gap-1 px-4 pb-3 text-xs text-muted-foreground lg:flex">
        <Kbd>{ATAJO_ALT}</Kbd><Kbd>↑↓</Kbd>
        <span className="mr-2">secciones</span>
        <Kbd>?</Kbd>
        <span>atajos</span>
      </p>

      <Separator />

      <div className="px-4 py-4">
        {usuario && (
          <div className="mb-3">
            <p className="text-sm font-medium">{usuario.nombre} {usuario.apellido}</p>
            <p className="text-xs capitalize text-muted-foreground">{usuario.rol}</p>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground"
          onClick={signOut}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Cerrar sesión
        </Button>
      </div>
    </div>
  )
}

export function Sidebar() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="fixed left-4 top-4 z-50 lg:hidden"
        onClick={() => setMobileOpen(true)}
      >
        <Menu className="h-5 w-5" />
      </Button>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-64 border-r bg-background transition-transform lg:static lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <SidebarContent onClose={() => setMobileOpen(false)} />
      </aside>
    </>
  )
}
