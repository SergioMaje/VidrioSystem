import { Outlet } from 'react-router-dom'
import { useAtajosGlobales } from '@/hooks/useAtajosGlobales'
import { useAuth } from '@/hooks/useAuth'
import { CambiosSinGuardarProvider } from '@/providers/CambiosSinGuardarProvider'
import { Sidebar } from './Sidebar'
import { Navbar } from './Navbar'
import { CajaPendienteBanner } from './CajaPendienteBanner'
import { AyudaAtajosDialog } from './AyudaAtajosDialog'

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

/** Escucha los atajos de toda la app y monta su ayuda (tecla ?). */
function AtajosGlobales() {
  const { usuario } = useAuth()
  const { ayudaAbierta, setAyudaAbierta } = useAtajosGlobales(usuario?.rol === 'admin')
  return <AyudaAtajosDialog open={ayudaAbierta} onOpenChange={setAyudaAbierta} />
}
