import { useState } from 'react'
import { Landmark, Wallet, Smartphone, PiggyBank, TrendingUp, CreditCard, Pencil, Trash2 } from 'lucide-react'
import { useFetch, useMutate } from '@/hooks/useFetch'
import { useToast } from '@/lib/toast'
import { api } from '@/lib/api'
import { money } from '@/lib/format'
import { TopBar } from '@/components/layout/TopBar'
import { Card, WealthCard, Button, Modal, Input, Select, EmptyState, SkeletonRows } from '@/components/ui'

const TYPES = [
  { v: 'MERCADO_PAGO', label: 'Mercado Pago' },
  { v: 'BANK', label: 'Banco' },
  { v: 'CASH', label: 'Efectivo' },
  { v: 'RESERVE', label: 'Reserva' },
  { v: 'WALLET', label: 'Wallet' },
  { v: 'BROKER', label: 'Broker' },
  { v: 'OTHER', label: 'Otra' },
]
const LABEL: Record<string, string> = Object.fromEntries(TYPES.map((t) => [t.v, t.label]))
// Un ícono genérico por tipo — nada de logos de marcas ajenas (VISA, Mastercard…):
// estas son las cuentas del usuario, no tarjetas de un banco.
const ICON: Record<string, typeof Wallet> = {
  CASH: Wallet, BANK: Landmark, MERCADO_PAGO: Smartphone,
  RESERVE: PiggyBank, WALLET: Wallet, BROKER: TrendingUp, OTHER: CreditCard,
}

export function Cuentas() {
  const toast = useToast()
  const { mutate, saving } = useMutate()
  const { data: accounts, loading } = useFetch<any[]>('/accounts')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<any | null>(null)
  const [transfer, setTransfer] = useState(false)

  // Total por moneda: nunca sumamos pesos con dólares. La tarjeta principal muestra el
  // total en ARS; si hay cuentas en otra moneda, aparecen en su propia tarjeta.
  const totalsByCurrency: Record<string, number> = {}
  for (const a of accounts ?? []) {
    totalsByCurrency[a.currency] = (totalsByCurrency[a.currency] ?? 0) + a.balance
  }
  const currencies = Object.keys(totalsByCurrency).sort((c) => (c === 'ARS' ? -1 : 1))
  const countByCurrency = (c: string) => (accounts ?? []).filter((a) => a.currency === c).length

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const body: Record<string, unknown> = {
      name: f.get('name'),
      type: f.get('type'),
      currency: f.get('currency'),
      openingBalance: Number(f.get('openingBalance') || 0),
    }
    const ok = await mutate(
      () => (editing ? api(`/accounts/${editing.id}`, { method: 'PATCH', body }) : api('/accounts', { method: 'POST', body })),
      { toast, success: editing ? 'Cuenta actualizada' : 'Cuenta creada' }
    )
    if (ok) setOpen(false)
  }

  async function doTransfer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const ok = await mutate(
      () =>
        api('/accounts/transfer', {
          method: 'POST',
          body: {
            fromAccountId: f.get('from'),
            toAccountId: f.get('to'),
            amount: Number(f.get('amount')),
            date: f.get('date'),
            description: f.get('description') || undefined,
          },
        }),
      { toast, success: 'Transferencia registrada' }
    )
    if (ok) setTransfer(false)
  }

  async function remove(a: any) {
    if (!confirm(`¿Eliminar "${a.name}"?`)) return
    const r: any = await mutate(() => api(`/accounts/${a.id}`, { method: 'DELETE' }), { toast })
    if (r?.archived) toast(`"${a.name}" se archivó: tiene ${r.movements} movimientos y borrarla cambiaría tus números.`, 'info')
    else if (r !== null) toast('Cuenta eliminada', 'success')
  }

  return (
    <>
      <TopBar title="Cuentas" sub="Los saldos se calculan solos desde tus movimientos" />
      <div className="p-7 animate-fade-in">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          {currencies.length === 0 ? (
            <WealthCard label="Total disponible" value={0} hero sub="0 cuentas" />
          ) : (
            currencies.map((c, i) => (
              <WealthCard
                key={c}
                label={c === 'ARS' ? 'Total disponible' : `Total en ${c}`}
                value={totalsByCurrency[c]}
                currency={c}
                hero={i === 0}
                sub={`${countByCurrency(c)} ${countByCurrency(c) === 1 ? 'cuenta' : 'cuentas'}`}
              />
            ))
          )}
        </div>

        <div className="flex gap-2 mb-4">
          <Button variant="primary" onClick={() => { setEditing(null); setOpen(true) }}>+ Nueva cuenta</Button>
          <Button onClick={() => setTransfer(true)} disabled={(accounts?.length ?? 0) < 2}>Transferir entre cuentas</Button>
        </div>

        {loading && !accounts ? (
          <Card><SkeletonRows rows={4} /></Card>
        ) : !accounts?.length ? (
          <Card>
            <EmptyState
              icon="🏦"
              title="Todavía no tenés cuentas"
              description="Creá tu primera cuenta para empezar a seguir tu plata."
              action={<Button variant="primary" onClick={() => setOpen(true)}>+ Nueva cuenta</Button>}
            />
          </Card>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {accounts.map((a, i) => {
              const Icon = ICON[a.type] ?? CreditCard
              const dark = i % 2 === 1
              return (
                <Card key={a.id} className={`group relative !p-0 overflow-hidden ${dark ? '!bg-chrome text-white' : ''}`}>
                  <div className="p-5">
                    <div className="flex items-start justify-between mb-4">
                      <span className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${dark ? 'bg-white/10' : 'bg-panel-2'}`}>
                        <Icon size={18} strokeWidth={2} className={dark ? 'text-white' : 'text-txt-2'} />
                      </span>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => { setEditing(a); setOpen(true) }} className={`p-1.5 rounded-full ${dark ? 'text-white/60 hover:text-white hover:bg-white/10' : 'text-txt-3 hover:text-txt hover:bg-panel-2'}`}>
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => remove(a)} className={`p-1.5 rounded-full ${dark ? 'text-white/60 hover:text-danger hover:bg-white/10' : 'text-txt-3 hover:text-danger hover:bg-panel-2'}`}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    <div className="font-semibold text-title truncate">{a.name}</div>
                    <div className={`text-[11.5px] mt-0.5 ${dark ? 'text-white/50' : 'text-txt-3'}`}>{LABEL[a.type] ?? a.type} · {a.movements} mov.</div>
                    <div className={`font-mono font-bold text-h3 tabular-nums mt-4 ${a.balance < 0 ? 'text-danger' : ''}`}>{money(a.balance, a.currency)}</div>
                    <div className={`text-[11px] mt-0.5 ${dark ? 'text-white/40' : 'text-txt-3'}`}>{a.currency} · inicial {money(a.openingBalance, a.currency)}</div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}

        <p className="text-[11.5px] text-txt-3 mt-3">
          El saldo de cada cuenta es el saldo inicial más todo lo que entró y salió. No hay nada que actualizar a mano.
        </p>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar cuenta' : 'Nueva cuenta'} sub={editing ? undefined : 'El saldo inicial es lo que hay hoy en esa cuenta.'}>
        <form onSubmit={save} key={editing?.id ?? 'new'}>
          <Input name="name" label="Nombre" required defaultValue={editing?.name} placeholder="Ej: Mercado Pago, Efectivo, Binance…" />
          <div className="grid grid-cols-2 gap-3">
            <Select name="type" label="Tipo" defaultValue={editing?.type ?? 'OTHER'}>
              {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
            </Select>
            <Select name="currency" label="Moneda" defaultValue={editing?.currency ?? 'ARS'}>
              <option value="ARS">ARS</option>
              <option value="USD">USD</option>
            </Select>
          </div>
          <Input name="openingBalance" label="Saldo inicial" type="number" step="0.01" defaultValue={editing?.openingBalance ?? 0} placeholder="0.00" />
          <div className="flex gap-3 mt-5">
            <Button type="button" className="flex-1" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" variant="primary" className="flex-1" loading={saving}>{editing ? 'Guardar' : 'Crear'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={transfer} onClose={() => setTransfer(false)} title="Transferencia interna" sub="Tu patrimonio no cambia: la plata sale de una cuenta y entra en otra.">
        <form onSubmit={doTransfer}>
          <div className="grid grid-cols-2 gap-3">
            <Select name="from" label="Desde" required>
              {(accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
            <Select name="to" label="Hacia" required>
              {(accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input name="amount" label="Monto" type="number" step="0.01" min="0.01" required placeholder="0.00" />
            <Input name="date" label="Fecha" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          </div>
          <Input name="description" label="Descripción (opcional)" placeholder="Ej: paso a la reserva" />
          <div className="flex gap-3 mt-5">
            <Button type="button" className="flex-1" onClick={() => setTransfer(false)}>Cancelar</Button>
            <Button type="submit" variant="primary" className="flex-1" loading={saving}>Transferir</Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
