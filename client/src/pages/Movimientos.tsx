import { useState } from 'react'
import { useStore } from '@/lib/store'
import { useFetch, useMutate } from '@/hooks/useFetch'
import { useToast } from '@/lib/toast'
import { api } from '@/lib/api'
import { ARS, fmtDate, MONTHS } from '@/lib/format'
import { TopBar } from '@/components/layout/TopBar'
import { Card, Button, Modal, Input, Select, Badge, EmptyState, SkeletonRows } from '@/components/ui'

const TYPES = [
  { v: 'EXPENSE', label: 'Gasto' },
  { v: 'INCOME', label: 'Ingreso' },
  { v: 'TRANSFER', label: 'Transferencia' },
  { v: 'INVESTMENT', label: 'Inversión' },
  { v: 'DEBT_PAYMENT', label: 'Pago de deuda' },
  { v: 'COLLECTION', label: 'Cobro' },
]
const LABEL: Record<string, string> = Object.fromEntries(TYPES.map((t) => [t.v, t.label]))
const POSITIVE = ['INCOME', 'COLLECTION']

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

  function toggleSort(col: string) {
    if (sort === col) setOrder(order === 'asc' ? 'desc' : 'asc')
    else {
      setSort(col)
      setOrder('desc')
    }
    setPage(1)
  }
  const arrow = (col: string) => (sort === col ? (order === 'asc' ? ' ↑' : ' ↓') : '')

  return (
    <>
      <TopBar title="Movimientos" sub={data ? `${data.total} en ${year}` : undefined} />
      <div className="p-7 animate-fade-in">
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
          <Button variant="primary" onClick={openNew}>+ Nuevo</Button>
        </div>

        <Card className="p-0 overflow-hidden">
          <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-3 px-5 py-3 border-b border-line text-[11px] font-semibold uppercase tracking-wider text-txt-3">
            <button onClick={() => toggleSort('date')} className="text-left hover:text-txt">Fecha{arrow('date')}</button>
            <button onClick={() => toggleSort('description')} className="text-left hover:text-txt">Descripción{arrow('description')}</button>
            <span>Cuenta</span>
            <button onClick={() => toggleSort('amount')} className="text-right hover:text-txt">Monto{arrow('amount')}</button>
            <span />
          </div>

          {loading && !data ? (
            <div className="p-5"><SkeletonRows rows={8} /></div>
          ) : !data?.items.length ? (
            <EmptyState
              icon="🧾"
              title="No hay movimientos"
              description={q || type || categoryId ? 'Probá aflojar los filtros.' : 'Cargá el primero o sincronizá Mercado Pago.'}
              action={<Button variant="primary" onClick={openNew}>+ Nuevo movimiento</Button>}
            />
          ) : (
            data.items.map((m: any) => {
              const pos = POSITIVE.includes(m.type)
              const neutral = m.type === 'TRANSFER' || m.type === 'INTERNAL'
              return (
                <div key={m.id} className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-3 items-center px-5 py-3 border-b border-bg-2 last:border-0 hover:bg-panel-2/40 transition-colors group">
                  <span className="text-[12px] text-txt-3 font-mono whitespace-nowrap">{fmtDate(m.date)}</span>
                  <div className="min-w-0">
                    <div className="font-semibold text-[13px] truncate">{m.description}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge color={neutral ? '#6a6a74' : pos ? '#5bbf7a' : '#d9615c'}>{LABEL[m.type] ?? m.type}</Badge>
                      {m.category && <Badge color={m.category.color}>{m.category.name}</Badge>}
                      {m.source === 'MERCADO_PAGO' && <Badge color="#00AAFF">MP</Badge>}
                    </div>
                  </div>
                  <span className="text-[12px] text-txt-3 whitespace-nowrap">
                    {m.account?.name ?? '—'}
                    {m.transferAccount && ` → ${m.transferAccount.name}`}
                  </span>
                  <span className={`font-mono font-bold text-[13.5px] text-right whitespace-nowrap ${neutral ? 'text-txt-2' : pos ? 'text-success' : 'text-danger'}`}>
                    {neutral ? '' : pos ? '+' : '−'}{ARS(Number(m.amount))}
                  </span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openEdit(m)} className="text-txt-3 hover:text-gold-2 text-xs px-1.5 py-1">Editar</button>
                    <button onClick={() => remove(m)} className="text-txt-3 hover:text-danger text-xs px-1.5 py-1">Borrar</button>
                  </div>
                </div>
              )
            })
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
        onClose={() => setOpen(false)}
        onSubmit={save}
      />
    </>
  )
}

function MovementModal({ open, editing, saving, categories, accounts, onClose, onSubmit }: any) {
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
