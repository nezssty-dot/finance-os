import { NavLink } from 'react-router-dom'

import { useStore } from '@/lib/store'
import { isMacDesktop, MAC_INSET } from '@/lib/platform'

const NAV = [
  { group: null, items: [
    { to: '/', label: 'Dashboard', icon: 'M3 3h7v9H3V3m11 0h7v5h-7V3m0 9h7v9h-7v-9M3 16h7v5H3v-5' },
  ]},
  { group: 'Día a día', items: [
    { to: '/movimientos', label: 'Movimientos', icon: 'M4 6h16M4 12h16M4 18h10' },
    { to: '/importar', label: 'Importar', icon: 'M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2' },
    { to: '/servicios', label: 'Servicios', icon: 'M12 8v4l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0' },
    { to: '/cuentas', label: 'Cuentas', icon: 'M3 10h18M3 10l9-6 9 6M5 10v10h14V10M9 20v-6h6v6' },
    { to: '/categorias', label: 'Categorías', icon: 'M20.6 13.4L12 4.8V2H4v8h2.8l8.6 8.6a2 2 0 0 0 2.8 0l2.4-2.4a2 2 0 0 0 0-2.8M7 7h.01' },
    { to: '/meses', label: 'Meses', icon: 'M3 4h18v18H3V4m13-2v4M8 2v4M3 10h18' },
    { to: '/timeline', label: 'Timeline', icon: 'M12 2v20M6 6h.01M6 12h.01M6 18h.01M18 6h.01M18 12h.01M18 18h.01' },
  ]},
  { group: 'Mi plata', items: [
    { to: '/patrimonio', label: 'Patrimonio', icon: 'M12 2L2 7l10 5 10-5-10-5M2 17l10 5 10-5M2 12l10 5 10-5' },
    { to: '/inversiones', label: 'Inversiones', icon: 'M3 3v18h18M7 14l4-4 3 3 5-6' },
    { to: '/deudas', label: 'Deudas', icon: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2m1-2h6v4H9V2m-1 10h8M8 16h5' },
  ]},
  { group: 'Planificación', items: [
    { to: '/presupuestos', label: 'Presupuestos', icon: 'M3 3v18h18M7 16V9m5 7V5m5 11v-4' },
    { to: '/objetivos', label: 'Objetivos', icon: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20m0-4a6 6 0 1 0 0-12 6 6 0 0 0 0 12m0-4a2 2 0 1 0 0-4 2 2 0 0 0 0 4' },
    { to: '/forecast', label: 'Forecast', icon: 'M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0' },
    { to: '/insights', label: 'Insights', icon: 'M9 21h6m-5 0v-3m4 3v-3M12 3a6 6 0 0 1 4 10.5V17H8v-3.5A6 6 0 0 1 12 3z' },
  ]},
  { group: 'Sistema', items: [
    { to: '/reportes', label: 'Reportes', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6m0 0v6h6M8 13h8M8 17h5' },
    { to: '/auditoria', label: 'Auditoría', icon: 'M9 12l2 2 4-4M12 3l7 4v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V7l7-4z' },
    { to: '/integraciones', label: 'Integraciones', icon: 'M4 4h6v6H4V4m10 0h6v6h-6V4m-10 10h6v6H4v-6m13 3v-3h3m-3 3h3' },
    { to: '/configuracion', label: 'Configuración', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' },
  ]},
]

export function Sidebar() {
  const { user, logout } = useStore()
  const mac = isMacDesktop()

  return (
    <aside className="w-[230px] shrink-0 bg-bg-2 border-r border-line flex flex-col p-5 h-screen sticky top-0">
      {/* macOS: los botones de la ventana flotan sobre el contenido (titleBarStyle
          "hiddenInset"), así que se les reserva su franja — y de paso se la hace
          arrastrable, porque sin barra de título no hay de dónde agarrar la ventana.
          En Windows, Linux y el navegador esto no se renderiza: ahí sería un hueco
          vacío arriba del logo, sin ningún motivo. */}
      {mac && (
        <div
          style={{ height: MAC_INSET, WebkitAppRegion: 'drag' } as React.CSSProperties}
          className="shrink-0 -mx-5 -mt-5"
        />
      )}
      <div className="flex items-center gap-2.5 px-2 pb-5 font-extrabold text-[17px] tracking-tight">
        <span className="w-[30px] h-[30px] rounded-[9px] bg-gradient-to-br from-gold to-[#a87d1f] flex items-center justify-center text-[#1a1206] font-black text-[17px] shadow-lg shadow-gold/20">F</span>
        Finance OS
      </div>
      <nav className="flex flex-col gap-0.5 flex-1">
        {NAV.map((section, si) => (
          <div key={si} className={section.group ? 'mt-5' : ''}>
            {section.group && (
              <div className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-[0.09em] text-txt-3/70">
                {section.group}
              </div>
            )}
            {section.items.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-btn text-[13px] font-medium transition-colors ${
                    isActive
                      ? 'bg-gold-dim text-gold-2 border border-gold-line'
                      : 'text-txt-2 hover:text-txt hover:bg-panel-2 border border-transparent'
                  }`
                }
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d={n.icon} />
                </svg>
                {n.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="flex items-center gap-2.5 pt-3 border-t border-line">
        <div className="w-8 h-8 rounded-[9px] bg-panel-2 flex items-center justify-center font-bold text-gold-2 text-sm">
          {user?.name?.[0]?.toUpperCase() || '?'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[13px] truncate">{user?.name}</div>
          <button onClick={logout} className="text-[11px] text-txt-3 hover:text-danger transition-colors">
            Cerrar sesión
          </button>
        </div>
      </div>
    </aside>
  )
}
