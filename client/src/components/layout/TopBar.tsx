import { useStore } from '@/lib/store'
import { isMacDesktop, MAC_INSET } from '@/lib/platform'

interface Props { title: string; sub?: string }

export function TopBar({ title, sub }: Props) {
  const { year, setYear } = useStore()
  const mac = isMacDesktop()

  return (
    <div
      className="sticky top-0 z-30 flex items-center gap-4 px-7 py-4 bg-bg/80 backdrop-blur-xl border-b border-line"
      // En macOS el sidebar reserva MAC_INSET arriba para el semáforo de la ventana.
      // Si el TopBar no hace lo mismo, el título queda 32 px más alto que el logo y
      // el encabezado se ve torcido. En el resto de las plataformas manda `py-4`.
      style={mac ? { paddingTop: MAC_INSET + 16 } : undefined}
    >
      <div>
        <h1 className="text-[19px] font-bold tracking-tight">{title}</h1>
        {sub && <p className="text-[12.5px] text-txt-3 mt-0.5">{sub}</p>}
      </div>
      {/* El hueco del medio es la zona de arrastre: sin barra de título, es lo único
          que permite mover la ventana. Va acá y no en toda la barra a propósito —
          una región `drag` se traga los clics, y el selector de año está a la derecha. */}
      <div
        className="flex-1 self-stretch"
        style={mac ? ({ WebkitAppRegion: 'drag' } as React.CSSProperties) : undefined}
      />
      <div className="flex items-center bg-panel border border-line rounded-[9px] overflow-hidden">
        <button onClick={() => setYear(year - 1)} className="w-7 h-[30px] text-txt-2 hover:bg-panel-2 hover:text-txt text-sm">‹</button>
        <span className="px-2.5 font-semibold font-mono text-sm min-w-[46px] text-center">{year}</span>
        <button onClick={() => setYear(year + 1)} className="w-7 h-[30px] text-txt-2 hover:bg-panel-2 hover:text-txt text-sm">›</button>
      </div>
    </div>
  )
}
