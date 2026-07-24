import { useState } from 'react'
import { toMovementArray, sortByDateDesc, sumInOut } from '@/lib/movements'
import { useStore } from '@/lib/store'
import { useFetch } from '@/hooks/useFetch'
import { ARS, MONTHS, pct, healthHex } from '@/lib/format'
import { TopBar } from '@/components/layout/TopBar'
import { Card, Gauge, MovementRow, CategoryBar, Button, EmptyState, AsyncGate } from '@/components/ui'

export function Meses() {
  const { year } = useStore()
  const { data: dash, loading, error, refetch } = useFetch<any>(`/analysis/dashboard?year=${year}`, [year])
  const [detail, setDetail] = useState<number | null>(null)

  if (loading && !dash) return <AsyncGate title="Meses" />
  if (!dash) return <AsyncGate title="Meses" error={error} onRetry={refetch} />
  if (detail !== null) return <MesDetalle month={detail} year={year} onBack={() => setDetail(null)} />

  return (
    <>
      <TopBar title="Vista anual por meses" sub={`${year}`} />
      <div className="p-7 animate-fade-in">
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {dash.months.map((m: any) => {
            const has = m.income || m.expense
            const p = pct(m.expense, m.income)
            const col = healthHex(p, has)
            return (
              <div
                key={m.month}
                onClick={() => setDetail(m.month)}
                className={`bg-panel border border-line rounded-card p-4 cursor-pointer transition-all hover:border-line-2 hover:-translate-y-0.5 flex items-center gap-4 ${!has ? 'opacity-40 hover:opacity-70' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm mb-2.5">{MONTHS[m.month]}</div>
                  {has ? (
                    <>
                      <div className="flex justify-between text-xs mb-1"><span className="text-txt-3">Ingresos</span><span className="font-mono font-semibold text-success">{ARS(m.income)}</span></div>
                      <div className="flex justify-between text-xs mb-1"><span className="text-txt-3">Gastos</span><span className="font-mono font-semibold text-danger">{ARS(m.expense)}</span></div>
                      <div className="flex justify-between text-xs"><span className="text-txt-3">Ahorro</span><span className={`font-mono font-semibold ${m.balance >= 0 ? 'text-success' : 'text-danger'}`}>{ARS(m.balance)}</span></div>
                    </>
                  ) : <div className="text-xs text-txt-3">Sin movimientos</div>}
                </div>
                <Gauge pct={has ? p : 0} color={col} />
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

function MesDetalle({ month, year, onBack }: { month: number; year: number; onBack: () => void }) {
  const { data, loading, error, refetch } = useFetch<any>(`/movements?year=${year}&month=${month}`, [year, month])

  if (loading && !data) return <AsyncGate title={MONTHS[month]} />
  if (!data) return <AsyncGate title={MONTHS[month]} error={error} onRetry={refetch} />

  // El endpoint puede devolver un array plano o un objeto { items }. Se normaliza a array
  // SIEMPRE (era la causa del "Algo se rompió en esta pantalla"). Lógica en lib/movements.
  const movs: any[] = toMovementArray(data)

  const { income: inc, expense: exp, balance: bal } = sumInOut(movs)
  const p = pct(exp, inc)
  const cats: Record<string, { color: string; amount: number }> = {}
  movs.filter((m) => m.type === 'EXPENSE').forEach((m) => {
    const n = m.category?.name || 'Sin categoría'
    const c = m.category?.color || '#71717A'
    cats[n] = cats[n] || { color: c, amount: 0 }
    cats[n].amount += Number(m.amount)
  })
  const sorted = Object.entries(cats).sort((a, b) => b[1].amount - a[1].amount)
  const totC = sorted.reduce((s, [, v]) => s + v.amount, 0)

  // Orden por fecha sin mutar y tolerando fechas no-string. Lógica en lib/movements.
  const movsOrdenados = sortByDateDesc(movs)

  return (
    <>
      <TopBar title={`${MONTHS[month]} ${year}`} sub="Detalle del mes" />
      <div className="p-7 animate-fade-in">
        <button onClick={onBack} className="flex items-center gap-1.5 text-txt-2 text-sm mb-4 hover:text-txt transition-colors">← Meses</button>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Card><div className="text-[11px] font-semibold uppercase text-txt-3 mb-2">Ingresos</div><div className="text-xl font-bold font-mono text-success">{ARS(inc)}</div></Card>
          <Card><div className="text-[11px] font-semibold uppercase text-txt-3 mb-2">Egresos</div><div className="text-xl font-bold font-mono text-danger">{ARS(exp)}</div></Card>
          <Card><div className="text-[11px] font-semibold uppercase text-txt-3 mb-2">Balance</div><div className={`text-xl font-bold font-mono ${bal >= 0 ? 'text-success' : 'text-danger'}`}>{ARS(bal)}</div></Card>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <h3 className="text-sm font-semibold mb-4">Categorías</h3>
            <div className="flex items-center gap-5 mb-5">
              <Gauge pct={p} size={100} stroke={11} color={healthHex(p, true)} />
              <div>
                <div className="text-xs text-txt-3">{bal >= 0 ? 'Ahorraste' : 'Te pasaste'}</div>
                <div className={`font-mono text-lg font-bold ${bal >= 0 ? 'text-success' : 'text-danger'}`}>{ARS(Math.abs(bal))}</div>
              </div>
            </div>
            {sorted.map(([name, data]) => (
              <CategoryBar key={name} name={name} color={data.color} amount={data.amount} pct={totC > 0 ? (data.amount / totC) * 100 : 0} />
            ))}
            <div className="flex gap-2.5 mt-5">
              <Button variant="primary" onClick={() => printTicket(movs, month, year)}>Exportar PDF</Button>
            </div>
          </Card>
          <Card>
            <h3 className="text-sm font-semibold mb-3">Movimientos ({movs.length})</h3>
            <div className="max-h-[500px] overflow-y-auto">
              {movsOrdenados.map((m: any) => <MovementRow key={m.id} m={m} />)}
              {!movs.length && <EmptyState icon="📝" title="Sin movimientos" />}
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}

function printTicket(movs: any[], month: number, year: number) {
  let inc = 0, exp = 0
  movs.forEach((m) => (m.type === 'INCOME' ? (inc += Number(m.amount)) : (exp += Number(m.amount))))
  const w = window.open('', '_blank', 'width=500,height=700')
  if (!w) return
  w.document.write(`<html><head><title>Ticket ${MONTHS[month]} ${year}</title><style>*{margin:0;padding:0;box-sizing:border-box;font-family:'SF Mono',Consolas,monospace;font-size:13px}body{background:#fbfaf7;color:#1a1a17;padding:30px}.c{text-align:center}.b{font-family:sans-serif;font-weight:800;font-size:18px;letter-spacing:.14em}.t{font-size:10px;letter-spacing:.3em;color:#55524a;margin-top:5px;text-transform:uppercase}.m{font-family:sans-serif;font-size:20px;font-weight:700;margin-top:12px}.d{border-top:1.5px dashed #c9c4b6;margin:14px 0}.s{font-family:sans-serif;font-size:10px;font-weight:700;letter-spacing:.12em;color:#8a8578;text-transform:uppercase;margin:4px 0 8px}.r{display:flex;justify-content:space-between;padding:2px 0}.r b{font-weight:600}.big{display:flex;justify-content:space-between;font-family:sans-serif;font-size:16px;font-weight:800;padding:7px 0}.pos{color:#2f8f52}.neg{color:#c0463f}.f{text-align:center;font-size:9px;color:#a8a294;margin-top:14px;font-family:sans-serif}</style></head><body>`)
  w.document.write(`<div class="c"><div class="b">FINANCE<span style="color:#d4a53a">.</span>OS</div><div class="t">Ticket mensual</div><div class="m">${MONTHS[month]} ${year}</div></div><hr class="d">`)
  w.document.write(`<div class="s">Ingresos</div>`)
  movs.filter((m) => m.type === 'INCOME').forEach((m) => w.document.write(`<div class="r"><span>${m.description}</span><b>${ARS(Number(m.amount))}</b></div>`))
  w.document.write(`<div class="r"><b>Total</b><b class="pos">${ARS(inc)}</b></div><hr class="d"><div class="s">Egresos</div>`)
  movs.filter((m) => m.type === 'EXPENSE').forEach((m) => w.document.write(`<div class="r"><span>${m.description}</span><b>${ARS(Number(m.amount))}</b></div>`))
  w.document.write(`<div class="r"><b>Total</b><b class="neg">${ARS(exp)}</b></div><hr class="d">`)
  w.document.write(`<div class="big"><span>Restante</span><span class="${inc - exp >= 0 ? 'pos' : 'neg'}">${ARS(inc - exp)}</span></div>`)
  w.document.write(`<div class="f">Finance OS · resumen del mes</div></body></html>`)
  w.document.close()
  setTimeout(() => w.print(), 200)
}
