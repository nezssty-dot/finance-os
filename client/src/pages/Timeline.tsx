import { useStore } from '@/lib/store'
import { useFetch } from '@/hooks/useFetch'
import { ARS, fmtDate } from '@/lib/format'
import { TopBar } from '@/components/layout/TopBar'
import { Card, Badge, EmptyState, SkeletonRows } from '@/components/ui'

// El feed histórico del server devuelve movimientos individuales ({ events }); los
// agrupamos por día acá para la vista de línea de tiempo. (Antes la página esperaba
// días ya agregados y quedaba siempre vacía: el server había pasado a devolver eventos.)
function groupByDay(events: any[]) {
  const map = new Map<string, { date: string; count: number; income: number; expense: number; balance: number }>()
  for (const e of events) {
    const day = new Date(e.date).toISOString().slice(0, 10)
    const row = map.get(day) ?? { date: e.date, count: 0, income: 0, expense: 0, balance: 0 }
    row.count++
    // Signo según tipo: entra con INCOME/COLLECTION, sale con el resto de los gastos.
    const isIncome = e.type === 'INCOME' || e.type === 'COLLECTION'
    if (isIncome) { row.income += e.amount; row.balance += e.amount }
    else if (e.type === 'EXPENSE' || e.type === 'DEBT_PAYMENT') { row.expense += e.amount; row.balance -= e.amount }
    map.set(day, row)
  }
  return [...map.values()]
}

// "Hoy", "Mañana" o la fecha, para el encabezado de cada día futuro.
function whenLabel(iso: string): string {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const date = new Date(iso)
  const diff = Math.round((date.getTime() - today.getTime()) / 86_400_000)
  if (diff === 0) return 'Hoy'
  if (diff === 1) return 'Mañana'
  return date.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function Timeline() {
  const { year } = useStore()
  const { data: hist, loading } = useFetch<any>(`/timeline?year=${year}&limit=80`, [year])
  const { data: upcoming } = useFetch<any>('/timeline/upcoming?days=30')

  const days = hist?.events ? groupByDay(hist.events) : []
  const future = upcoming?.events ?? []

  return (
    <>
      <TopBar title="Timeline" sub={`Tu ${year}, día por día`} />
      <div className="p-7 animate-fade-in space-y-4">
        {/* Lo que viene: vencimientos de servicios en los próximos 30 días */}
        {future.length > 0 && (
          <Card title="Próximamente">
            <div className="relative pl-6">
              <div className="absolute left-[7px] top-2 bottom-2 w-px bg-line border-dashed" style={{ borderLeft: '1px dashed var(--line)' }} />
              {future.map((ev: any) => (
                <div key={ev.id} className="relative pb-4 last:pb-0">
                  <div
                    className="absolute -left-6 top-1.5 w-[15px] h-[15px] rounded-full border-2 border-bg"
                    style={{ background: ev.paid ? '#5bbf7a' : '#d4a53a' }}
                  />
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-semibold text-txt-3 uppercase tracking-wide w-20 shrink-0">
                      {whenLabel(ev.date)}
                    </span>
                    <span className={`font-medium text-[13.5px] ${ev.paid ? 'text-txt-3 line-through' : ''}`}>
                      {ev.description}
                    </span>
                    {ev.autoDebit && !ev.paid && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-panel-2 text-txt-3 border border-line">
                        débito automático
                      </span>
                    )}
                    <div className="flex-1" />
                    <span className="font-mono text-[13px] text-txt-2">
                      {ev.currency === 'ARS' ? ARS(ev.amount) : `${ev.currency} ${ev.amount.toLocaleString('es-AR')}`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Lo que pasó */}
        <Card title={future.length > 0 ? 'Lo que pasó' : undefined}>
          {loading && !hist ? (
            <SkeletonRows rows={6} />
          ) : !days.length ? (
            <EmptyState icon="📅" title="Nada todavía" description={`No hay movimientos cargados en ${year}.`} />
          ) : (
            <div className="relative pl-6">
              <div className="absolute left-[7px] top-2 bottom-2 w-px bg-line" />
              {days.map((d, i) => {
                const positive = d.balance >= 0
                return (
                  <div key={i} className="relative pb-6 last:pb-0">
                    <div
                      className="absolute -left-6 top-1.5 w-[15px] h-[15px] rounded-full border-2 border-bg"
                      style={{ background: positive ? '#5bbf7a' : '#d9615c' }}
                    />
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-[13.5px]">{fmtDate(d.date)}</span>
                      <Badge color={positive ? '#5bbf7a' : '#d9615c'}>
                        {positive ? '+' : '−'}{ARS(Math.abs(d.balance))}
                      </Badge>
                    </div>
                    <div className="text-[12px] text-txt-3">
                      {d.count} {d.count === 1 ? 'movimiento' : 'movimientos'}
                      {d.income > 0 && ` · ${ARS(d.income)} entraron`}
                      {d.expense > 0 && ` · ${ARS(d.expense)} salieron`}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>
    </>
  )
}
