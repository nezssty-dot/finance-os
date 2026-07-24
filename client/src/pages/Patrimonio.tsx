import { useStore } from '@/lib/store'
import { useFetch } from '@/hooks/useFetch'
import { ARS, money, MONTHS_SHORT } from '@/lib/format'
import { TopBar } from '@/components/layout/TopBar'
import { WealthCard, Card, Badge, EmptyState, AsyncGate } from '@/components/ui'
const CLASSES = [
  { key: 'pesos', label: 'Pesos', color: '#d4a53a' },
  { key: 'usd', label: 'USD', color: '#5bbf7a' },
  { key: 'crypto', label: 'Cripto', color: '#e7bd52' },
  { key: 'stocks', label: 'Acciones', color: '#7aa2d9' },
  { key: 'funds', label: 'Fondos', color: '#a2a2aa' },
]

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

export function Patrimonio() {
  const { year } = useStore()
  const { data: cur, error: e1, refetch: r1 } = useFetch<any>('/patrimonio/current')
  const { data: hist, error: e2, refetch: r2 } = useFetch<any>(`/patrimonio/history?period=month&year=${year}`, [year])

  if (!cur || !hist) {
    const error = e1 || e2
    return <AsyncGate title="Patrimonio" error={error} onRetry={error ? () => { r1(); r2() } : undefined} />
  }

  const chartData = hist.history.map((h: any) => {
    const [, m] = h.period.split('-')
    return { name: MONTHS_SHORT[parseInt(m) - 1] || h.period, balance: h.balance, cumulative: h.cumulative }
  })

  // Distribución solo sobre cuentas en ARS: repartir un total que mezcle monedas no
  // tendría sentido. Las cuentas en dólares se muestran por separado.
  const arsAccounts = (cur.accounts as any[]).filter((a) => a.currency === 'ARS' && a.balance !== 0)
  const usdAccounts = (cur.accounts as any[]).filter((a) => a.currency !== 'ARS')
  const disponibleARS = arsAccounts.reduce((s, a) => s + a.balance, 0)

  return (
    <>
      <TopBar title="Patrimonio" sub="Evolución y desglose" />
      <div className="p-7 animate-fade-in">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
          <WealthCard label="Patrimonio Neto" value={cur.neto} hero />
          <WealthCard label="Disponible" value={cur.disponible} sub={`${cur.accounts.length} cuentas`} />
          <WealthCard label="Invertido" value={cur.invertido} sub={`${cur.investments.length} inversiones`} />
          <WealthCard label="Deudas" value={cur.deudas} />
          <WealthCard label="Por cobrar" value={cur.porCobrar} />
        </div>

        {cur.fx?.rate != null && (
          <div className="mb-4 flex items-center justify-between px-4 py-3 rounded-[12px] bg-panel-2 border border-line">
            <div className="flex items-baseline gap-4 flex-wrap">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-txt-3">Patrimonio ARS</div>
                <div className="font-mono font-bold text-[17px]">{money(cur.fx.totalARS ?? cur.neto, 'ARS')}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-txt-3">Patrimonio USD</div>
                <div className="font-mono font-bold text-[17px] text-gold-2">{money(cur.fx.totalUSD ?? 0, 'USD')}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-txt-3">
                Dólar {cur.fx.kind === 'MEP' ? 'MEP' : cur.fx.kind}
              </div>
              <div className="font-mono text-[13px]">{money(cur.fx.rate, 'ARS')}</div>
              {cur.fx.stale && <div className="text-[10px] text-txt-3 mt-0.5">cotización de días previos</div>}
            </div>
          </div>
        )}
        {cur.fx && cur.fx.rate == null && (
          <div className="mb-4 px-4 py-3 rounded-[12px] bg-panel-2 border border-line text-[12px] text-txt-3">
            Sin cotización del dólar todavía — los montos se muestran en su moneda original.
            Se actualiza sola cuando haya conexión.
          </div>
        )}
        {cur.fx?.rate != null && cur.fx.complete === false && (
          <div className="mb-4 px-4 py-2.5 rounded-[10px] border border-line text-[11px] text-txt-3">
            Hay montos en monedas sin cotización: el total convertido está incompleto.
          </div>
        )}

        {arsAccounts.length > 0 && disponibleARS > 0 && (
          <Card className="mb-4">
            <h3 className="text-sm font-semibold mb-3">Dónde está tu plata (cuentas en ARS)</h3>
            <div className="space-y-2.5">
              {arsAccounts.map((a: any) => {
                const share = disponibleARS !== 0 ? (a.balance / disponibleARS) * 100 : 0
                return (
                  <div key={a.id}>
                    <div className="flex items-center justify-between mb-1 text-[13px]">
                      <span className="font-medium">{a.name}</span>
                      <span className="text-txt-3">
                        <b className="text-txt font-mono">{ARS(a.balance)}</b> · {Math.round(share)}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-panel-2 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.max(0, Math.min(100, share))}%`,
                          background: share < 0 ? '#d9615c' : '#c7a93c',
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
            {usdAccounts.length > 0 && (
              <p className="text-[11.5px] text-txt-3 mt-3">
                + {usdAccounts.length} cuenta{usdAccounts.length === 1 ? '' : 's'} en dólares
                (se muestran aparte porque no se mezclan monedas).
              </p>
            )}
          </Card>
        )}

        {cur.invertido > 0 && (
          <Card className="mb-4">
            <h3 className="text-sm font-semibold mb-3">Cómo está invertido</h3>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {CLASSES.map((c) => {
                const v = cur.breakdown[c.key] ?? 0
                const pct = cur.invertido > 0 ? Math.round((v / cur.invertido) * 100) : 0
                return (
                  <div key={c.key} className="bg-panel-2 rounded-[11px] p-3 border border-line">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />
                      <span className="text-[10.5px] font-semibold uppercase tracking-wider text-txt-3">{c.label}</span>
                    </div>
                    <div className="font-mono font-bold text-[14px]">{ARS(v)}</div>
                    <div className="text-[10.5px] text-txt-3 mt-0.5">{pct}% del total</div>
                  </div>
                )
              })}
            </div>
          </Card>
        )}

        {chartData.length > 0 && (
          <Card className="mb-4">
            <h3 className="text-sm font-semibold mb-3">Balance mensual {year}</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6a6a74' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#6a6a74' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${(v / 1e6).toFixed(1)}M`} width={42} />
                <Tooltip
                  cursor={{ fill: 'rgba(212,165,58,0.08)' }}
                  contentStyle={{ background: '#131316', border: '1px solid #242428', borderRadius: 10, fontSize: 13 }}
                  labelStyle={{ color: '#ededed', fontWeight: 600, marginBottom: 2 }}
                  itemStyle={{ color: '#ededed' }}
                  formatter={(v: number) => [ARS(v), 'Balance']}
                />
                <Bar dataKey="balance" radius={[4, 4, 0, 0]}>
                  {chartData.map((d: any, i: number) => <Cell key={i} fill={d.balance >= 0 ? '#5bbf7a' : '#d9615c'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <h3 className="text-sm font-semibold mb-3">Cuentas</h3>
            {cur.accounts.length ? cur.accounts.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between py-2.5 border-b border-bg-2 last:border-0">
                <div className="flex items-center gap-2"><span className="font-semibold text-[13px]">{a.name}</span><Badge>{a.type}</Badge></div>
                <span className="font-mono font-bold text-sm">{money(a.balance, a.currency)}</span>
              </div>
            )) : <EmptyState icon="🏦" title="Sin cuentas" />}
          </Card>
          <Card>
            <h3 className="text-sm font-semibold mb-3">Deudas y por cobrar</h3>
            {cur.debts.length ? cur.debts.map((d: any) => (
              <div key={d.id} className="flex items-center justify-between py-2.5 border-b border-bg-2 last:border-0">
                <div className="flex items-center gap-2"><span className="font-semibold text-[13px]">{d.name}</span><Badge color={d.kind === 'OWED' ? '#5bbf7a' : '#d9615c'}>{d.kind === 'OWE' ? 'Debo' : 'Me deben'}</Badge></div>
                <div className="text-right">
                  <span className={`font-mono font-bold text-sm ${d.kind === 'OWED' ? 'text-success' : 'text-danger'}`}>{ARS(d.outstanding)}</span>
                  {d.paid > 0 && <div className="text-[10px] text-txt-3">de {ARS(d.amount)}</div>}
                </div>
              </div>
            )) : <EmptyState icon="📋" title="Sin deudas" />}
          </Card>
        </div>
      </div>
    </>
  )
}
