import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Plus, ArrowDownToLine, ArrowUpFromLine, Landmark, Wallet, Smartphone,
  PiggyBank, TrendingUp, CreditCard, DollarSign,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { useFetch } from '@/hooks/useFetch'
import { api } from '@/lib/api'
import { ARS, money, MONTHS_SHORT } from '@/lib/format'
import { TopBar } from '@/components/layout/TopBar'
import { Card, MovementRow, InteractiveDonut, EmptyState, AsyncGate, Button, Modal, Input, Select } from '@/components/ui'
import { HealthCard } from '@/components/HealthCard'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const FX_LABEL: Record<string, string> = {
  MEP: 'Dólar MEP',
  OFICIAL: 'Dólar Oficial',
  BLUE: 'Dólar Blue',
  CCL: 'Contado con Liqui',
  CRIPTO: 'Dólar Cripto',
}

// Un ícono por tipo de cuenta — nada de logos de tarjetas ajenas, esto es genérico y
// se arma solo con lo que el usuario tipeó al crear la cuenta.
const ACCOUNT_ICON: Record<string, typeof Wallet> = {
  CASH: Wallet,
  BANK: Landmark,
  MERCADO_PAGO: Smartphone,
  RESERVE: PiggyBank,
  WALLET: Wallet,
  BROKER: TrendingUp,
  OTHER: CreditCard,
}
const ACCOUNT_LABEL: Record<string, string> = {
  CASH: 'Efectivo', BANK: 'Banco', MERCADO_PAGO: 'Mercado Pago',
  RESERVE: 'Reserva', WALLET: 'Wallet', BROKER: 'Broker', OTHER: 'Otra',
}

// Anillo de progreso simple — el mismo lenguaje visual que las donas "75%"/"50%" del
// Figma, con el número real adentro (nunca inventado).
function Ring({ pct, color }: { pct: number; color: string }) {
  const r = 30, c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, pct))
  return (
    <svg viewBox="0 0 72 72" width={72} height={72} className="shrink-0 -rotate-90">
      <circle cx="36" cy="36" r={r} fill="none" stroke="var(--c-track)" strokeWidth="8" />
      <circle
        cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c - (clamped / 100) * c}
      />
      <text x="36" y="36" transform="rotate(90 36 36)" textAnchor="middle" dominantBaseline="central" className="fill-txt font-mono font-bold" style={{ fontSize: 13 }}>
        {Math.round(clamped)}%
      </text>
    </svg>
  )
}

export function Dashboard() {
  const { year } = useStore()
  const { data: dash, loading: ld, error: dashErr, refetch: dashRefetch } = useFetch<any>(`/analysis/dashboard?year=${year}`, [year])
  const { data: ins } = useFetch<any>(`/analysis/insights?year=${year}`, [year])
  const { data: svcSummary } = useFetch<any>('/services/summary')
  const { data: health } = useFetch<any>('/analysis/health')
  const { data: cats } = useFetch<any[]>('/categories')
  const { data: accts } = useFetch<any[]>('/accounts')
  const { data: fx } = useFetch<any>('/fx')
  const { data: budgets } = useFetch<any[]>('/budgets')
  const projects = (budgets ?? []).filter((b: any) => b.type === 'PROJECT')
  const [quickAdd, setQuickAdd] = useState<false | 'INCOME' | 'EXPENSE'>(false)
  const [savingMov, setSavingMov] = useState(false)

  if (ld && !dash) return <AsyncGate title="Dashboard" />
  if (!dash) return <AsyncGate title="Dashboard" error={dashErr} onRetry={dashRefetch} />

  const p = dash.patrimonio
  const active = dash.months.filter((m: any) => m.income || m.expense)
  const chartData = active.map((m: any) => ({ name: MONTHS_SHORT[m.month], ahorro: m.cumulative }))

  const now = new Date()
  const curMonth = year === now.getFullYear()
    ? dash.months.find((m: any) => m.month === now.getMonth())
    : active[active.length - 1]
  const monthIncome = curMonth?.income ?? 0
  const monthExpense = curMonth?.expense ?? 0
  const monthTotal = monthIncome + monthExpense
  // Parte del ingreso y el gasto de este mes sobre todo lo que se movió — no inventa una
  // "meta" que Finance OS no tiene, solo muestra la proporción real entre los dos.
  const incomePct = monthTotal > 0 ? (monthIncome / monthTotal) * 100 : 0
  const expensePct = monthTotal > 0 ? (monthExpense / monthTotal) * 100 : 0

  const committedARS = svcSummary?.committedRemaining?.ARS ?? 0

  async function quickSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setSavingMov(true)
    try {
      await api('/movements', {
        method: 'POST',
        body: {
          type: f.get('type'),
          amount: Number(f.get('amount')),
          currency: f.get('currency'),
          description: f.get('description'),
          date: f.get('date'),
          categoryId: f.get('categoryId') || null,
          accountId: f.get('accountId') || null,
          budgetId: f.get('budgetId') || null,
        },
      })
      setQuickAdd(false)
      dashRefetch()
    } finally { setSavingMov(false) }
  }

  return (
    <>
      <TopBar title="Dashboard" sub={`${year} · datos reales`} />
      <div className="p-7 animate-fade-in flex flex-col gap-4">
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
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              {cards.map((c) => {
                const positive = c.tone === 'income' || (c.tone === 'balance' && c.value >= 0)
                const color = c.tone === 'expense' ? 'text-danger' : positive ? 'text-success' : 'text-danger'
                const sign = c.tone === 'balance' && c.value !== 0 ? (c.value > 0 ? '+' : '') : c.tone === 'income' && c.value > 0 ? '+' : ''
                return (
                  <div key={c.label} className="bg-panel-2 rounded-[16px] p-4 flex flex-col items-center text-center justify-center gap-1.5">
                    <div className="text-[11px] text-txt-3 leading-tight">{c.label}</div>
                    <div className={`font-mono font-bold text-title leading-none ${color}`}>{sign}{ARS(Math.abs(c.value))}</div>
                  </div>
                )
              })}
            </div>
          )
        })()}

        {/* ── Fila 1: Balance Total | Evolución de Ahorro | Tus Cuentas ── */}
        <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr 380px' }}>
          <div className="rounded-card p-6 flex flex-col justify-between" style={{ background: 'var(--c-accent)' }}>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-title text-black/65">Balance Total</div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-hero text-black tabular-nums">{ARS(p.neto)}</span>
                  <span className="text-[13px] font-semibold text-black/55">ARS</span>
                </div>
              </div>
              <Link to="/cuentas" className="w-10 h-10 rounded-full bg-black/10 hover:bg-black/15 flex items-center justify-center text-black shrink-0 transition-colors">
                <Plus size={18} strokeWidth={2.4} />
              </Link>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setQuickAdd('INCOME')} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full bg-white text-black text-[14px] font-semibold hover:bg-white/90 transition-colors">
                Ingresar <ArrowDownToLine size={15} strokeWidth={2.4} />
              </button>
              <button onClick={() => setQuickAdd('EXPENSE')} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full bg-chrome text-white text-[14px] font-semibold hover:bg-chrome-2 transition-colors">
                Egresar <ArrowUpFromLine size={15} strokeWidth={2.4} />
              </button>
            </div>
          </div>

          <Card>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-title">Evolución de Ahorro</h3>
              {curMonth && (
                <span className="flex items-center gap-1 bg-success-dim text-success text-[11px] font-semibold px-2.5 py-1 rounded-full">
                  {monthIncome >= monthExpense ? '▲' : '▼'} {monthTotal > 0 ? Math.round(Math.abs(monthIncome - monthExpense) / monthTotal * 100) : 0}%
                </span>
              )}
            </div>
            {chartData.length > 1 ? (
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--c-accent)" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="var(--c-accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--c-txt-3)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--c-txt-3)' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${(v / 1e6).toFixed(1)}M`} width={42} />
                  <Tooltip cursor={{ stroke: 'var(--c-accent)', strokeWidth: 1, strokeOpacity: 0.3 }} contentStyle={{ background: 'var(--c-panel)', border: '1px solid var(--c-line)', borderRadius: 14, fontSize: 13 }} labelStyle={{ color: 'var(--c-txt)', fontWeight: 600, marginBottom: 2 }} itemStyle={{ color: 'var(--c-txt)' }} formatter={(v: number) => [ARS(v), 'Ahorro']} />
                  <Area type="monotone" dataKey="ahorro" stroke="var(--c-accent-2)" strokeWidth={2.5} fill="url(#goldGrad)" dot={{ r: 3, fill: 'var(--c-accent-2)', stroke: 'var(--c-panel)', strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[160px] flex items-center justify-center text-txt-3 text-sm">Cargá movimientos para ver la curva.</div>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-title">Tus Cuentas</h3>
              <Link to="/cuentas" className="w-8 h-8 rounded-full border border-dashed border-line-2 flex items-center justify-center text-txt-3 hover:text-txt hover:border-txt-3 transition-colors">
                <Plus size={15} />
              </Link>
            </div>
            {!accts?.length ? (
              <EmptyState icon="🏦" title="Sin cuentas" description="Creá Efectivo, Banco o lo que uses." action={<Link to="/cuentas"><Button variant="primary">+ Nueva cuenta</Button></Link>} />
            ) : (
              <div className="flex flex-col gap-3">
                {accts.slice(0, 3).map((a: any, i: number) => {
                  const Icon = ACCOUNT_ICON[a.type] ?? CreditCard
                  const dark = i % 2 === 1
                  return (
                    <div key={a.id} className={`rounded-[20px] px-5 py-4 flex items-center gap-3 ${dark ? 'bg-chrome text-white' : 'bg-panel-2 text-txt'}`}>
                      <span className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${dark ? 'bg-white/10' : 'bg-white'}`}>
                        <Icon size={17} strokeWidth={2} className={dark ? 'text-white' : 'text-txt-2'} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-[14px] truncate">{a.name}</div>
                        <div className={`text-[11px] ${dark ? 'text-white/50' : 'text-txt-3'}`}>{ACCOUNT_LABEL[a.type] ?? a.type}</div>
                      </div>
                      <div className={`font-mono font-bold text-[16px] tabular-nums text-right ${a.balance < 0 ? 'text-danger' : ''}`}>
                        {money(a.balance, a.currency)}
                      </div>
                    </div>
                  )
                })}
                {accts.length > 3 && (
                  <Link to="/cuentas" className="text-center text-[12px] text-txt-3 hover:text-accent-2 transition-colors">
                    +{accts.length - 3} cuenta{accts.length - 3 === 1 ? '' : 's'} más
                  </Link>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* ── Fila 2: Ingreso | Egreso | Cotización  +  Análisis IA ── */}
        <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr 1fr 380px' }}>
          <Card className="flex flex-col justify-between gap-4">
            <div className="flex items-start gap-4">
              <span className="w-11 h-11 rounded-full bg-success-dim text-success flex items-center justify-center shrink-0">
                <ArrowDownToLine size={19} strokeWidth={2} />
              </span>
              <Ring pct={incomePct} color="var(--c-success)" />
            </div>
            <div>
              <div className="text-title text-txt-2">Ingreso</div>
              <div className="font-mono font-bold text-h3 tabular-nums">{ARS(monthIncome)}</div>
            </div>
          </Card>

          <Card className="flex flex-col justify-between gap-4">
            <div className="flex items-start gap-4">
              <span className="w-11 h-11 rounded-full bg-danger-dim text-danger flex items-center justify-center shrink-0">
                <ArrowUpFromLine size={19} strokeWidth={2} />
              </span>
              <Ring pct={expensePct} color="var(--c-danger)" />
            </div>
            <div>
              <div className="text-title text-txt-2">Egreso</div>
              <div className="font-mono font-bold text-h3 tabular-nums">{ARS(monthExpense)}</div>
            </div>
          </Card>

          <Card>
            <h3 className="text-title mb-3">Cotización</h3>
            {fx?.quotes?.length > 0 ? (
              <div className="flex flex-col gap-3">
                {fx.quotes.slice(0, 2).map((q: any) => (
                  <div key={q.kind} className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <span className="w-9 h-9 rounded-full bg-accent-dim text-accent-2 flex items-center justify-center shrink-0">
                        <DollarSign size={16} strokeWidth={2.4} />
                      </span>
                      <span className="text-[13px] font-medium leading-tight">{FX_LABEL[q.kind] ?? q.kind}</span>
                    </div>
                    <span className="font-mono font-bold text-[15px] tabular-nums">{ARS(q.sell ?? q.buy ?? 0)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-txt-3 text-sm">Sin cotización todavía.</div>
            )}
          </Card>

          <Card highlight>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-title text-accent-2">Análisis IA</h3>
              <Link to="/insights" className="text-[13px] text-info font-medium">View all</Link>
            </div>
            <ul className="flex flex-col gap-2.5">
              {(ins?.insights || []).slice(0, 4).map((i: any, idx: number) => (
                <li key={idx} className="flex gap-2.5 text-[13px] text-txt-2 leading-relaxed">
                  <span className="text-accent-2 shrink-0">›</span>
                  <span>{i.text}</span>
                </li>
              ))}
              {!ins?.insights?.length && <li className="text-txt-3 text-[13px]">Cargá movimientos para ver análisis.</li>}
            </ul>
          </Card>
        </div>

        {/* ── Fila 3: Últimos movimientos  +  Categorías ── */}
        <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 380px' }}>
          <Card>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-title">Últimos Movimientos</h3>
              <Link to="/movimientos" className="text-[13px] text-info font-medium">Ver todos</Link>
            </div>
            {svcSummary?.nextPayment && (
              <Link to="/servicios" className="block mb-3 -mx-1 px-4 py-3 rounded-[14px] bg-panel-2 hover:bg-line transition-colors">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="text-[11px] uppercase tracking-wider text-txt-3 font-semibold">Próximo pago</div>
                  <div className="text-[13px] font-semibold">
                    {svcSummary.nextPayment.name} <span className="text-txt-3 font-normal">· {nextPaymentWhen(svcSummary.nextPayment.dueDate)}</span>
                  </div>
                  <div className="flex-1" />
                  <div className="font-mono font-semibold text-[14px]">
                    {svcSummary.nextPayment.currency === 'ARS' ? ARS(svcSummary.nextPayment.amount) : `${svcSummary.nextPayment.currency} ${svcSummary.nextPayment.amount.toLocaleString('es-AR')}`}
                  </div>
                  {committedARS > 0 && <div className="text-[11px] text-txt-3">Comprometido: {ARS(committedARS)}</div>}
                </div>
              </Link>
            )}
            {dash.recent.length ? dash.recent.map((m: any) => <MovementRow key={m.id} m={m} />) : <EmptyState icon="💸" title="Sin movimientos" />}
          </Card>

          <Card>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-title">Categorías</h3>
              {dash.categories.length > 0 && (
                <span className="font-mono text-[12px] text-txt-3">
                  Total: {ARS(dash.categories.reduce((s: number, c: any) => s + c.amount, 0))}
                </span>
              )}
            </div>
            {dash.categories.length > 0 ? (
              <InteractiveDonut size={160} slices={dash.categories.map((c: any) => ({ name: c.name, value: c.amount, color: c.color }))} />
            ) : (
              <EmptyState icon="🏷️" title="Sin gastos categorizados" />
            )}
          </Card>
        </div>
      </div>

      <Modal open={!!quickAdd} onClose={() => setQuickAdd(false)} title={quickAdd === 'INCOME' ? 'Nuevo ingreso' : 'Nuevo gasto'} sub="Sumá un movimiento en segundos">
        <form onSubmit={quickSubmit} key={String(quickAdd)}>
          <div className="grid grid-cols-2 gap-3">
            <Select name="type" label="Tipo" defaultValue={quickAdd === 'INCOME' ? 'INCOME' : 'EXPENSE'}>
              <option value="EXPENSE">Gasto</option>
              <option value="INCOME">Ingreso</option>
            </Select>
            <Select name="currency" label="Moneda" defaultValue="ARS">
              <option value="ARS">ARS</option>
              <option value="USD">USD</option>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input name="amount" label="Monto" type="number" step="0.01" min="0.01" required placeholder="0.00" autoFocus />
            <Input name="date" label="Fecha" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          </div>
          <Input name="description" label="Descripción" required placeholder="Ej: Súper, Venta de beat…" />
          <div className="grid grid-cols-2 gap-3">
            <Select name="categoryId" label="Categoría (opcional)" defaultValue="">
              <option value="">Sin categoría</option>
              {(cats ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select name="accountId" label="Cuenta (opcional)" defaultValue="">
              <option value="">Sin cuenta</option>
              {(accts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </div>
          {projects.length > 0 && (
            <Select name="budgetId" label="Presupuesto de proyecto (opcional)" defaultValue="">
              <option value="">Sin asignar</option>
              {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          )}
          <div className="flex gap-3 mt-5">
            <Button type="button" className="flex-1" onClick={() => setQuickAdd(false)}>Cancelar</Button>
            <Button variant="primary" type="submit" className="flex-1" disabled={savingMov}>Guardar</Button>
          </div>
        </form>
      </Modal>
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
