import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { ProtectedRoute } from './ProtectedRoute'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { PageLoader } from '@/components/shared/LoadingSpinner'

import { LoginPage } from '@/pages/auth/LoginPage'
import { RegistroPage } from '@/pages/auth/RegistroPage'
import { DashboardPage } from '@/pages/dashboard/DashboardPage'
import { InventarioPage } from '@/pages/inventario/InventarioPage'
import { ProductosPage } from '@/pages/productos/ProductosPage'
import { CotizacionesPage } from '@/pages/cotizaciones/CotizacionesPage'
import { CotizacionFormPage } from '@/pages/cotizaciones/CotizacionFormPage'
import { CotizacionDetalle } from '@/pages/cotizaciones/CotizacionDetalle'
import { ClientesPage } from '@/pages/clientes/ClientesPage'
import { OrdenesPage } from '@/pages/ordenes/OrdenesPage'
import { OrdenDetalle } from '@/pages/ordenes/OrdenDetalle'
import { ProveedoresPage } from '@/pages/proveedores/ProveedoresPage'
import { ProveedorDetalle } from '@/pages/proveedores/ProveedorDetalle'
import { ReportesPage } from '@/pages/reportes/ReportesPage'
import { CajaPage } from '@/pages/caja/CajaPage'

function RootRedirect() {
  const { user, loading } = useAuth()
  if (loading) return <PageLoader />
  return <Navigate to={user ? '/dashboard' : '/login'} replace />
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/registro" element={<RegistroPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/inventario" element={<InventarioPage />} />
          <Route path="/productos" element={<ProductosPage />} />
          <Route path="/cotizaciones" element={<CotizacionesPage />} />
          <Route path="/cotizaciones/nueva" element={<CotizacionFormPage />} />
          <Route path="/cotizaciones/:id/editar" element={<CotizacionFormPage />} />
          <Route path="/cotizaciones/:id" element={<CotizacionDetalle />} />
          <Route path="/proveedores" element={<ProveedoresPage />} />
          <Route path="/proveedores/:id" element={<ProveedorDetalle />} />
          <Route path="/clientes" element={<ClientesPage />} />
          <Route path="/ordenes" element={<OrdenesPage />} />
          <Route path="/ordenes/:id" element={<OrdenDetalle />} />
          <Route path="/caja" element={<CajaPage />} />
          <Route path="/reportes" element={<ReportesPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
