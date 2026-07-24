import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useStore } from '@/lib/store'
import { AppShell } from '@/components/layout/AppShell'
import { Dashboard } from '@/pages/Dashboard'
import { Meses } from '@/pages/Meses'
import { Movimientos } from '@/pages/Movimientos'
import { Importar } from '@/pages/Importar'
import { Servicios } from '@/pages/Servicios'
import { Cuentas } from '@/pages/Cuentas'
import { Categorias } from '@/pages/Categorias'
import { Patrimonio } from '@/pages/Patrimonio'
import { Inversiones } from '@/pages/Inversiones'
import { Deudas } from '@/pages/Deudas'
import { Presupuestos } from '@/pages/Presupuestos'
import { Objetivos } from '@/pages/Objetivos'
import { Reportes } from '@/pages/Reportes'
import { Auditoria } from '@/pages/Auditoria'
import { Timeline } from '@/pages/Timeline'
import { Forecast } from '@/pages/Forecast'
import { Integraciones } from '@/pages/Integraciones'
import { Insights } from '@/pages/Insights'
import { Configuracion } from '@/pages/Configuracion'
import { Onboarding } from '@/pages/Onboarding'
import { Login } from '@/pages/Login'
import { Register } from '@/pages/Register'
import { Spinner } from '@/components/ui'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useStore()
  if (loading) return <div className="min-h-screen flex items-center justify-center"><Spinner /></div>
  if (!user) return <Navigate to="/login" replace />
  // Never ran the welcome wizard → send them there rather than to an empty dashboard
  // with no accounts, no movements and nothing to explain what to do next.
  if (!user.onboardedAt) return <Navigate to="/bienvenida" replace />
  return <>{children}</>
}

function OnboardingRoute() {
  const { user, loading } = useStore()
  if (loading) return <div className="min-h-screen flex items-center justify-center"><Spinner /></div>
  if (!user) return <Navigate to="/login" replace />
  // Already onboarded: no reason to see the wizard again.
  if (user.onboardedAt) return <Navigate to="/" replace />
  return <Onboarding />
}

export function App() {
  const { checkAuth, loading } = useStore()

  useEffect(() => { checkAuth() }, [])

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-bg"><Spinner /></div>

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/bienvenida" element={<OnboardingRoute />} />
      <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="meses" element={<Meses />} />
        <Route path="movimientos" element={<Movimientos />} />
        <Route path="importar" element={<Importar />} />
        <Route path="servicios" element={<Servicios />} />
        <Route path="cuentas" element={<Cuentas />} />
        <Route path="categorias" element={<Categorias />} />
        <Route path="patrimonio" element={<Patrimonio />} />
        <Route path="inversiones" element={<Inversiones />} />
        <Route path="deudas" element={<Deudas />} />
        <Route path="presupuestos" element={<Presupuestos />} />
        <Route path="objetivos" element={<Objetivos />} />
        <Route path="reportes" element={<Reportes />} />
        <Route path="auditoria" element={<Auditoria />} />
        <Route path="timeline" element={<Timeline />} />
        <Route path="forecast" element={<Forecast />} />
        <Route path="insights" element={<Insights />} />
        <Route path="integraciones" element={<Integraciones />} />
        <Route path="configuracion" element={<Configuracion />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
