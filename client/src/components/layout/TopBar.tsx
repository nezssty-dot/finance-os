import { useStore } from '@/lib/store'
import { isMacDesktop, MAC_INSET } from '@/lib/platform'

interface Props { title: string; sub?: string; children?: React.ReactNode }

export function TopBar({ title, sub, children }: Props) {
  const { year, setYear, user } = useStore()
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
        <div className="hidden md:flex items-center gap-2.5 shrink-0">
          <div className="w-9 h-9 rounded-full bg-panel-2 flex items-center justify-center font-bold text-gold-2 text-xs shrink-0">
            {user?.name?.[0]?.toUpperCase() || '?'}
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[13px] font-semibold">{user?.name}</span>
            <span className="text-[10px] font-bold uppercase tracking-wide text-gold-2">Local</span>
          </div>
        </div>
      </div>
    </div>
  )
}
