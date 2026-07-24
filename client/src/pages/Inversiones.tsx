import { useState } from 'react'
import { useFetch } from '@/hooks/useFetch'
import { money } from '@/lib/format'
import { api } from '@/lib/api'
import { TopBar } from '@/components/layout/TopBar'
import { WealthCard, Card, Button, Modal, Input, Select, Badge, EmptyState, AsyncGate } from '@/components/ui'

const KINDS = ['PESOS', 'USD', 'USDT', 'BTC', 'ETH', 'STOCK', 'FUND', 'FIXED_TERM'] as const

// Un color por tipo de activo, para el desglose de la cartera.
const TYPE_COLORS: Record<string, string> = {
  'Acciones': '#d4a53a',
  'CEDEARs': '#5b9bd4',
  'Bonos': '#5bbf7a',
  'Renta fija': '#7a9a5b',
  'ETF': '#b06fd4',
  'Crypto': '#d4915b',
  'Efectivo': '#8a8a8a',
  'Otro': '#6a6a6a',
}

interface InvItem {
  id: string; ticker?: string; name: string; kind: string; currency: string
  quantity: number | null; capital: number; currentValue: number
  gain: number; pct: number; source?: string
}
interface BreakdownGroup { type: string; value: number; pct: number; count: number }

export function Inversiones() {
  const { data, loading, error, refetch } = useFetch<{ items: InvItem[]; breakdown: BreakdownGroup[] }>("/investments")
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  if (loading && !data) return <AsyncGate title="Inversiones" />
  if (!data) return <AsyncGate title="Inversiones" error={error} onRetry={refetch} />

  const invs = data.items ?? []
  const breakdown = data.breakdown ?? []

  // Totales por moneda: nunca se suma ARS con USD. La tarjeta principal es en pesos; si hay
  // inversiones en dólares, aparecen en su propia tarjeta.
  const byCurrency: Record<string, { value: number; capital: number }> = {}
  for (const i of invs) {
    const c = i.currency || 'ARS'
    byCurrency[c] = byCurrency[c] || { value: 0, capital: 0 }
    byCurrency[c].value += i.currentValue
    byCurrency[c].capital += i.capital
  }
  const currencies = Object.keys(byCurrency).sort((c) => (c === 'ARS' ? -1 : 1))
  const syncedCount = invs.filter((i) => i.source === 'IOL').length

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    const fd = new FormData(e.currentTarget)
    try {
      await api('/investments', { method: 'POST', body: {
        name: fd.get('name'), kind: fd.get('kind'), currency: fd.get('currency'),
        capital: Number(fd.get('capital')), currentValue: Number(fd.get('currentValue') || fd.get('capital')),
        quantity: fd.get('quantity') ? Number(fd.get('quantity')) : undefined,
      }})
      setOpen(false); refetch()
    } catch (e: any) { alert(e.message) }
    setSaving(false)
  }

  return (
    <>
      <TopBar title="Inversiones" sub="Registrar y seguir inversiones" />
      <div className="p-7 animate-fade-in">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          {currencies.length === 0 ? (
            <WealthCard label="Total invertido" value={0} />
          ) : (
            currencies.map((c, idx) => {
              const t = byCurrency[c]
              const gain = t.value - t.capital
              return (
                <WealthCard
                  key={c}
                  label={c === 'ARS' ? 'Total invertido' : `Invertido ${c}`}
                  value={t.value}
                  currency={c}
                  hero={idx === 0}
                  sub={`Ganancia ${gain >= 0 ? '+' : ''}${money(gain, c)}`}
                />
              )
            })
          )}
        </div>
        <div className="mb-4 flex items-center gap-3">
          <Button variant="primary" onClick={() => setOpen(true)}>+ Nueva inversión</Button>
          {syncedCount > 0 && (
            <span className="text-[12px] text-txt-3">
              {syncedCount} {syncedCount === 1 ? 'posición sincronizada' : 'posiciones sincronizadas'} de IOL
            </span>
          )}
        </div>
        {breakdown.length > 0 && (
          <Card className="mb-4">
            <h3 className="text-sm font-semibold mb-3">Distribución por tipo</h3>
            <div className="space-y-2.5">
              {breakdown.map((b) => {
                const color = TYPE_COLORS[b.type] ?? '#8a8a8a'
                return (
                  <div key={b.type}>
                    <div className="flex items-center justify-between text-[12px] mb-1">
                      <span className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                        <span className="font-medium">{b.type}</span>
                        <span className="text-txt-3">({b.count})</span>
                      </span>
                      <span className="font-mono text-txt-2">{b.pct}%</span>
                    </div>
                    <div className="h-2 bg-track rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${b.pct}%`, background: color }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>
        )}
        <Card>
          <h3 className="text-sm font-semibold mb-3">Mis inversiones</h3>
          {invs.length ? invs.map((i) => {
            const g = i.currentValue - i.capital
            const p = i.capital > 0 ? ((g / i.capital) * 100).toFixed(1) : '0'
            const synced = i.source === 'IOL'
            return (
              <div key={i.id} className="flex items-center gap-3 py-3 border-b border-bg-2 last:border-0">
                <div className="w-9 h-9 rounded-[9px] bg-gold-dim text-gold-2 flex items-center justify-center text-[10px] font-bold shrink-0">{String(i.kind).slice(0, 3)}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[13px] flex items-center gap-2">
                    {i.ticker ? `${i.ticker} · ${i.name}` : i.name}
                    {synced && <Badge color="#d4a53a">IOL</Badge>}
                  </div>
                  <div className="text-[11px] text-txt-3">Capital: {money(i.capital, i.currency)}{i.quantity ? ` · ${i.quantity} nominales` : ''}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono font-bold text-sm">{money(i.currentValue, i.currency)}</div>
                  <div className={`text-[11px] font-mono ${g >= 0 ? 'text-success' : 'text-danger'}`}>{g >= 0 ? '+' : ''}{money(g, i.currency)} ({p}%)</div>
                </div>
              </div>
            )
          }) : <EmptyState icon="📈" title="Sin inversiones" description="Registrá una inversión o conectá IOL para ver tus posiciones." action={<Button variant="primary" onClick={() => setOpen(true)}>Agregar primera inversión</Button>} />}
        </Card>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Nueva inversión" sub="Registrá una inversión">
        <form onSubmit={handleSave}>
          <Input name="name" label="Nombre" placeholder="Ej: Dólar blue, BTC Binance…" required />
          <div className="grid grid-cols-2 gap-3">
            <Select name="kind" label="Tipo">{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</Select>
            <Select name="currency" label="Moneda"><option value="ARS">ARS</option><option value="USD">USD</option></Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input name="capital" label="Capital invertido" type="number" step="0.01" placeholder="0.00" required />
            <Input name="currentValue" label="Valor actual" type="number" step="0.01" placeholder="0.00" />
          </div>
          <Input name="quantity" label="Cantidad (opcional)" type="number" step="0.00000001" placeholder="Ej: 0.005 BTC" />
          <div className="flex gap-3 mt-5">
            <Button type="button" className="flex-1" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" variant="primary" className="flex-1" loading={saving}>Agregar</Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
