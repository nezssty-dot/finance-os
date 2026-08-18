import { ARS, fmtDate } from '@/lib/format'
import { Badge } from './Badge'

interface Movement {
  id: string; type: string; amount: number; description: string; date: string
  category?: { name: string; color: string; icon?: string | null } | null
}

export function MovementRow({ m }: { m: Movement }) {
  const inc = m.type === 'INCOME'
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-bg-2 last:border-0 group hover:bg-panel-2/50 -mx-2 px-2 rounded-lg transition-colors">
      <div className={`w-8 h-8 rounded-[9px] flex items-center justify-center font-bold text-sm shrink-0 ${inc ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
        {inc ? '+' : '−'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-[13px] truncate">{m.description}</div>
        <div className="text-[11px] text-txt-3 flex items-center gap-2 mt-0.5">
          <span>{fmtDate(m.date)}</span>
          {m.category && (
            <Badge color={m.category.color}>
              {m.category.icon ? `${m.category.icon} ${m.category.name}` : m.category.name}
            </Badge>
          )}
        </div>
      </div>
      <div className={`font-mono font-bold text-[13.5px] whitespace-nowrap ${inc ? 'text-success' : 'text-danger'}`}>
        {inc ? '+' : '−'}{ARS(m.amount)}
      </div>
    </div>
  )
}
