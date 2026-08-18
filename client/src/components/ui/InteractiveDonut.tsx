import { useState } from 'react'
import { money } from '@/lib/format'

export interface DonutSlice {
  name: string
  value: number
  color: string
}

interface Props {
  slices: DonutSlice[]
  size?: number
  currency?: string
}

/**
 * Dona interactiva. Al pasar el mouse o tocar una porción (o su ítem en la leyenda), esa
 * categoría se ilumina —se engrosa y el resto se atenúa— y el centro muestra su nombre,
 * porcentaje y monto. Pensada para que se entienda de un vistazo, sin tener que leer números
 * chiquitos. Un clic la fija; otro clic la suelta.
 */
export function InteractiveDonut({ slices, size = 190, currency = 'ARS' }: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const [locked, setLocked] = useState<number | null>(null)
  const active = hover ?? locked

  const valid = slices.filter((s) => Number.isFinite(s.value) && s.value > 0)
  const total = valid.reduce((s, d) => s + d.value, 0)
  if (!valid.length || total <= 0) {
    return (
      <div className="flex items-center justify-center text-txt-3 text-sm" style={{ height: size }}>
        Sin gastos para mostrar
      </div>
    )
  }

  const r = (size - 32) / 2
  const c = size / 2
  const circumference = 2 * Math.PI * r
  const thickness = size * 0.14

  let offset = 0
  const arcs = valid.map((d, i) => {
    const frac = d.value / total
    const len = frac * circumference
    const arc = {
      d,
      i,
      len,
      dashOffset: -offset,
      isActive: active === i,
      dim: active !== null && active !== i,
    }
    offset += len
    return arc
  })

  const centerSlice = active !== null ? valid[active] : null

  const toggle = (i: number) => setLocked((prev) => (prev === i ? null : i))

  return (
    <div className="flex gap-6 items-center flex-wrap">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
          {arcs.map((a) => (
            <circle
              key={a.i}
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke={a.d.color}
              strokeWidth={a.isActive ? thickness + 6 : thickness}
              strokeDasharray={`${a.len} ${circumference - a.len}`}
              strokeDashoffset={a.dashOffset}
              style={{
                opacity: a.dim ? 0.32 : 1,
                cursor: 'pointer',
                transition: 'stroke-width .25s ease, opacity .25s ease',
              }}
              onMouseEnter={() => setHover(a.i)}
              onMouseLeave={() => setHover(null)}
              onClick={() => toggle(a.i)}
            />
          ))}
        </svg>
        {/* Centro perfectamente centrado sobre el punto medio de la dona. Sin "gasto total":
            ese dato ya vive en otra sección. Al no haber selección, solo una guía sutil. */}
        <div
          className="absolute flex flex-col items-center justify-center text-center pointer-events-none"
          style={{ left: 0, top: 0, width: size, height: size, padding: thickness + 8 }}
        >
          {centerSlice ? (
            <>
              <div className="font-extrabold leading-none tabular-nums" style={{ color: centerSlice.color, fontSize: size * 0.19 }}>
                {Math.round((centerSlice.value / total) * 100)}%
              </div>
              <div className="font-semibold text-txt leading-tight mt-1.5" style={{ fontSize: size * 0.075 }}>
                {centerSlice.name}
              </div>
              <div className="text-txt-3 mt-1" style={{ fontSize: size * 0.062 }}>
                {money(centerSlice.value, currency)}
              </div>
            </>
          ) : (
            <div className="text-txt-3 leading-snug" style={{ fontSize: size * 0.066 }}>
              Elegí una<br />categoría
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-w-[160px] flex flex-col gap-1">
        {arcs.map((a) => (
          <button
            key={a.i}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors text-left ${
              a.isActive ? 'bg-panel-2 border-line-2' : 'border-transparent hover:bg-panel-2'
            }`}
            onMouseEnter={() => setHover(a.i)}
            onMouseLeave={() => setHover(null)}
            onClick={() => toggle(a.i)}
          >
            <span
              className="w-3 h-3 rounded shrink-0 transition-transform"
              style={{ background: a.d.color, transform: a.isActive ? 'scale(1.3)' : 'none' }}
            />
            <span className="flex-1 text-sm font-medium">{a.d.name}</span>
            <span className="text-right">
              <span className="block text-[13px] font-bold tabular-nums" style={{ color: a.d.color }}>
                {Math.round((a.d.value / total) * 100)}%
              </span>
              <span className="block text-[10.5px] text-txt-3">{money(a.d.value, currency)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
