import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, Upload, ArrowUp, ArrowDown } from 'lucide-react'
import { useStore } from '@/lib/store'
import { useFetch, useMutate } from '@/hooks/useFetch'
import { useToast } from '@/lib/toast'
import { api } from '@/lib/api'
import { ARS, MONTHS } from '@/lib/format'
import { TopBar } from '@/components/layout/TopBar'
import { Card, Button, Modal, Input, Select, EmptyState, SkeletonRows, MovementRow, MovementsHeader } from '@/components/ui'

const TYPES = [
  { v: 'EXPENSE', label: 'Gasto' },
  { v: 'INCOME', label: 'Ingreso' },
  { v: 'TRANSFER', label: 'Transferencia' },
  { v: 'INVESTMENT', label: 'Inversión' },
  { v: 'DEBT_PAYMENT', label: 'Pago de deuda' },
  { v: 'COLLECTION', label: 'Cobro' },
]
const SORTS = [
  { v: 'date', label: 'Fecha' },
  { v: 'description', label: 'Descripción' },
  { v: 'amount', label: 'Monto' },
]

const today = () => new Date().toISOString().slice(0, 10)

export function Movimientos() {
  const { year } = useStore()
  const toast = useToast()
  const { mutate, saving } = useMutate()

  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [accountId, setAccountId] = useState('')
  const [month, setMonth] = useState('')
  const [sort, setSort] = useState('date')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)

  const [editing, setEditing] = useState<any | null>(null)
  const [open, setOpen] = useState(false)

  const params = new URLSearchParams({ year: String(year), sort, order, page: String(page), pageSize: '50' })
  if (q) params.set('q', q)
  if (type) params.set('type', type)
  if (categoryId) params.set('categoryId', categoryId)
  if (accountId) params.set('accountId', accountId)
  if (month !== '') params.set('month', month)

  const { data, loading } = useFetch<any>(`/movements?${params}`, [year, q, type, categoryId, accountId, month, sort, order, page])
  const { data: categories } = useFetch<any[]>('/categories')
  const { data: accounts } = useFetch<any[]>('/accounts')
  const { data: budgets } = useFetch<any[]>('/budgets')
  const { data: dash } = useFetch<any>(`/analysis/dashboard?year=${year}`, [year])
  const projects = (budgets ?? []).filter((b) => b.type === 'PROJECT')

  function openNew() {
    setEditing(null)
    setOpen(true)
  }
  function openEdit(m: any) {
    setEditing(m)
    setOpen(true)
  }

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const body: any = {
      type: f.get('type'),
      amount: Number(f.get('amount')),
      description: String(f.get('description')),
      date: String(f.get('date')),
      counterpart: f.get('counterpart') || undefined,
      accountId: f.get('accountId') || undefined,
      categoryId: f.get('categoryId') || undefined,
      transferAccountId: f.get('transferAccountId') || undefined,
      budgetId: f.get('budgetId') || null,
    }
    const ok = await mutate(
      () =>
        editing
          ? api(`/movements/${editing.id}`, { method: 'PATCH', body })
          : api('/movements', { method: 'POST', body }),
      { toast, success: editing ? 'Movimiento actualizado' : 'Movimiento creado' }
    )
    if (ok) setOpen(false)
  }

  async function remove(m: any) {
    if (!confirm(`¿Borrar "${m.description}"?`)) return
    await mutate(() => api(`/movements/${m.id}`, { method: 'DELETE' }), {
      toast,
      success: 'Movimiento eliminado',
    })
  }

  return (
    <>
      <TopBar title="Movimientos" sub={data ? `${data.total} en ${year}` : undefined}>
        <Link to="/timeline" className="hidden sm:flex items-center gap-1.5 text-[13px] text-txt-2 hover:text-txt px-3 py-2 rounded-btn hover:bg-panel-2 transition-colors">
          <Activity size={15} /> Timeline
        </Link>
        <Link to="/importar" className="hidden sm:flex items-center gap-1.5 text-[13px] text-txt-2 hover:text-txt px-3 py-2 rounded-btn hover:bg-panel-2 transition-colors">
          <Upload size={15} /> Importar
        </Link>
      </TopBar>
      <div className="p-7 animate-fade-in">
        {dash?.activity && (() => {
          const a = dash.activity
          const cards = [
            { label: 'Hoy ganaste', value: a.todayIncome, tone: 'income' as const },
            { label: 'Hoy gastaste', value: a.todayExpense, tone: 'expense' as const },
            { label: 'Balance semanal', value: a.weekBalance, tone: 'balance' as const },
            { label: 'Balance mensual', value: a.monthBalance, tone: 'balance' as const },
          ]
          return (
            <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              {cards.map((c) => {
                const positive = c.tone === 'income' || (c.tone === 'balance' && c.value >= 0)
                const color = c.tone === 'expense' ? 'text-danger' : positive ? 'text-success' : 'text-danger'
                const sign = c.tone === 'balance' && c.value !== 0 ? (c.value > 0 ? '+' : '') : c.tone === 'income' && c.value > 0 ? '+' : ''
                return (
                  <Card key={c.label} className="flex flex-col items-center text-center justify-center gap-1.5 py-4">
                    <div className="text-[11px] text-txt-3 leading-tight">{c.label}</div>
                    <div className={`font-mono font-bold text-title leading-none ${color}`}>{sign}{ARS(Math.abs(c.value))}</div>
                  </Card>
                )
              })}
            </div>
          )
        })()}

        <div className="flex flex-wrap gap-2 mb-4 items-center">
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
            }}
            placeholder="Buscar descripción o contraparte…"
            className="flex-1 min-w-[220px] bg-bg-2 border border-line text-txt px-3 py-2 rounded-btn text-sm focus:outline-none focus:border-gold-line"
          />
          <select value={month} onChange={(e) => { setMonth(e.target.value); setPage(1) }} className="bg-bg-2 border border-line text-txt-2 px-3 py-2 rounded-btn text-sm">
            <option value="">Todo el año</option>
            {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
          <select value={type} onChange={(e) => { setType(e.target.value); setPage(1) }} className="bg-bg-2 border border-line text-txt-2 px-3 py-2 rounded-btn text-sm">
            <option value="">Todo tipo</option>
            {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
          </select>
          <select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1) }} className="bg-bg-2 border border-line text-txt-2 px-3 py-2 rounded-btn text-sm">
            <option value="">Toda categoría</option>
            {(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setPage(1) }} className="bg-bg-2 border border-line text-txt-2 px-3 py-2 rounded-btn text-sm">
            <option value="">Toda cuenta</option>
            {(accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <div className="flex items-center gap-1">
            <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1) }} className="bg-bg-2 border border-line text-txt-2 px-3 py-2 rounded-btn text-sm">
              {SORTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
            </select>
            <button
              onClick={() => setOrder(order === 'asc' ? 'desc' : 'asc')}
              title={order === 'asc' ? 'Ascendente' : 'Descendente'}
              className="w-9 h-9 rounded-full bg-bg-2 border border-line text-txt-2 hover:text-txt flex items-center justify-center shrink-0 transition-colors"
            >
              {order === 'asc' ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
            </button>
          </div>
          <Button variant="primary" onClick={openNew}>+ Nuevo</Button>
        </div>

        <Card className="p-4">
          {loading && !data ? (
            <SkeletonRows rows={8} />
          ) : !data?.items.length ? (
            <EmptyState
              icon="🧾"
              title="No hay movimientos"
              description={q || type || categoryId ? 'Probá aflojar los filtros.' : 'Cargá el primero o sincronizá Mercado Pago.'}
              action={<Button variant="primary" onClick={openNew}>+ Nuevo movimiento</Button>}
            />
          ) : (
            <>
              <MovementsHeader />
              {data.items.map((m: any) => (
                <MovementRow
                  key={m.id}
                  m={m}
                  showAccount
                  onEdit={() => openEdit(m)}
                  onDelete={() => remove(m)}
                />
              ))}
            </>
          )}
        </Card>

        {data && data.pages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-4">
            <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Anterior</Button>
            <span className="text-sm text-txt-3 font-mono">{page} / {data.pages}</span>
            <Button disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Siguiente ›</Button>
          </div>
        )}
      </div>

      <MovementModal
        open={open}
        editing={editing}
        saving={saving}
        categories={categories ?? []}
        accounts={accounts ?? []}
        projects={projects}
        onClose={() => setOpen(false)}
        onSubmit={save}
      />
    </>
  )
}

function MovementModal({ open, editing, saving, categories, accounts, projects, onClose, onSubmit }: any) {
  const [type, setType] = useState(editing?.type ?? 'EXPENSE')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Editar movimiento' : 'Nuevo movimiento'}
      sub={editing ? undefined : 'Si no elegís categoría, Finance OS la sugiere sola.'}
    >
      <form onSubmit={onSubmit} key={editing?.id ?? 'new'}>
        <div className="grid grid-cols-2 gap-3">
          <Select name="type" label="Tipo" defaultValue={editing?.type ?? 'EXPENSE'} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
          </Select>
          <Input name="amount" label="Monto" type="number" step="0.01" min="0.01" required defaultValue={editing?.amount} placeholder="0.00" />
        </div>

        <Input name="description" label="Descripción" required defaultValue={editing?.description} placeholder="Ej: Sesión de mezcla, Spotify…" />
        <Input name="counterpart" label="Contraparte (opcional)" defaultValue={editing?.counterpart ?? ''} placeholder="Cliente, comercio, persona…" />

        <div className="grid grid-cols-2 gap-3">
          <Input name="date" label="Fecha" type="date" required defaultValue={editing ? String(editing.date).slice(0, 10) : today()} />
          <Select name="accountId" label={type === 'TRANSFER' ? 'Desde la cuenta' : 'Cuenta'} defaultValue={editing?.accountId ?? ''}>
            <option value="">Sin cuenta</option>
            {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </div>

        {type === 'TRANSFER' ? (
          <Select name="transferAccountId" label="Hacia la cuenta" required defaultValue={editing?.transferAccountId ?? ''}>
            <option value="">Elegí el destino…</option>
            {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        ) : (
          <Select name="categoryId" label="Categoría" defaultValue={editing?.categoryId ?? ''}>
            <option value="">Que la sugiera Finance OS</option>
            {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        )}

        {type === 'TRANSFER' && (
          <p className="text-[11.5px] text-txt-3 -mt-1 mb-2">
            Mover plata entre tus cuentas no cambia tu patrimonio: sale de una y entra en la otra.
          </p>
        )}

        {projects.length > 0 && (
          <Select name="budgetId" label="Presupuesto de proyecto (opcional)" defaultValue={editing?.budgetId ?? ''}>
            <option value="">Sin asignar</option>
            {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        )}

        <div className="flex gap-3 mt-5">
          <Button type="button" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" className="flex-1" loading={saving}>
            {editing ? 'Guardar' : 'Crear'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
