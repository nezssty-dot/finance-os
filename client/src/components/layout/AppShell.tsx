import { Outlet, useLocation } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { Sidebar } from './Sidebar'
import { SyncOnOpen } from './SyncOnOpen'
import { ErrorBoundary } from '@/components/ErrorBoundary'

export function AppShell() {
  const location = useLocation()
  const reduced = useReducedMotion()

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto flex flex-col">
        {/* Transición entre pantallas: un fade + subida corta, la misma en Windows y
            Mac porque es JS/CSS puro (Chromium), no algo que dependa del sistema
            operativo. Se apaga sola si el usuario tiene "reducir movimiento" activado. */}
        <motion.div
          key={location.pathname}
          initial={reduced ? undefined : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="flex-1 flex flex-col"
        >
          {/* key por ruta: si una pantalla crashea, al cambiar de sección el boundary
              se remonta limpio en vez de quedar mostrando el error. Ancho máximo acá
              (no en cada página): en el Figma el contenido tiene una proporción fija,
              no ocupa todo el monitor — en una pantalla grande el contenido queda
              centrado con esa misma proporción en vez de estirarse borde a borde. */}
          <ErrorBoundary key={location.pathname}>
            <div className="w-full max-w-[1440px] mx-auto flex-1 flex flex-col">
              <Outlet />
            </div>
          </ErrorBoundary>
        </motion.div>
      </main>
      <SyncOnOpen />
    </div>
  )
}
