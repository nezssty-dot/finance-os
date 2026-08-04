import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { SyncOnOpen } from './SyncOnOpen'
import { ErrorBoundary } from '@/components/ErrorBoundary'

export function AppShell() {
  const location = useLocation()
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto flex flex-col">
        {/* key por ruta: si una pantalla crashea, al cambiar de sección el boundary se
            remonta limpio en vez de quedar mostrando el error. */}
        <ErrorBoundary key={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
      <SyncOnOpen />
    </div>
  )
}
