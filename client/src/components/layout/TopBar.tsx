import { useStore } from '@/lib/store'
import { isMacDesktop, MAC_INSET } from '@/lib/platform'

interface Props { title: string; sub?: string }

export function TopBar({ title, sub }: Props) {
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
      <div className="flex items-center gap-4 bg-panel rounded-card px-7 py-5">
        <div>
          <h1 className="text-h1 tracking-tight">{title}</h1>
          {sub && <p className="text-[12.5px] text-txt-3 mt-0.5">{sub}</p>}
        </div>
        {/* El hueco del medio es la zona de arrastre: sin barra de título, es lo único
            que permite mover la ventana. Va acá y no en toda la barra a propósito —
            una región `drag` se traga los clics, y lo de la derecha tiene que responder. */}
        <div
          className="flex-1 self-stretch"
          style={mac ? ({ WebkitAppRegion: 'drag' } as React.CSSProperties) : undefined}
        />
        <div className="flex items-center bg-panel-2 rounded-full overflow-hidden">
          <button onClick={() => setYear(year - 1)} className="w-8 h-9 text-txt-2 hover:text-txt text-sm">‹</button>
          <span className="px-2 font-semibold font-mono text-sm min-w-[46px] text-center">{year}</span>
          <button onClick={() => setYear(year + 1)} className="w-8 h-9 text-txt-2 hover:text-txt text-sm">›</button>
        </div>
        <div className="hidden sm:flex items-center gap-2.5">
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
