import { Link } from 'react-router-dom'
import { useStore } from '@/lib/store'
import { useFetch } from '@/hooks/useFetch'
import { ARS, MONTHS_SHORT } from '@/lib/format'
import { TopBar } from '@/components/layout/TopBar'
import { WealthCard, Card, MovementRow, CategoryBar, EmptyState, AsyncGate } from '@/components/ui'
import { HealthCard } from '@/components/HealthCard'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const CONN_STATUS: Record<string, { color: string; label: string }> = {
  CONNECTED: { color: '#5bbf7a', label: 'Conectada' },
  EXPIRED: { color: '#d4a53a', label: 'Permiso vencido' },
  DISCONNECTED: { color: '#6a6a74', label: 'No conectada' },
}

export function Dashboard() {
  const { year } = useStore()
  const { data: dash, loading: ld, error: dashErr, refetch: dashRefetch } = useFetch<any>(`/analysis/dashboard?year=${year}`, [year])
  const { data: ins } = useFetch<any>(`/analysis/insights?year=${year}`, [year])
  const { data: catalog } = useFetch<any[]>('/integrations/catalog')
  const { data: integrations } = useFetch<any>('/integrations')
  const { data: accounts } = useFetch<any[]>('/accounts')
  const { data: svcSummary } = useFetch<any>('/services/summary')
  const { data: health } = useFetch<any>('/analysis/health')

  if (ld && !dash) return <AsyncGate title="Dashboard" />
  if (!dash) return <AsyncGate title="Dashboard" error={dashErr} onRetry={dashRefetch} />

  const p = dash.patrimonio
  const active = dash.months.filter((m: any) => m.income || m.expense)
  const chartData = active.map((m: any) => ({ name: MONTHS_SHORT[m.month], ahorro: m.cumulative }))
  const catTotal = dash.categories.reduce((s: number, c: any) => s + c.amount, 0)

  const connectedList: any[] = integrations?.integrations ?? []
  const stateOf = (id: string) => connectedList.find((i) => i.provider === id)
  const manualLinked = (accounts ?? []).filter(
    (a: any) => a.provider && a.provider !== 'mercado_pago' && a.provider !== 'iol'
  ).length

  // Disponible real = disponible − lo que falta pagar de servicios este mes (en ARS).
  // El disponible sale del motor financiero; el comprometido, del módulo de servicios.
  // Acá solo se restan — este componente no calcula ni saldos ni vencimientos.
  // Disponible en dólares (si hay cuentas en USD). Separado de los pesos a propósito:
  // el patrimonio nunca mezcla monedas.
  const usdDisponible = p.disponibleByCurrency?.USD ?? 0
  const usdInvertido = p.invertidoByCurrency?.USD ?? 0
  const committedARS = svcSummary?.committedRemaining?.ARS ?? 0
  const disponibleReal = p.disponible - committedARS

  return (
    <>
      <TopBar title="Dashboard" sub={`${year} · datos reales`} />
      <div className="p-7 animate-fade-in">
        {health && (health.totals?.income > 0 || health.totals?.expense > 0 || health.score > 0) && (
          <HealthCard health={health} />
        )}
        {dash.activity && (() => {
          const a = dash.activity
          const cards = [
            { label: 'Hoy ganaste', value: a.todayIncome, tone: 'income' as const },
            { label: 'Hoy gastaste', value: a.todayExpense, tone: 'expense' as const },
            { label: 'Balance semanal', value: a.weekBalance, tone: 'balance' as const },
            { label: 'Balance mensual', value: a.monthBalance, tone: 'balance' as const },
          ]
          return (
            <div
              className="grid gap-3 mb-4"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}
            >
              {cards.map((c) => {
                const positive = c.tone === 'income' || (c.tone === 'balance' && c.value >= 0)
                const color = c.tone === 'expense' ? 'text-danger' : positive ? 'text-success' : 'text-danger'
                const sign = c.tone === 'balance' && c.value !== 0 ? (c.value > 0 ? '+' : '') : c.tone === 'income' && c.value > 0 ? '+' : ''
                return (
                  <div key={c.label} className="bg-bg-1 border border-bg-2 rounded-[12px] p-3.5 flex flex-col items-center text-center justify-center">
                    <div className="text-[11px] text-txt-3 mb-1.5 leading-tight">{c.label}</div>
                    <div className={`font-mono font-bold text-[17px] leading-none ${color}`}>{sign}{ARS(Math.abs(c.value))}</div>
                  </div>
                )
              })}
            </div>
          )
        })()}
        {(() => {
          // Se arma la lista de tarjetas primero, filtrando las que no aplican (USD solo si
          // hay saldo en dólares, "disponible real" solo si hay servicios comprometidos).
          // Así la grilla nunca queda con huecos ni con una fila coja: se reparten las que
          // realmente existen. Antes eran 6 columnas fijas con 6 a 8 tarjetas condicionales,
          // y la última fila quedaba desalineada.
          const wealthCards = [
            { key: 'neto', label: 'Patrimonio Neto', value: p.neto, hero: true, sub: 'Todo menos lo que debés' },
            { key: 'disp', label: 'Disponible', value: p.disponible, sub: 'En cuentas (ARS)' },
            usdDisponible !== 0 && { key: 'dispUsd', label: 'Disponible USD', value: usdDisponible, currency: 'USD', sub: 'En cuentas en dólares' },
            committedARS > 0 && { key: 'dispReal', label: 'Disponible Real', value: disponibleReal, sub: `Menos ${ARS(committedARS)} en servicios`, tone: 'auto' as const },
            { key: 'inv', label: 'Invertido', value: p.invertido, sub: 'En inversiones' },
            usdInvertido !== 0 && { key: 'invUsd', label: 'Invertido USD', value: usdInvertido, currency: 'USD', sub: 'Inversiones en dólares' },
            { key: 'deu', label: 'Deudas', value: p.deudas, sub: 'Total a pagar' },
            { key: 'cob', label: 'Por cobrar', value: p.porCobrar, sub: 'Pendiente' },
          ].filter(Boolean) as Array<{ key: string; label: string; value: number; hero?: boolean; sub?: string; currency?: string; tone?: 'auto' | 'neutral' }>

          return (
            <div
              className="grid gap-3 mb-4"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}
            >
              {wealthCards.map((c) => (
                <WealthCard
                  key={c.key}
                  label={c.label}
                  value={c.value}
                  hero={c.hero}
                  sub={c.sub}
                  currency={c.currency}
                  tone={c.tone}
                />
              ))}
            </div>
          )
        })()}

        {chartData.length > 1 && (
          <Card className="mb-4">
            <h3 className="text-sm font-semibold mb-3">Evolución del ahorro</h3>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#d4a53a" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#d4a53a" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6a6a74' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#6a6a74' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${(v / 1e6).toFixed(1)}M`} width={42} />
                <Tooltip cursor={{ stroke: 'rgba(212,165,58,0.3)', strokeWidth: 1 }} contentStyle={{ background: '#131316', border: '1px solid #242428', borderRadius: 10, fontSize: 13 }} labelStyle={{ color: '#ededed', fontWeight: 600, marginBottom: 2 }} itemStyle={{ color: '#ededed' }} formatter={(v: number) => [ARS(v), 'Ahorro']} />
                <Area type="monotone" dataKey="ahorro" stroke="#d4a53a" strokeWidth={2.5} fill="url(#goldGrad)" dot={{ r: 3, fill: '#d4a53a', stroke: '#131316', strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        )}

        {svcSummary?.nextPayment && (
          <Link to="/servicios" className="block mb-4">
            <Card className="hover:border-line-2 transition">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2.5">
                  <span className="w-8 h-8 rounded-lg bg-gold/10 grid place-items-center shrink-0">
                    <svg viewBox="0 0 24 24" className="w-4 h-4 text-gold-2" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 8v4l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-txt-3 font-semibold">Próximo pago</div>
                    <div className="text-[14px] font-semibold">
                      {svcSummary.nextPayment.name}{' '}
                      <span className="text-txt-3 font-normal">· {nextPaymentWhen(svcSummary.nextPayment.dueDate)}</span>
                    </div>
                  </div>
                </div>
                <div className="font-mono font-semibold text-[15px]">
                  {svcSummary.nextPayment.currency === 'ARS'
                    ? ARS(svcSummary.nextPayment.amount)
                    : `${svcSummary.nextPayment.currency} ${svcSummary.nextPayment.amount.toLocaleString('es-AR')}`}
                </div>
                <div className="flex-1" />
                {committedARS > 0 && (
                  <div className="text-right">
                    <div className="text-[11px] uppercase tracking-wider text-txt-3 font-semibold">Comprometido este mes</div>
                    <div className="text-[14px] font-semibold font-mono">{ARS(committedARS)}</div>
                  </div>
                )}
              </div>
            </Card>
          </Link>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <h3 className="text-sm font-semibold mb-3">Últimos movimientos</h3>
            {dash.recent.length ? dash.recent.map((m: any) => <MovementRow key={m.id} m={m} />) : <EmptyState icon="💸" title="Sin movimientos" />}
          </Card>
          <Card highlight>
            <h3 className="text-sm font-semibold text-gold-2 mb-3">Análisis IA</h3>
            <ul className="space-y-2">
              {(ins?.insights || []).map((i: any, idx: number) => (
                <li key={idx} className="flex gap-2.5 text-[13px] text-txt-2 leading-relaxed">
                  <span className="text-gold-2 shrink-0">›</span>
                  <span>{i.text}</span>
                </li>
              ))}
              {!ins?.insights?.length && <li className="text-txt-3">Cargá movimientos para ver análisis.</li>}
            </ul>
          </Card>
        </div>

        {catalog && catalog.length > 0 && (
          <Card className="mt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Cuentas conectadas</h3>
              <Link to="/integraciones" className="text-[11.5px] text-gold-2 hover:underline">
                Ver todas →
              </Link>
            </div>
            <div className="flex flex-wrap gap-2">
              {catalog.map((meta: any) => {
                const st = stateOf(meta.id)
                const badge = CONN_STATUS[st?.status ?? 'DISCONNECTED']
                return (
                  <div
                    key={meta.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-btn bg-panel-2 border border-line"
                  >
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: badge.color }} />
                    <span className="text-[12.5px] font-medium text-txt">{meta.label}</span>
                    <span className="text-[11px] text-txt-3">{badge.label}</span>
                  </div>
                )
              })}
            </div>
            {manualLinked > 0 && (
              <p className="text-[11.5px] text-txt-3 mt-3">
                + {manualLinked} cuenta{manualLinked === 1 ? '' : 's'} vinculada{manualLinked === 1 ? '' : 's'} a mano
                (bancos, billeteras o exchanges sin conector todavía).
              </p>
            )}
          </Card>
        )}

        {dash.categories.length > 0 && (
          <Card className="mt-4">
            <h3 className="text-sm font-semibold mb-4">Gastos por categoría</h3>
            {dash.categories.map((c: any) => (
              <CategoryBar key={c.name} name={c.name} color={c.color} amount={c.amount} pct={catTotal > 0 ? (c.amount / catTotal) * 100 : 0} />
            ))}
          </Card>
        )}
      </div>
    </>
  )
}

// "hoy", "mañana" o la fecha corta, para el próximo pago del dashboard.
function nextPaymentWhen(iso: string): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const date = new Date(iso + 'T00:00:00')
  const diff = Math.round((date.getTime() - today.getTime()) / 86_400_000)
  if (diff <= 0) return 'hoy'
  if (diff === 1) return 'mañana'
  if (diff <= 7) return `en ${diff} días`
  return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
}
