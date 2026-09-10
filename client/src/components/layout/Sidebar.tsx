import { useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, Receipt, Calendar,
  PieChart, Target, Sparkles,
  FileText, MoreHorizontal,
} from 'lucide-react'

import { useStore } from '@/lib/store'
import { isMacDesktop, MAC_INSET } from '@/lib/platform'
import { FinanceLogo } from '@/components/FinanceLogo'

// Ver NOTAS-CONSOLIDACION.md: 20 pantallas eran demasiadas para un riel de solo
// íconos (y en Windows, con menos alto disponible, las últimas se cortaban). Estas
// son las secciones "madre" que quedan con ícono propio; Timeline, Categorías,
// Auditoría y Forecast viven dentro de Más, y Cuentas/Servicios/Inversiones/Deudas
// también se sumaron ahí — con un link directo desde cada una, no un ícono propio.
const NAV = [
  { group: null, items: [
    { to: '/', label: 'Dashboard', Icon: LayoutDashboard },
  ]},
  { group: 'Día a día', items: [
    { to: '/movimientos', label: 'Movimientos', Icon: Receipt },
    { to: '/meses', label: 'Meses', Icon: Calendar },
  ]},
  { group: 'Mi plata', items: [
    { to: '/patrimonio', label: 'Patrimonio', Icon: PieChart },
  ]},
  { group: 'Planificación', items: [
    { to: '/presupuestos', label: 'Presupuestos', Icon: Target },
    { to: '/insights', label: 'Insights', Icon: Sparkles },
  ]},
  { group: 'Sistema', items: [
    // Configuración ya no tiene ícono acá — vive arriba, en la píldora del TopBar
    // (junto a Notificaciones), así que sacarla de acá no la deja inaccesible.
    { to: '/reportes', label: 'Reportes', Icon: FileText },
  ]},
  { group: 'Más', items: [
    // Un solo ícono acá adentro de "Más" en vez de uno por función — Timeline,
    // Importar, Categorías, Auditoría y Forecast viven todas en /mas para no volver
    // a inflar el riel con íconos sueltos.
    { to: '/mas', label: 'Más', Icon: MoreHorizontal },
  ]},
]

// Tooltip en portal: vive en <body>, no adentro del riel. Así el riel puede scrollear
// (overflow-y-auto) en una ventana baja sin que eso le recorte el globito — en CSS, un
// contenedor con overflow-y no-visible fuerza al eje X a comportarse como 'auto' TAMBIÉN,
// así que cualquier tooltip que dependiera de "desbordar hacia la derecha" del propio
// riel desaparecía. Portal + posición calculada en cada hover lo esquiva del todo.
function useTooltip() {
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null)
  const show = (e: React.MouseEvent<HTMLElement>, label: string) => {
    const r = e.currentTarget.getBoundingClientRect()
    setTip({ label, top: r.top + r.height / 2, left: r.right + 10 })
  }
  const hide = () => setTip(null)
  return { tip, show, hide }
}

export function Sidebar() {
  const { user } = useStore()
  const mac = isMacDesktop()
  const location = useLocation()
  const { tip, show, hide } = useTooltip()

  // Las pantallas que se juntaron adentro de otra (ver comentario de NAV arriba) no
  // tienen ícono propio, pero el riel tiene que seguir marcando "estás acá" en la
  // página madre — si no, al entrar a /timeline no se prende ningún ícono y se pierde
  // la orientación.
  const parentOf: Record<string, string> = {
    '/timeline': '/mas',
    '/categorias': '/mas', '/auditoria': '/mas',
    '/forecast': '/mas',
    '/cuentas': '/mas', '/servicios': '/mas',
    '/inversiones': '/mas', '/deudas': '/mas',
    '/objetivos': '/mas',
    // Importar ahora se entra desde un botón en Movimientos, no desde Más.
    '/importar': '/movimientos',
  }
  const effectivePath = parentOf[location.pathname] ?? location.pathname

  // Ítem activo — mueve el "pill" verde con un resorte (spring), la sensación
  // "increíble" al cambiar de sección. Corre igual en Windows y Mac: es Chromium/JS
  // puro, no depende de nada del sistema operativo.
  const activeTo = NAV.flatMap((s) => s.items).find((n) =>
    n.to === '/' ? effectivePath === '/' : effectivePath.startsWith(n.to)
  )?.to

  return (
    <aside className="w-[92px] shrink-0 h-screen sticky top-0 p-4 flex flex-col">
      {mac && (
        <div
          style={{ height: MAC_INSET, WebkitAppRegion: 'drag' } as React.CSSProperties}
          className="shrink-0"
        />
      )}
      <div className="flex-1 min-h-0 bg-chrome rounded-card flex flex-col items-center py-4 gap-0.5 overflow-y-auto overscroll-contain">
        <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center shrink-0 mb-3">
          <FinanceLogo size={22} />
        </div>

        <nav className="flex flex-col items-center gap-0.5 flex-1">
          {NAV.map((section, si) => (
            <div key={si} className="flex flex-col items-center gap-0.5">
              {section.items.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.to === '/'}
                  onMouseEnter={(e) => show(e, n.label)}
                  onMouseLeave={hide}
                  className="group relative w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                >
                  {n.to === activeTo && (
                    <motion.span
                      layoutId="sidebar-active-pill"
                      className="absolute inset-0 rounded-full bg-accent"
                      transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                    />
                  )}
                  <n.Icon
                    size={16}
                    strokeWidth={2}
                    className={`relative z-10 transition-transform duration-150 group-hover:scale-110 ${
                      n.to === activeTo ? 'text-black' : 'text-chrome-txt-2 group-hover:text-chrome-txt'
                    }`}
                  />
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div
          className="w-8 h-8 rounded-full bg-chrome-2 flex items-center justify-center font-bold text-accent text-xs shrink-0 mt-2"
          title={user?.name}
        >
          {user?.name?.[0]?.toUpperCase() || '?'}
        </div>
      </div>

      {createPortal(
        <AnimatePresence>
          {tip && (
            <motion.span
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -4 }}
              transition={{ duration: 0.12 }}
              className="fixed px-2.5 py-1 rounded-md bg-chrome-2 text-chrome-txt text-[12px] font-medium whitespace-nowrap z-[999] pointer-events-none"
              style={{ top: tip.top, left: tip.left, transform: 'translateY(-50%)' }}
            >
              {tip.label}
            </motion.span>
          )}
        </AnimatePresence>,
        document.body
      )}
    </aside>
  )
}
