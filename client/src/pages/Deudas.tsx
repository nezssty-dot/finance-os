import { useState } from 'react'
import { useFetch, useMutate } from '@/hooks/useFetch'
import { useToast } from '@/lib/toast'
import { api } from '@/lib/api'
import { ARS, fmtDate } from '@/lib/format'
import { TopBar } from '@/components/layout/TopBar'
import { Card, WealthCard, Button, Modal, Input, Select, Badge, EmptyState, SkeletonRows } from '@/components/ui'

export function Deudas() {
  const toast = useToast()
  const { mutate, saving } = useMutate()
  const { data: debts, loading } = useFetch<any[]>('/debts')
  const { data: accounts } = useFetch<any[]>('/accounts')
  const [open, setOpen] = useState(false)
  const [paying, setPaying] = useState<any | null>(null)

  const active = (debts ?? []).filter((d) => !d.settled)
  const debo = active.filter((d) => d.kind === 'OWE').reduce((s, d) => s + d.outstanding, 0)
  const meDeben = active.filter((d) => d.kind === 'OWED').reduce((s, d) => s + d.outstanding, 0)

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const ok = await mutate(
      () =>
        api('/debts', {
          method: 'POST',
          body: {
            name: f.get('name'),
            amount: Number(f.get('amount')),
            kind: f.get('kind'),
            dueDate: f.get('dueDate') || undefined,
          },
        }),
      { toast, success: 'Deuda registrada' }
    )
    if (ok) setOpen(false)
  }

  async function pay(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const ok = await mutate(
      () =>
        api(`/debts/${paying.id}/pay`, {
          method: 'POST',
          body: {
            amount: Number(f.get('amount')),
            accountId: f.get('accountId') || undefined,
            date: f.get('date'),
          },
        }),
      { toast, success: paying.kind === 'OWE' ? 'Pago registrado' : 'Cobro registrado' }
    )
    if (ok) setPaying(null)
  }

  async function remove(d: any) {
    if (!confirm(`¿Borrar la deuda de ${d.name}?`)) return
    await mutate(() => api(`/debts/${d.id}`, { method: 'DELETE' }), { toast, success: 'Deuda eliminada' })
  }

  return (
    <>
      <TopBar title="Deudas" sub="Lo que debés y lo que te deben" />
      <div className="p-7 animate-fade-in">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <WealthCard label="Debo" value={debo} sub={`${active.filter((d) => d.kind === 'OWE').length} deudas`} />
          <WealthCard label="Me deben" value={meDeben} sub={`${active.filter((d) => d.kind === 'OWED').length} por cobrar`} />
          <WealthCard label="Neto" value={meDeben - debo} hero />
        </div>

        <div className="mb-4">
          <Button variant="primary" onClick={() => setOpen(true)}>+ Nueva deuda</Button>
        </div>

        <Card>
          {loading && !debts ? (
            <SkeletonRows rows={4} />
          ) : !debts?.length ? (
            <EmptyState icon="🤝" title="Ninguna deuda" description="Ni debés ni te deben. Envidiable." action={<Button variant="primary" onClick={() => setOpen(true)}>+ Registrar una</Button>} />
          ) : (
            debts.map((d) => (
              <div key={d.id} className={`py-3.5 border-b border-bg-2 last:border-0 group ${d.settled ? 'opacity-45' : ''}`}>
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-[13.5px]">{d.name}</span>
                      <Badge color={d.kind === 'OWED' ? '#5bbf7a' : '#d9615c'}>{d.kind === 'OWE' ? 'Debo' : 'Me deben'}</Badge>
                      {d.settled && <Badge color="#5bbf7a">Saldada</Badge>}
                      {d.overdue && <Badge color="#d9615c">Vencida</Badge>}
                    </div>
                    <div className="text-[11px] text-txt-3 mt-0.5">
                      {d.paid > 0 && !d.settled && `Pagado ${ARS(d.paid)} de ${ARS(d.amount)} · `}
                      {d.dueDate ? `Vence ${fmtDate(d.dueDate)}` : 'Sin vencimiento'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-mono font-bold text-[15px] ${d.settled ? '' : d.kind === 'OWED' ? 'text-success' : 'text-danger'}`}>
                      {ARS(d.settled ? d.amount : d.outstanding)}
                    </div>
                    {!d.settled && d.paid > 0 && <div className="text-[10.5px] text-txt-3">quedan</div>}
                  </div>
                  <div className="flex gap-1">
                    {!d.settled && (
                      <Button onClick={() => setPaying(d)} className="!px-3 !py-1.5 !text-xs">
                        {d.kind === 'OWE' ? 'Pagar' : 'Cobrar'}
                      </Button>
                    )}
                    <button onClick={() => remove(d)} className="text-txt-3 hover:text-danger text-xs px-1.5 opacity-0 group-hover:opacity-100 transition-opacity">Borrar</button>
                  </div>
                </div>
                {d.paid > 0 && !d.settled && (
                  <div className="h-1.5 bg-track rounded-full overflow-hidden mt-2.5">
                    <div className="h-full rounded-full bg-gold transition-all duration-700" style={{ width: `${d.pct}%` }} />
                  </div>
                )}
              </div>
            ))
          )}
        </Card>

        <p className="text-[11.5px] text-txt-3 mt-3">
          Pagar una deuda no te hace más pobre: sale plata de la cuenta y baja la deuda en la misma medida, así que tu patrimonio queda igual.
        </p>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Nueva deuda" sub="Puede ser plata que debés o que te deben.">
        <form onSubmit={save}>
          <Input name="name" label="Persona o entidad" required placeholder="Ej: Kevin, Banco, Noe…" />
          <div className="grid grid-cols-2 gap-3">
            <Select name="kind" label="Tipo" defaultValue="OWE">
              <option value="OWE">La debo yo</option>
              <option value="OWED">Me la deben</option>
            </Select>
            <Input name="amount" label="Monto total" type="number" step="0.01" min="0.01" required placeholder="0.00" />
          </div>
          <Input name="dueDate" label="Vencimiento (opcional)" type="date" />
          <div className="flex gap-3 mt-5">
            <Button type="button" className="flex-1" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" variant="primary" className="flex-1" loading={saving}>Registrar</Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!paying}
        onClose={() => setPaying(null)}
        title={paying?.kind === 'OWE' ? `Pagar a ${paying?.name}` : `Cobrar de ${paying?.name}`}
        sub={paying ? `Quedan ${ARS(paying.outstanding)}. Podés pagar de a poco.` : undefined}
      >
        {paying && (
          <form onSubmit={pay} key={paying.id}>
            <Input name="amount" label="Monto" type="number" step="0.01" min="0.01" max={paying.outstanding} required defaultValue={paying.outstanding} />
            <div className="grid grid-cols-2 gap-3">
              <Select name="accountId" label="Cuenta">
                <option value="">Sin cuenta</option>
                {(accounts ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
              <Input name="date" label="Fecha" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
            </div>
            <div className="flex gap-3 mt-5">
              <Button type="button" className="flex-1" onClick={() => setPaying(null)}>Cancelar</Button>
              <Button type="submit" variant="primary" className="flex-1" loading={saving}>
                {paying.kind === 'OWE' ? 'Registrar pago' : 'Registrar cobro'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  )
}
