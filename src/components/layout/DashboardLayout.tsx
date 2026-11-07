import { Outlet } from 'react-router-dom'
import { Kbd } from '@/components/shared/Kbd'
import { useAtajosGlobales } from '@/hooks/useAtajosGlobales'
import { useAuth } from '@/hooks/useAuth'
import { CambiosSinGuardarProvider } from '@/providers/CambiosSinGuardarProvider'
import { Sidebar } from './Sidebar'
import { Navbar } from './Navbar'
import { CajaPendienteBanner } from './CajaPendienteBanner'

export function DashboardLayout() {
  return (
    <CambiosSinGuardarProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Navbar />
          <CajaPendienteBanner />
          <main className="flex-1 overflow-y-auto p-4 lg:p-6">
            <Outlet />
          </main>
        </div>
      </div>
      <AtajosGlobales />
    </CambiosSinGuardarProvider>
  )
}

/** Escucha los atajos y muestra "G…" mientras espera la segunda letra. */
function AtajosGlobales() {
  const { usuario } = useAuth()
  const esperandoLetra = useAtajosGlobales(usuario?.rol === 'admin')
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50">
      {esperandoLetra && (
        <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground shadow-lg">
          <Kbd className="text-foreground">G</Kbd>
          <span>…elige una sección</span>
        </div>
      )}
    </div>
  )
}
