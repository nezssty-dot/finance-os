import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Plus, ArrowDownToLine, ArrowUpFromLine, DollarSign, ChevronRight, SlidersHorizontal, Check,
  Filter, ArrowUpNarrowWide,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { useFetch } from '@/hooks/useFetch'
import { api } from '@/lib/api'
import { ARS, MONTHS_SHORT } from '@/lib/format'
import { TopBar } from '@/components/layout/TopBar'
import { Card, MovementRow, MovementsHeader, InteractiveDonut, EmptyState, AsyncGate, Button, Modal, Input, Select } from '@/components/ui'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import ingresoBadge from '@/assets/icons/ingreso-badge.png'
import egresoBadge from '@/assets/icons/egreso-badge.png'
import flagEur from '@/assets/icons/flag-eur.png'
import currencyUsd from '@/assets/icons/currency-usd.png'
import currencyBrl from '@/assets/icons/currency-brl.png'

// Verde si el mes viene positivo (ganaste más de lo que gastaste), rojo si viene
// negativo (gastaste más de lo que ganaste) — y amarillo como aviso previo, cuando
// el puntaje todavía está por debajo de 40 aunque el mes cierre positivo.
function healthColor(score: number, totals?: { income: number; expense: number }): string {
  if (totals && totals.expense > totals.income) return '#d9615c'
  if (score < 40) return 'var(--c-warning)'
  return '#5bbf7a'
}

// Versión compacta de la Salud Financiera para la columna angosta del dashboard (donde
// antes iba en banner ancho arriba de todo). El anillo con glow es el mismo lenguaje
// visual que Ring de más abajo — así el puntaje se ve con la misma "vida" que Ingreso/
// Egreso, no como un número plano.
function CompactHealthCard({ health, className }: { health: { score: number; rating: string; factors: { ok: boolean; label: string }[]; totals?: { income: number; expense: number } }; className?: string }) {
  const color = healthColor(health.score, health.totals)
  const r = 30, c = 2 * Math.PI * r
  const offset = c * (1 - health.score / 100)
  return (
    <Card className={`flex items-center gap-4 ${className ?? ''}`}>
      <svg viewBox="0 0 72 72" width={72} height={72} className="shrink-0 -rotate-90 overflow-visible">
        <defs>
          <filter id="health-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3.2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <circle cx="36" cy="36" r={r} fill="none" stroke="var(--c-track)" strokeWidth="8" />
        <circle
          cx="36" cy="36" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={offset} filter="url(#health-glow)"
          style={{ transition: 'stroke-dashoffset 1s ease-out' }}
        />
        <text x="36" y="36" transform="rotate(90 36 36)" textAnchor="middle" dominantBaseline="central" className="fill-txt font-mono font-normal" style={{ fontSize: 15 }}>
          {health.score}
        </text>
      </svg>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wider text-txt-3 font-medium">Salud financiera</div>
        <div className="text-[15px] font-normal mb-1" style={{ color }}>{health.rating}</div>
        <div className="text-[12px] text-txt-2 truncate">
          {health.factors.find((f) => !f.ok)?.label ?? health.factors[0]?.label}
        </div>
      </div>
    </Card>
  )
}

// Punto del gráfico de ahorro. Todos son un puntito chico; el ÚLTIMO además lleva la
// burbuja flotante con el valor real arriba — el mismo "+ $1.060" fijo del Figma, sin
// que el usuario tenga que pasar el mouse para verlo.
function SavingsDot({ cx, cy, index, value, lastIndex }: any) {
  if (cx == null || cy == null) return null
  if (index !== lastIndex) {
    return <circle cx={cx} cy={cy} r={3} fill="var(--c-txt)" stroke="var(--c-panel)" strokeWidth={2} />
  }
  const label = `${value >= 0 ? '+ ' : '− '}${ARS(Math.abs(value))}`
  const w = Math.max(58, label.length * 7 + 20)
  // Si el punto está muy arriba del gráfico (el mes con más ahorro acumulado), la
  // burbuja arriba (cy - 38) se sale del área dibujable y queda cortada contra el
  // borde de la tarjeta — se ve como un rectángulo negro flotando. Con el punto a
  // menos de 40px del techo, la burbuja se dibuja ABAJO del punto en vez de arriba.
  const above = cy > 40
  const bubbleY = above ? cy - 38 : cy + 12
  return (
    <g>
      <circle cx={cx} cy={cy} r={6} fill="var(--c-accent)" stroke="var(--c-panel)" strokeWidth={3} />
      <foreignObject x={cx - w / 2} y={bubbleY} width={w} height={26}>
        <div className="w-full h-full flex items-center justify-center rounded-full bg-chrome text-white text-[11px] font-normal whitespace-nowrap px-2 shadow-md">
          {label}
        </div>
      </foreignObject>
    </g>
  )
}

// Todas las cotizaciones que el usuario puede sumar a la tarjeta — cada una con su
// "logo" (imagen, la que mandó el usuario): el ícono verde de dólar para todas las
// variantes USD, la bandera de la UE para EUR, el ícono naranja "R$" para BRL, y el
// badge de Bitcoin para BTC.
const FX_META: Record<string, { label: string; flag: string | null; flagType?: 'img' | 'emoji' }> = {
  MEP: { label: 'Dólar MEP', flag: currencyUsd, flagType: 'img' },
  CCL: { label: 'Contado con Liqui', flag: currencyUsd, flagType: 'img' },
  OFICIAL: { label: 'Dólar Oficial', flag: currencyUsd, flagType: 'img' },
  BLUE: { label: 'Dólar Blue', flag: currencyUsd, flagType: 'img' },
  CRIPTO: { label: 'Dólar Cripto', flag: currencyUsd, flagType: 'img' },
  EUR: { label: 'Euro', flag: flagEur, flagType: 'img' },
  BRL: { label: 'Real Brasileño', flag: currencyBrl, flagType: 'img' },
  BTC: { label: 'Bitcoin', flag: null },
}
const FX_ORDER = ['MEP', 'CCL', 'OFICIAL', 'BLUE', 'CRIPTO', 'EUR', 'BRL', 'BTC']
const FX_DEFAULT_SELECTED = ['MEP', 'CCL', 'EUR', 'BTC']

/** El logo real de Bitcoin (círculo naranja, "₿" blanca) — no el ícono de outline
 * genérico de lucide, que no se parece al de la referencia. */
function BitcoinBadge({ size = 36 }: { size?: number }) {
  return (
    <span
      className="rounded-full shrink-0 flex items-center justify-center text-white font-normal leading-none"
      style={{ width: size, height: size, background: '#f7931a', fontSize: size * 0.52 }}
    >
      ₿
    </span>
  )
}
const FX_STORAGE_KEY = 'financeos.cotizacion.selected'

function loadFxSelected(): string[] {
  try {
    const raw = localStorage.getItem(FX_STORAGE_KEY)
    if (!raw) return FX_DEFAULT_SELECTED
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.length ? parsed : FX_DEFAULT_SELECTED
  } catch { return FX_DEFAULT_SELECTED }
}

/**
 * Elegí qué monedas ver — popover con checkboxes, igual patrón que RowMenu (clic afuera
 * cierra). La selección se guarda en este navegador (localStorage), no en el server: es
 * una preferencia de vista, no un dato financiero.
 */
function FxPicker({ selected, onChange }: { selected: string[]; onChange: (next: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  function toggle(kind: string) {
    onChange(selected.includes(kind) ? selected.filter((k) => k !== kind) : [...selected, kind])
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-7 h-7 rounded-full flex items-center justify-center text-txt-3 hover:text-txt hover:bg-panel-2 transition-colors"
        title="Elegir monedas"
      >
        <SlidersHorizontal size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-panel border border-line rounded-[14px] shadow-lg py-1.5 z-20 overflow-hidden">
          {FX_ORDER.map((kind) => {
            const meta = FX_META[kind]
            const on = selected.includes(kind)
            return (
              <button
                key={kind}
                onClick={() => toggle(kind)}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-txt hover:bg-panel-2 transition-colors"
              >
                <span className={`w-4 h-4 rounded-[5px] border flex items-center justify-center shrink-0 ${on ? 'bg-accent border-accent' : 'border-line-2'}`}>
                  {on && <Check size={11} strokeWidth={3} className="text-black" />}
                </span>
                {meta.flagType === 'img' ? (
                  <img src={meta.flag!} alt="" className="w-4 h-4 rounded-full object-cover shrink-0" />
                ) : meta.flag ? (
                  <span className="text-[15px]">{meta.flag}</span>
                ) : (
                  <BitcoinBadge size={18} />
                )}
                <span className="flex-1 text-left">{meta.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}


// Anillo de progreso — el mismo lenguaje visual que las donas "75%"/"50%" del Figma,
// con el número real adentro (nunca inventado). El Figma le pone un glow de color
// detrás del trazo (filter: drop-shadow) — sin eso el anillo se ve chato y plano,
// que fue justo el reclamo: "se ve mal a comparación del Figma".
function Ring({ pct, color, id, size = 72 }: { pct: number; color: string; id: string; size?: number }) {
  // Proporciones calcadas del anillo original (72px): radio, grosor y tipografía
  // escalan todos igual para que uno grande (Ingreso/Egreso, Frame 33/34 del Figma)
  // no quede con un trazo desproporcionadamente fino ni un número minúsculo.
  const c2 = size / 2, r = size * 0.417, strokeW = size * 0.111, fontSize = size * 0.18
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, pct))
  const filterId = `ring-glow-${id}`
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="shrink-0 -rotate-90 overflow-visible">
      <defs>
        <filter id={filterId} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <circle cx={c2} cy={c2} r={r} fill="none" stroke="var(--c-track)" strokeWidth={strokeW} />
      <circle
        cx={c2} cy={c2} r={r} fill="none" stroke={color} strokeWidth={strokeW} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c - (clamped / 100) * c}
        filter={`url(#${filterId})`}
      />
      <text x={c2} y={c2} transform={`rotate(90 ${c2} ${c2})`} textAnchor="middle" dominantBaseline="central" className="fill-txt font-mono font-normal" style={{ fontSize }}>
        {Math.round(clamped)}%
      </text>
    </svg>
  )
}

export function Dashboard() {
  const { year } = useStore()
  const { data: dash, loading: ld, error: dashErr, refetch: dashRefetch } = useFetch<any>(`/analysis/dashboard?year=${year}`, [year])
  const { data: ins } = useFetch<any>(`/analysis/insights?year=${year}`, [year])
  const { data: health } = useFetch<any>('/analysis/health')
  const { data: cats } = useFetch<any[]>('/categories')
  const { data: accts } = useFetch<any[]>('/accounts')
  const { data: fx } = useFetch<any>('/fx')
  const { data: budgets } = useFetch<any[]>('/budgets')
  const projects = (budgets ?? []).filter((b: any) => b.type === 'PROJECT')
  const [quickAdd, setQuickAdd] = useState<false | 'INCOME' | 'EXPENSE'>(false)
  const [savingMov, setSavingMov] = useState(false)
  const [fxSelected, setFxSelected] = useState<string[]>(loadFxSelected)
  useEffect(() => {
    try { localStorage.setItem(FX_STORAGE_KEY, JSON.stringify(fxSelected)) } catch { /* modo privado, etc. */ }
  }, [fxSelected])

  // Categorías: "Año" usa el desglose que ya trae /analysis/dashboard (con conversión de
  // USD incluida). "Mes" y "Semana" se recalculan acá con los movimientos reales de esa
  // ventana — no hay endpoint para eso todavía, así que se arma con la misma regla de
  // conversión que usa el backend (ARS tal cual, USD según la cotización del día, otras
  // monedas sin cotización real se dejan afuera en vez de sumarlas como si fueran pesos).
  const [catPeriod, setCatPeriod] = useState<'week' | 'month' | 'year'>('month')
  const [catData, setCatData] = useState<{ name: string; color: string; amount: number }[] | null>(null)
  const [catLoading, setCatLoading] = useState(false)
  useEffect(() => {
    if (catPeriod === 'year') { setCatData(null); return }
    let cancelled = false
    setCatLoading(true)
    const now = new Date()
    const from = catPeriod === 'week'
      ? new Date(now.getTime() - 6 * 86400000)
      : new Date(now.getFullYear(), now.getMonth(), 1)
    api<{ items: any[] }>(`/movements?type=EXPENSE&from=${from.toISOString().slice(0, 10)}&to=${now.toISOString().slice(0, 10)}&pageSize=200`)
      .then((res) => {
        if (cancelled) return
        const totals: Record<string, { name: string; color: string; amount: number }> = {}
        for (const m of res.items ?? []) {
          if (!m.category) continue
          const cur = m.currency || 'ARS'
          const amt = cur === 'ARS' ? Number(m.amount) : cur === 'USD' && fx?.rate ? Number(m.amount) * fx.rate : null
          if (amt === null) continue
          totals[m.categoryId] ??= { name: m.category.name, color: m.category.color, amount: 0 }
          totals[m.categoryId].amount += amt
        }
        setCatData(Object.values(totals).sort((a, b) => b.amount - a.amount).slice(0, 10))
      })
      .catch(() => { if (!cancelled) setCatData([]) })
      .finally(() => { if (!cancelled) setCatLoading(false) })
    return () => { cancelled = true }
  }, [catPeriod, fx?.rate])

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

  // Lo más importante primero: alerta > atención > el resto, en el orden que ya viene.
  const insightsList: any[] = ins?.insights || []
  const topInsight =
    insightsList.find((i) => i.severity === 'alert') ??
    insightsList.find((i) => i.severity === 'warning') ??
    insightsList[0]

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
        {/* ── Fila 1: Balance Total | Evolución de Ahorro | Salud financiera + Tus Cuentas ──
            Apilado en ventana angosta, 2 columnas a partir de md, las 3 juntas recién
            en xl — así se ve bien tanto en una mitad de pantalla como maximizada. */}
        {/* xl:items-start — sin esto, las 3 columnas se estiran parejo a la más alta
            (la de Salud+Cuentas, que crece con la cantidad de cuentas), y Balance Total
            queda con un hueco enorme en el medio. Con items-start cada columna mide lo
            que su propio contenido pide; min-h-[300px] en Balance Total y Evolución
            (abajo) las empareja entre sí, sin depender de lo que haga la tercera. */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[1fr_1fr_380px] gap-4 xl:items-start">
          <div
            className="relative rounded-card p-6 flex flex-col justify-between overflow-hidden xl:min-h-[300px]"
            style={{ background: 'var(--c-accent)', boxShadow: '0 16px 40px -12px rgba(0,255,107,.45)' }}
          >
            {/* Glow suave arriba a la derecha — el mismo lenguaje "con vida" que los
                anillos de Ingreso/Egreso/Salud, para que la tarjeta hero no quede
                plana al lado de todo lo demás que ya tiene ese brillo. */}
            <div
              className="absolute -top-16 -right-16 w-56 h-56 rounded-full pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(255,255,255,.35) 0%, transparent 70%)' }}
            />
            <div className="relative flex items-start justify-between">
              <div>
                <div className="text-title text-black/65">Balance Total</div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-hero text-black tabular-nums">{ARS(p.neto)}</span>
                  <span className="text-[11px] font-normal text-black/60 bg-black/10 px-2 py-0.5 rounded-full">ARS</span>
                </div>
              </div>
              <Link to="/cuentas" className="w-10 h-10 rounded-full bg-black/10 hover:bg-black/15 flex items-center justify-center text-black shrink-0 transition-colors">
                <Plus size={18} strokeWidth={2.4} />
              </Link>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setQuickAdd('INCOME')} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full bg-white text-black text-[14px] font-medium hover:bg-white/90 transition-colors">
                Ingresar <ArrowDownToLine size={15} strokeWidth={2.4} />
              </button>
              <button onClick={() => setQuickAdd('EXPENSE')} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full bg-chrome text-white text-[14px] font-medium hover:bg-chrome-2 transition-colors">
                Egresar <ArrowUpFromLine size={15} strokeWidth={2.4} />
              </button>
            </div>
          </div>

          <Card className="xl:min-h-[300px]">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-title">Evolución de Ahorro</h3>
              <div className="flex items-center gap-2">
                {curMonth && (
                  <span className="flex items-center gap-1 bg-success-dim text-success text-[11px] font-medium px-2.5 py-1 rounded-full">
                    {monthIncome >= monthExpense ? '▲' : '▼'} {monthTotal > 0 ? Math.round(Math.abs(monthIncome - monthExpense) / monthTotal * 100) : 0}%
                  </span>
                )}
                {/* Tag "Mensual" — el curso de ahorro que arma el backend es siempre por
                    mes (dash.months), así que el tag dice lo que la data realmente es en
                    vez de prometer un corte semanal que todavía no existe. */}
                <span className="flex items-center gap-1 bg-panel-2 text-txt-2 text-[11px] font-medium px-2.5 py-1 rounded-full">
                  Mensual
                </span>
              </div>
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
                  {/* En el Figma la línea es negra (el color de texto) con el relleno
                      verde debajo — no la línea verde que tenía antes. El último punto
                      lleva la burbuja flotante con el valor, como el "+ $1.060" del
                      Figma, en vez de que el usuario tenga que pasar el mouse para verlo. */}
                  <Area
                    type="monotone" dataKey="ahorro" stroke="var(--c-txt)" strokeWidth={2.5} fill="url(#goldGrad)"
                    dot={(props: any) => <SavingsDot {...props} lastIndex={chartData.length - 1} />}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[160px] flex flex-col items-center justify-center gap-2 text-center">
                <span className="w-10 h-10 rounded-full bg-panel-2 text-txt-3 flex items-center justify-center text-lg">📈</span>
                <p className="text-txt-3 text-[13px]">Cargá movimientos para ver la curva.</p>
              </div>
            )}
          </Card>

          {/* Tus Cuentas ya vive en /cuentas — tenerla acá también, apilada abajo de
              Salud Financiera, dejaba un hueco vacío grande en esta columna cuando
              tenía pocas cuentas (la columna quedaba mucho más corta que Balance
              Total/Evolución, que tienen alto fijo). Con Salud Financiera sola y
              estirada a esa misma altura, no queda espacio en blanco. */}
          {health ? (
            <CompactHealthCard health={health} className="xl:h-[300px]" />
          ) : (
            <Card className="xl:h-[300px]" />
          )}
        </div>

        {/* ── Fila 2: Ingreso | Egreso | Cotización  +  Análisis IA ──
            xl:items-start + xl:h-[280px] parejo en las 4 — sin esto, Cotización (que
            crece con la cantidad de monedas elegidas) o Análisis IA (texto variable)
            estiran a Ingreso/Egreso, que quedan con un hueco enorme en el medio. Con
            alto fijo la fila no se reacomoda sola cuando cambia el contenido — lo que
            no entra en Cotización scrollea adentro de la tarjeta, no la agranda. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_380px] gap-4 xl:items-start">
          {/* Ingreso/Egreso: ícono + label + monto apilados a la izquierda, anillo grande
              con glow centrado verticalmente a la derecha — calcado del Figma (Frame
              33/34): ahí el anillo ocupa casi todo el alto de la tarjeta, no solo la
              fila de arriba, así que la columna de la izquierda y el anillo van uno al
              lado del otro en una sola fila que se estira a lo alto. */}
          <Card className="flex items-center justify-between gap-4 xl:h-[280px]">
            <div className="flex flex-col gap-3 min-w-0">
              <img src={ingresoBadge} alt="" className="w-11 h-11 shrink-0" />
              <span className="text-[17px] font-medium text-txt">Ingreso</span>
              <div className="font-normal text-[32px] leading-none tabular-nums">{ARS(monthIncome)}</div>
            </div>
            <Ring id="income" pct={incomePct} color="var(--c-success)" size={132} />
          </Card>

          <Card className="flex items-center justify-between gap-4 xl:h-[280px]">
            <div className="flex flex-col gap-3 min-w-0">
              <img src={egresoBadge} alt="" className="w-11 h-11 shrink-0" />
              <span className="text-[17px] font-medium text-txt">Egreso</span>
              <div className="font-normal text-[32px] leading-none tabular-nums">{ARS(monthExpense)}</div>
            </div>
            <Ring id="expense" pct={expensePct} color="var(--c-danger)" size={132} />
          </Card>

          <Card className="xl:h-[280px] xl:flex xl:flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-title">Cotización</h3>
              <FxPicker selected={fxSelected} onChange={setFxSelected} />
            </div>
            {fx?.quotes?.length > 0 ? (
              <div className="flex flex-col gap-3.5 xl:flex-1 xl:overflow-y-auto xl:pr-1">
                {fx.quotes
                  .filter((q: any) => fxSelected.includes(q.kind))
                  .sort((a: any, b: any) => FX_ORDER.indexOf(a.kind) - FX_ORDER.indexOf(b.kind))
                  .map((q: any) => {
                    const meta = FX_META[q.kind] ?? { label: q.kind, flag: currencyUsd, flagType: 'img' as const }
                    return (
                      <div key={q.kind} className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          {meta.flagType === 'img' ? (
                            <img src={meta.flag!} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                          ) : meta.flag ? (
                            <span className="w-9 h-9 rounded-full overflow-hidden shrink-0 text-[19px] flex items-center justify-center bg-panel-2">
                              {meta.flag}
                            </span>
                          ) : (
                            <BitcoinBadge size={36} />
                          )}
                          <div>
                            <div className="text-[13.5px] font-medium leading-tight">{meta.label}</div>
                            <div className="text-[10.5px] text-txt-3">{q.kind}</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-normal text-[15px] tabular-nums leading-tight">{ARS(q.sell ?? q.buy ?? 0)}</div>
                          {typeof q.changePct === 'number' && (
                            <div className={`text-[11px] font-medium ${q.changePct >= 0 ? 'text-success' : 'text-danger'}`}>
                              {q.changePct >= 0 ? '▲' : '▼'} {Math.abs(q.changePct)}%
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                {fxSelected.every((k) => !fx.quotes.some((q: any) => q.kind === k)) && (
                  <p className="text-txt-3 text-[12.5px]">Ninguna de tus monedas elegidas tiene cotización todavía.</p>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2.5 text-txt-3 text-sm">
                <span className="w-9 h-9 rounded-full bg-panel-2 flex items-center justify-center shrink-0">
                  <DollarSign size={16} strokeWidth={2.4} />
                </span>
                Sin cotización todavía.
              </div>
            )}
          </Card>

          <Card highlight className="flex flex-col xl:h-[280px]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-title text-accent-2">Análisis IA</h3>
            </div>
            {/* Solo lo más importante acá — el resto vive en /insights. Antes esta
                tarjeta se estiraba con hasta 4 ítems y desbalanceaba la fila. Si el
                texto es largo, scrollea adentro (xl:overflow-y-auto) en vez de estirar
                la tarjeta — el alto de la fila 2 no depende del contenido. */}
            {topInsight ? (
              <p className="flex-1 text-[13px] text-txt-2 leading-relaxed xl:overflow-y-auto">
                <span className="text-accent-2 mr-1">›</span>{topInsight.text}
              </p>
            ) : (
              <p className="flex-1 text-txt-3 text-[13px]">Cargá movimientos para ver análisis.</p>
            )}
            <div className="flex flex-col gap-1.5 mt-3 pt-3 border-t border-accent-line/40">
              <Link to="/insights" className="flex items-center gap-1 text-[12.5px] text-info font-medium hover:underline">
                Ver análisis completo <ChevronRight size={13} />
              </Link>
            </div>
          </Card>
        </div>

        {/* ── Fila 3: Últimos movimientos  +  Categorías ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
          <Card>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-title">Últimos Movimientos</h3>
              <div className="flex items-center gap-1.5">
                {/* Solo los íconos de filtro/orden de la referencia — sin "Ver todos".
                    El filtrado/orden real vive en /movimientos; acá solo llevan ahí. */}
                <Link to="/movimientos" className="w-9 h-9 rounded-full flex items-center justify-center text-txt-3 hover:text-txt hover:bg-panel-2 transition-colors" title="Filtrar">
                  <Filter size={18} />
                </Link>
                <Link to="/movimientos" className="w-9 h-9 rounded-full flex items-center justify-center text-txt-3 hover:text-txt hover:bg-panel-2 transition-colors" title="Ordenar">
                  <ArrowUpNarrowWide size={18} />
                </Link>
              </div>
            </div>
            {dash.recent.length ? (
              <>
                <MovementsHeader />
                {/* Solo los últimos 4 acá — es un resumen, no la tabla completa. Para
                    ver todo está el link "Ver todos" (o el ícono de filtro/orden) que
                    lleva a /movimientos. */}
                {dash.recent.slice(0, 4).map((m: any) => <MovementRow key={m.id} m={m} />)}
              </>
            ) : <EmptyState icon="💸" title="Sin movimientos" />}
          </Card>

          <Card>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-title">Categorías</h3>
              {/* Tag Semana/Mes/Año — segmented control, mismo lenguaje que el "Week ⌄"
                  de la referencia pero con las 3 ventanas reales que la app puede armar. */}
              <div className="flex items-center gap-0.5 bg-panel-2 rounded-full p-0.5">
                {([['week', 'Semana'], ['month', 'Mes'], ['year', 'Año']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setCatPeriod(key)}
                    className={`text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors ${
                      catPeriod === key ? 'bg-panel text-txt shadow-sm' : 'text-txt-3 hover:text-txt'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {(() => {
              const categories = catPeriod === 'year' ? dash.categories : (catData ?? [])
              if (catLoading && catPeriod !== 'year') {
                return <div className="h-[128px] flex items-center justify-center text-txt-3 text-[13px]">Cargando…</div>
              }
              return categories.length > 0 ? (
                <>
                  <div className="mb-3">
                    <span className="font-mono text-[13px] font-medium text-txt">
                      Total: {ARS(categories.reduce((s: number, c: any) => s + c.amount, 0))}
                    </span>
                  </div>
                  {/* Sin leyenda al lado (legend=false): el detalle de cada categoría se
                      ve tocándola, adentro del círculo — así el alto de la tarjeta no
                      depende de cuántas categorías haya (una lista de 3 o de 30 category
                      ocupa lo mismo: nada, porque no hay lista). Más grande que antes
                      (128 → 220) porque ahora tiene toda la tarjeta para él solo. */}
                  <InteractiveDonut size={220} legend={false} slices={categories.map((c: any) => ({ name: c.name, value: c.amount, color: c.color }))} />
                </>
              ) : (
                <EmptyState icon="🏷️" title="Sin gastos categorizados" />
              )
            })()}
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

