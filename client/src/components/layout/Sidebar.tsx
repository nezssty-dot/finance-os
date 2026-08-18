import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Receipt, Upload, Repeat, Landmark, Tag, Calendar, Activity,
  PieChart, TrendingUp, CreditCard, Target, Flag, LineChart, Sparkles, FileText,
  ShieldCheck, Settings,
} from 'lucide-react'

import { useStore } from '@/lib/store'
import { isMacDesktop, MAC_INSET } from '@/lib/platform'
import { FinanceLogo } from '@/components/FinanceLogo'

const NAV = [
  { group: null, items: [
    { to: '/', label: 'Dashboard', Icon: LayoutDashboard },
  ]},
  { group: 'Día a día', items: [
    { to: '/movimientos', label: 'Movimientos', Icon: Receipt },
    { to: '/importar', label: 'Importar', Icon: Upload },
    { to: '/servicios', label: 'Servicios', Icon: Repeat },
    { to: '/cuentas', label: 'Cuentas', Icon: Landmark },
    { to: '/categorias', label: 'Categorías', Icon: Tag },
    { to: '/meses', label: 'Meses', Icon: Calendar },
    { to: '/timeline', label: 'Timeline', Icon: Activity },
  ]},
  { group: 'Mi plata', items: [
    { to: '/patrimonio', label: 'Patrimonio', Icon: PieChart },
    { to: '/inversiones', label: 'Inversiones', Icon: TrendingUp },
    { to: '/deudas', label: 'Deudas', Icon: CreditCard },
  ]},
  { group: 'Planificación', items: [
    { to: '/presupuestos', label: 'Presupuestos', Icon: Target },
    { to: '/objetivos', label: 'Objetivos', Icon: Flag },
    { to: '/forecast', label: 'Forecast', Icon: LineChart },
    { to: '/insights', label: 'Insights', Icon: Sparkles },
  ]},
  { group: 'Sistema', items: [
    { to: '/reportes', label: 'Reportes', Icon: FileText },
    { to: '/auditoria', label: 'Auditoría', Icon: ShieldCheck },
    { to: '/configuracion', label: 'Configuración', Icon: Settings },
  ]},
]

// Riel angosto solo-íconos, en una pill negra separada del borde de la ventana — la
// estética del sidebar de Figma. Con 19 pantallas (contra las 6 del kit original) cada
// ícono necesita su tooltip al hover para no perder la orientación, y la columna scrollea
// si la ventana queda baja en vez de recortar los últimos íconos.
export function Sidebar() {
  const { user } = useStore()
  const mac = isMacDesktop()

  return (
    <aside className="w-[92px] shrink-0 h-screen sticky top-0 p-4 flex flex-col">
      {mac && (
        <div
          style={{ height: MAC_INSET, WebkitAppRegion: 'drag' } as React.CSSProperties}
          className="shrink-0"
        />
      )}
      {/* Sin overflow-y-auto a propósito: en CSS, un eje de overflow no-visible fuerza al
          otro eje a comportarse como 'auto' también (aunque diga overflow-x-visible), así
          que un scroll acá recortaría el tooltip que se abre hacia afuera con left-full.
          Por eso los íconos van compactos: para que 19 entren sin necesitar scroll. */}
      <div className="flex-1 min-h-0 bg-panel rounded-card flex flex-col items-center py-4 gap-0.5">
        <div className="w-10 h-10 rounded-full bg-[#0f1420] flex items-center justify-center shrink-0 mb-3 shadow-lg shadow-[#3d7bfc]/20">
          <FinanceLogo size={22} />
        </div>

        <nav className="flex flex-col items-center gap-0.5 flex-1">
          {NAV.map((section, si) => (
            <div key={si} className="flex flex-col items-center gap-0.5">
              {section.group && <div className="w-6 h-px bg-line my-1.5" />}
              {section.items.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.to === '/'}
                  className={({ isActive }) =>
                    `group relative w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                      isActive ? 'bg-accent text-black' : 'text-txt-2 hover:text-txt hover:bg-panel-2'
                    }`
                  }
                >
                  <n.Icon size={16} strokeWidth={2} />
                  <span className="pointer-events-none absolute left-full ml-3 px-2.5 py-1 rounded-md bg-panel-2 text-txt text-[12px] font-medium whitespace-nowrap opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 z-50">
                    {n.label}
                  </span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div
          className="w-8 h-8 rounded-full bg-panel-2 flex items-center justify-center font-bold text-gold-2 text-xs shrink-0 mt-2"
          title={user?.name}
        >
          {user?.name?.[0]?.toUpperCase() || '?'}
        </div>
      </div>
    </aside>
  )
}
