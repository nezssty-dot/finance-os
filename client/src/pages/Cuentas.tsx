import { useState } from 'react'
import { useFetch, useMutate } from '@/hooks/useFetch'
import { useToast } from '@/lib/toast'
import { api } from '@/lib/api'
import { money } from '@/lib/format'
import { TopBar } from '@/components/layout/TopBar'
import { Card, WealthCard, Button, Modal, Input, Select, Badge, EmptyState, SkeletonRows } from '@/components/ui'
import { INSTITUTIONS, providerLabel } from '@/lib/institutions'

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

  // Mercado Pago e IOL administran su propia cuenta desde Integraciones. Si se
  // manda `provider` para una de estas, el select (que no las lista) lo pisaría
  // con vacío y desvincularía una cuenta sincronizada de verdad por accidente.
  const isManaged = editing?.provider === 'mercado_pago' || editing?.provider === 'iol'

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const body: Record<string, unknown> = {
      name: f.get('name'),
      type: f.get('type'),
      currency: f.get('currency'),
      openingBalance: Number(f.get('openingBalance') || 0),
    }
    if (!isManaged) body.provider = f.get('provider') || null
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

        <Card>
          {loading && !accounts ? (
            <SkeletonRows rows={4} />
          ) : !accounts?.length ? (
            <EmptyState
              icon="🏦"
              title="Todavía no tenés cuentas"
              description="Creá tu primera cuenta para empezar a seguir tu plata."
              action={<Button variant="primary" onClick={() => setOpen(true)}>+ Nueva cuenta</Button>}
            />
          ) : (
            accounts.map((a) => (
              <div key={a.id} className="flex items-center gap-3 py-3 border-b border-bg-2 last:border-0 group">
                <div className="w-9 h-9 rounded-[9px] bg-panel-2 flex items-center justify-center text-gold-2 font-bold text-xs shrink-0">
                  {a.name[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[13.5px]">{a.name}</span>
                    <Badge>{LABEL[a.type] ?? a.type}</Badge>
                    {(a.provider === 'mercado_pago' || a.provider === 'iol') && (
                      <Badge color="#00AAFF">Sincronizada</Badge>
                    )}
                    {a.provider && a.provider !== 'mercado_pago' && a.provider !== 'iol' && (
                      <Badge color="#d4a53a">{providerLabel(a.provider)}</Badge>
                    )}
                  </div>
                  <div className="text-[11px] text-txt-3 mt-0.5">
                    {a.movements} movimientos · inicial {money(a.openingBalance, a.currency)}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`font-mono font-bold text-[15px] ${a.balance < 0 ? "text-danger" : ""}`}>{money(a.balance, a.currency)}</div>
                  <div className="text-[10.5px] text-txt-3">{a.currency}</div>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => { setEditing(a); setOpen(true) }} className="text-txt-3 hover:text-gold-2 text-xs px-1.5 py-1">Editar</button>
                  <button onClick={() => remove(a)} className="text-txt-3 hover:text-danger text-xs px-1.5 py-1">Borrar</button>
                </div>
              </div>
            ))
          )}
        </Card>

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
          {isManaged ? (
            <p className="text-[11.5px] text-txt-3 -mt-1 mb-3.5">
              Esta cuenta la sincroniza {providerLabel(editing?.provider)} — se conecta y desconecta desde Integraciones.
            </p>
          ) : (
            <Select name="provider" label="Vincular con (opcional)" defaultValue={editing?.provider ?? ''}>
              <option value="">Ninguna — cuenta genérica</option>
              {INSTITUTIONS.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </Select>
          )}
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
