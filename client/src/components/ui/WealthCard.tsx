import { money } from '@/lib/format'
import { Card } from './Card'

interface Props {
  label: string
  value: number
  sub?: string
  hero?: boolean
  /** When set, the value is shown raw with this suffix instead of as money (e.g. "%"). */
  suffix?: string
  tone?: 'auto' | 'neutral'
  /** Currency for the amount. Defaults to ARS; pass 'USD' etc. for non-peso cards. */
  currency?: string
}

export function WealthCard({ label, value, sub, hero, suffix, tone = 'neutral', currency = 'ARS' }: Props) {
  const negative = value < 0
  return (
    <Card highlight={hero}>
      {/* Contenido centrado y con la misma estructura en todas las tarjetas, para que los
          números queden alineados entre sí en la fila y balanceados dentro de cada card. */}
      <div className="flex flex-col items-center text-center justify-center h-full py-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-txt-3 mb-2 leading-tight">{label}</div>
        <div
          className={`text-xl font-bold font-mono tabular-nums leading-none ${
            tone === 'auto' ? (negative ? 'text-danger' : 'text-success') : ''
          }`}
        >
          {suffix ? `${value}${suffix}` : money(value, currency)}
        </div>
        {sub && <div className="text-[11px] text-txt-3 mt-2 leading-tight">{sub}</div>}
        {!sub && <div className="mt-2 min-h-[14px]" aria-hidden="true" />}
      </div>
    </Card>
  )
}
