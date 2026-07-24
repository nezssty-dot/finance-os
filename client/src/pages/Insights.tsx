import { useStore } from '@/lib/store'
import { useFetch } from '@/hooks/useFetch'
import { ARS } from '@/lib/format'
import { TopBar } from '@/components/layout/TopBar'
import { Card, WealthCard, EmptyState, SkeletonCard } from '@/components/ui'
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts'

const SEVERITY: Record<string, { color: string; bg: string; label: string; icon: string }> = {
  alert: { color: '#d9615c', bg: 'rgba(217,97,92,.09)', label: 'Alerta', icon: '!' },
  warning: { color: '#d4a53a', bg: 'rgba(212,165,58,.10)', label: 'Atención', icon: '!' },
  good: { color: '#5bbf7a', bg: 'rgba(91,191,122,.09)', label: 'Bien', icon: '✓' },
  info: { color: '#6a6a74', bg: 'transparent', label: 'Dato', icon: 'i' },
}

const tooltipStyle = {
  background: '#131316',
  border: '1px solid #242428',
  borderRadius: 10,
  fontSize: 13,
}
const tipLabel = { color: '#ededed', fontWeight: 600, marginBottom: 2 }
const tipItem = { color: '#ededed' }
const barCursor = { fill: 'rgba(212,165,58,0.08)' }

interface Reco { text: string; tone: 'good' | 'warn' | 'tip'; priority: number }

export function Insights() {
  const { year } = useStore()
  const { data, loading } = useFetch<any>(`/analysis/insights?year=${year}`, [year])

  if (loading && !data) {
    return (
      <>
        <TopBar title="Insights" />
        <div className="p-7 grid md:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} />)}
        </div>
      </>
    )
  }

  if (!data?.savings.series.length) {
    return (
      <>
        <TopBar title="Insights" />
        <div className="p-7">
          <Card>
            <EmptyState
              icon="🧠"
              title="Todavía no hay nada que analizar"
              description={`No hay movimientos cargados en ${year}. Sincronizá Mercado Pago o cargá algunos movimientos y vas a ver acá el análisis de tus números.`}
            />
          </Card>
        </div>
      </>
    )
  }

  const { insights, savings, patrimonio, categories, yearComparison, totals } = data
  const recos: Reco[] = data.recommendations ?? []
  const alerts = insights.filter((i: any) => i.severity === 'alert' || i.severity === 'warning')
  const rest = insights.filter((i: any) => i.severity !== 'alert' && i.severity !== 'warning')
  const growth = categories.growth.filter((g: any) => g.previous > 0 || g.current > 0)

  const RECO_TONE: Record<string, { color: string; bg: string; icon: string }> = {
    good: { color: '#5bbf7a', bg: 'rgba(91,191,122,0.08)', icon: '✓' },
    warn: { color: '#d9a441', bg: 'rgba(217,164,65,0.08)', icon: '!' },
    tip: { color: '#5b9bd4', bg: 'rgba(91,155,212,0.08)', icon: '→' },
  }

  return (
    <>
      <TopBar title="Insights" sub={`Análisis de tus números reales de ${year}`} />
      <div className="p-7 animate-fade-in">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <WealthCard label="Patrimonio neto" value={patrimonio.neto} hero />
          <WealthCard label="Ahorrado en el año" value={savings.total} />
          <WealthCard label="Ahorro promedio" value={savings.avgMonthly} sub="por mes" />
          <WealthCard
            label="Tasa de ahorro"
            value={totals.income > 0 ? Math.round((totals.balance / totals.income) * 100) : 0}
            suffix="%"
          />
        </div>

        {recos.length > 0 && (
          <Card className="mb-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 rounded-lg bg-gold-dim text-gold-2 flex items-center justify-center text-[13px]">◆</span>
              <h3 className="text-sm font-semibold">Qué podés hacer para mejorar</h3>
            </div>
            <div className="space-y-2">
              {recos.map((r, idx) => {
                const t = RECO_TONE[r.tone] ?? RECO_TONE.tip
                return (
                  <div key={idx} className="flex items-start gap-3 px-3.5 py-3 rounded-[10px] border" style={{ borderColor: `${t.color}44`, background: t.bg }}>
                    <span className="w-[18px] h-[18px] rounded-full border flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5" style={{ color: t.color, borderColor: t.color }}>{t.icon}</span>
                    <span className="text-[13px] text-txt-2 leading-relaxed">{r.text}</span>
                  </div>
                )
              })}
            </div>
          </Card>
        )}

        {alerts.length > 0 && (
          <div className="grid gap-2 mb-4">
            {alerts.map((i: any, idx: number) => {
              const s = SEVERITY[i.severity]
              return (
                <div
                  key={idx}
                  className="flex items-start gap-3 px-4 py-3 rounded-card border"
                  style={{ borderColor: `${s.color}55`, background: s.bg }}
                >
                  <span
                    className="w-[18px] h-[18px] rounded-full border flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5"
                    style={{ color: s.color, borderColor: s.color }}
                    aria-hidden
                  >
                    {s.icon}
                  </span>
                  <span className="text-[13px] text-txt leading-relaxed">{i.text}</span>
                </div>
              )
            })}
          </div>
        )}

        <div className="grid lg:grid-cols-2 gap-4 mb-4">
          <Card title="Evolución del ahorro">
            <ResponsiveContainer width="100%" height={210}>
              <AreaChart data={savings.series}>
                <defs>
                  <linearGradient id="savGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#d4a53a" stopOpacity={0.32} />
                    <stop offset="100%" stopColor="#d4a53a" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6a6a74' }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 10, fill: '#6a6a74' }}
                  axisLine={false}
                  tickLine={false}
                  width={46}
                  tickFormatter={(v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${Math.round(v / 1e3)}k`)}
                />
                <Tooltip cursor={{ stroke: 'rgba(212,165,58,0.3)', strokeWidth: 1 }} contentStyle={tooltipStyle} labelStyle={tipLabel} itemStyle={tipItem} formatter={(v: number) => [ARS(v), 'Acumulado']} />
                <ReferenceLine y={0} stroke="#33343a" />
                <Area type="monotone" dataKey="cumulative" stroke="#d4a53a" strokeWidth={2} fill="url(#savGrad)" />
              </AreaChart>
            </ResponsiveContainer>
            <p className="text-[11.5px] text-txt-3 mt-1">
              Lo que te quedó cada mes, sumado. Si la curva baja, ese mes gastaste más de lo que entró.
            </p>
          </Card>

          <Card title="Ingresos vs gastos">
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={savings.series}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6a6a74' }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 10, fill: '#6a6a74' }}
                  axisLine={false}
                  tickLine={false}
                  width={46}
                  tickFormatter={(v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${Math.round(v / 1e3)}k`)}
                />
                <Tooltip cursor={barCursor} contentStyle={tooltipStyle} labelStyle={tipLabel} itemStyle={tipItem} formatter={(v: number) => [ARS(v), 'Balance']} />
                <ReferenceLine y={0} stroke="#33343a" />
                <Bar dataKey="balance" radius={[4, 4, 0, 0]}>
                  {savings.series.map((d: any, i: number) => (
                    <Cell key={i} fill={d.balance >= 0 ? '#5bbf7a' : '#d9615c'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="text-[11.5px] text-txt-3 mt-1">
              Verde: ahorraste. Rojo: pusiste plata de tu bolsillo.
            </p>
          </Card>
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          <Card title="Categorías que más se movieron">
            {!growth.length ? (
              <EmptyState icon="📈" title="Sin comparación" description="Necesitás al menos dos meses con gastos." />
            ) : (
              growth.map((g: any) => {
                const up = g.pct >= 0
                const width = Math.min(Math.abs(g.pct), 100)
                return (
                  <div key={g.name} className="py-2.5 border-b border-bg-2 last:border-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g.color }} />
                      <span className="flex-1 text-[13px] font-semibold truncate">{g.name}</span>
                      <span
                        className="font-mono font-bold text-[12.5px]"
                        style={{ color: up ? '#d9615c' : '#5bbf7a' }}
                      >
                        {up ? '+' : ''}{g.pct}%
                      </span>
                    </div>
                    <div className="h-1.5 bg-track rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${width}%`, background: up ? '#d9615c' : '#5bbf7a' }}
                      />
                    </div>
                    <div className="text-[11px] text-txt-3 mt-1 font-mono">
                      {ARS(g.previous)} → {ARS(g.current)}
                    </div>
                  </div>
                )
              })
            )}
          </Card>

          <div className="grid gap-4 content-start">
            {yearComparison && (
              <Card title={`${year} contra ${yearComparison.previousYear}`}>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { k: 'Ingresos', cur: yearComparison.income.current, pct: yearComparison.income.pct, goodUp: true },
                    { k: 'Gastos', cur: yearComparison.expense.current, pct: yearComparison.expense.pct, goodUp: false },
                    { k: 'Ahorro', cur: yearComparison.saving.current, pct: null, goodUp: true },
                  ].map((row) => (
                    <div key={row.k}>
                      <div className="text-[10.5px] uppercase tracking-wider text-txt-3 font-semibold mb-1">
                        {row.k}
                      </div>
                      <div className="font-mono font-bold text-[14px]">{ARS(row.cur)}</div>
                      {row.pct !== null && (
                        <div
                          className="text-[11.5px] font-mono mt-0.5"
                          style={{
                            color:
                              row.pct === 0
                                ? '#6a6a74'
                                : row.pct > 0 === row.goodUp
                                  ? '#5bbf7a'
                                  : '#d9615c',
                          }}
                        >
                          {row.pct > 0 ? '+' : ''}{row.pct}%
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <Card title="Lo que dicen tus números">
              {!rest.length ? (
                <p className="text-[13px] text-txt-3">Cargá más movimientos para ver el análisis.</p>
              ) : (
                <div className="space-y-2.5">
                  {rest.map((i: any, idx: number) => {
                    const s = SEVERITY[i.severity]
                    return (
                      <div key={idx} className="flex items-start gap-2.5">
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0 mt-[7px]"
                          style={{ background: s.color }}
                          aria-hidden
                        />
                        <span className="text-[13px] text-txt-2 leading-relaxed">{i.text}</span>
                      </div>
                    )
                  })}
                </div>
              )}
              <p className="text-[11px] text-txt-3 mt-4 pt-3 border-t border-line">
                Todo esto sale de tus movimientos, con reglas. No hay ninguna IA leyendo tus finanzas.
              </p>
            </Card>
          </div>
        </div>
      </div>
    </>
  )
}
