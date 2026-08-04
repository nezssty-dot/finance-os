import { money } from '@/lib/format'
import { Card } from './Card'

type Accent = 'green' | 'blue' | 'violet' | 'danger' | 'warning' | 'neutral'

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
  /** Color de acento de la tarjeta (un puntito + el número toma ese color). */
  accent?: Accent
}

// Cada acento mapea a la variable de color del tema (funciona en claro y oscuro).
const ACCENT_VAR: Record<Accent, string> = {
  green: 'var(--c-accent)',
  blue: 'var(--c-info)',
  violet: 'var(--c-violet)',
  danger: 'var(--c-danger)',
  warning: 'var(--c-warning)',
  neutral: 'var(--c-txt)',
}

export function WealthCard({ label, value, sub, hero, suffix, tone = 'neutral', currency = 'ARS', accent = 'neutral' }: Props) {
  const negative = value < 0
  const color = ACCENT_VAR[accent]
  // El número toma el color del acento, salvo que tone='auto' mande (verde/rojo por signo).
  const valueColor = tone === 'auto' ? undefined : accent !== 'neutral' ? color : undefined

  return (
    <Card highlight={hero}>
      <div className="flex flex-col items-center text-center justify-center h-full py-1">
        <div className="flex items-center gap-1.5 mb-2">
          {accent !== 'neutral' && (
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} aria-hidden="true" />
          )}
          <div className="text-[11px] font-semibold uppercase tracking-wider text-txt-3 leading-tight">{label}</div>
        </div>
        <div
          className={`text-xl font-bold font-mono tabular-nums leading-none ${
            tone === 'auto' ? (negative ? 'text-danger' : 'text-success') : ''
          }`}
          style={valueColor ? { color: valueColor } : undefined}
        >
          {suffix ? `${value}${suffix}` : money(value, currency)}
        </div>
        {sub && <div className="text-[11px] text-txt-3 mt-2 leading-tight">{sub}</div>}
        {!sub && <div className="mt-2 min-h-[14px]" aria-hidden="true" />}
      </div>
    </Card>
  )
}
