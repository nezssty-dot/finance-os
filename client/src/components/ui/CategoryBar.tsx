import { ARS } from '@/lib/format'
import { Badge } from './Badge'

interface Props { name: string; color: string; amount: number; pct: number }

export function CategoryBar({ name, color, amount, pct }: Props) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex justify-between items-center mb-1.5">
        <div className="flex items-center gap-2">
          <Badge color={color}>{name}</Badge>
          <span className="font-mono text-xs text-txt-3">{pct.toFixed(0)}%</span>
        </div>
        <span className="font-mono text-xs text-txt-2">{ARS(amount)}</span>
      </div>
      <div className="h-1.5 bg-track rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}
