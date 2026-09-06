import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Settings, Bell } from 'lucide-react'
import { useStore } from '@/lib/store'
import { isMacDesktop, MAC_INSET } from '@/lib/platform'

interface Props { title: string; sub?: string; children?: React.ReactNode }

/**
 * Configuración + Notificaciones, en una píldora como la del año — reemplaza el bloque
 * de usuario/"LOCAL" que había antes ahí. Notificaciones todavía no tiene nada atrás
 * (no hay backend de eventos): el popover es un placeholder a propósito, para no dejar
 * un ícono que no hace nada al clickearlo mientras se decide qué va a avisar.
 */
function TopBarActions() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="flex items-center gap-1 bg-panel-2 rounded-full p-1 shrink-0">
      <Link
        to="/configuracion"
        className="w-8 h-9 rounded-full flex items-center justify-center text-txt-2 hover:text-txt hover:bg-panel transition-colors"
        title="Configuración"
      >
        <Settings size={16} />
      </Link>
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((o) => !o)}
          className="w-8 h-9 rounded-full flex items-center justify-center text-txt-2 hover:text-txt hover:bg-panel transition-colors"
          title="Notificaciones"
        >
          <Bell size={16} />
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-2 w-64 bg-panel border border-line rounded-[14px] shadow-lg p-4 z-20">
            <p className="text-[13px] font-semibold mb-1">Notificaciones</p>
            <p className="text-[12.5px] text-txt-3 leading-relaxed">Todavía no hay nada acá — la vamos a sumar más adelante.</p>
          </div>
        )}
      </div>
    </div>
  )
}

export function TopBar({ title, sub, children }: Props) {
  const { year, setYear } = useStore()
  const mac = isMacDesktop()

  return (
    <div
      className="sticky top-0 z-30 px-4 pt-4"
      // En macOS el sidebar reserva MAC_INSET arriba para el semáforo de la ventana.
      // Si el TopBar no hace lo mismo, el título queda 32 px más alto que el logo y
      // el encabezado se ve torcido. En el resto de las plataformas manda el padding normal.
      style={mac ? { paddingTop: MAC_INSET + 16 } : undefined}
    >
      {/* flex-wrap: en una ventana angosta (mitad de pantalla, o Windows con la barra
          de tareas achicando el alto disponible) el contenido de la derecha pasa a una
          segunda línea en vez de recortarse o empujar el título afuera del cuadro. */}
      <div className="flex flex-wrap items-center gap-3 bg-panel rounded-card px-5 sm:px-7 py-4 sm:py-5">
        <div className="min-w-0">
          <h1 className="text-h1 tracking-tight truncate">{title}</h1>
          {sub && <p className="text-[12.5px] text-txt-3 mt-0.5 truncate">{sub}</p>}
        </div>
        {/* El hueco del medio es la zona de arrastre: sin barra de título, es lo único
            que permite mover la ventana. Va acá y no en toda la barra a propósito —
            una región `drag` se traga los clics, y lo de la derecha tiene que responder. */}
        <div
          className="flex-1 self-stretch min-w-[8px]"
          style={mac ? ({ WebkitAppRegion: 'drag' } as React.CSSProperties) : undefined}
        />
        {children && <div className="flex items-center gap-1.5">{children}</div>}
        <div className="flex items-center bg-panel-2 rounded-full overflow-hidden shrink-0">
          <button onClick={() => setYear(year - 1)} className="w-8 h-9 text-txt-2 hover:text-txt text-sm transition-colors">‹</button>
          <span className="px-2 font-semibold font-mono text-sm min-w-[46px] text-center tabular-nums">{year}</span>
          <button onClick={() => setYear(year + 1)} className="w-8 h-9 text-txt-2 hover:text-txt text-sm transition-colors">›</button>
        </div>
        <TopBarActions />
      </div>
    </div>
  )
}
