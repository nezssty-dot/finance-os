import { useState } from 'react'
import { useFetch, useMutate } from '@/hooks/useFetch'
import { useToast } from '@/lib/toast'
import { api } from '@/lib/api'
import { ARS, fmtDate } from '@/lib/format'
import { TopBar } from '@/components/layout/TopBar'
import { Card, Button, Modal, Input, Badge, EmptyState, SkeletonRows } from '@/components/ui'

export function Objetivos() {
  const toast = useToast()
  const { mutate, saving } = useMutate()
  const { data, loading } = useFetch<any>('/goals')
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState<any | null>(null)

  const goals = data?.goals ?? []
  const avg = data?.avgMonthlySaving ?? 0

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const ok = await mutate(
      () =>
        api('/goals', {
          method: 'POST',
          body: {
            name: f.get('name'),
            target: Number(f.get('target')),
            saved: Number(f.get('saved') || 0),
            deadline: f.get('deadline') || undefined,
          },
        }),
      { toast, success: 'Objetivo creado' }
    )
    if (ok) setOpen(false)
  }

  async function contribute(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const ok = await mutate(
      () => api(`/goals/${adding.id}/contribute`, { method: 'POST', body: { amount: Number(f.get('amount')) } }),
      { toast, success: 'Sumado al objetivo' }
    )
    if (ok) setAdding(null)
  }

  async function remove(g: any) {
    if (!confirm(`¿Borrar "${g.name}"?`)) return
    await mutate(() => api(`/goals/${g.id}`, { method: 'DELETE' }), { toast, success: 'Objetivo eliminado' })
  }

  return (
    <>
      <TopBar title="Objetivos" sub={avg > 0 ? `Ahorrás ${ARS(avg)} por mes en promedio` : undefined} />
      <div className="p-7 animate-fade-in">
        <div className="mb-4">
          <Button variant="primary" onClick={() => setOpen(true)}>+ Nuevo objetivo</Button>
        </div>

        {loading && !data ? (
          <Card><SkeletonRows rows={3} /></Card>
        ) : !goals.length ? (
          <Card>
            <EmptyState
              icon="🎯"
              title="Sin objetivos"
              description="Poné una meta y Finance OS calcula cuándo la alcanzás, con tu ritmo real de ahorro."
              action={<Button variant="primary" onClick={() => setOpen(true)}>+ Crear objetivo</Button>}
            />
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {goals.map((g: any) => (
              <Card key={g.id} highlight={g.done} className="group">
                <div className="flex items-start gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[15px]">{g.name}</span>
                      {g.done && <Badge color="#5bbf7a">Cumplido</Badge>}
                      {!g.done && g.onTrack === false && <Badge color="#d9615c">Vas tarde</Badge>}
                      {!g.done && g.onTrack === true && <Badge color="#5bbf7a">En camino</Badge>}
                    </div>
                    {g.deadline && <div className="text-[11px] text-txt-3 mt-0.5">Para {fmtDate(g.deadline)}</div>}
                  </div>
                  <button onClick={() => remove(g)} className="text-txt-3 hover:text-danger text-xs opacity-0 group-hover:opacity-100 transition-opacity">Borrar</button>
                </div>

                <div className="flex items-end justify-between mb-2">
                  <span className="font-mono font-bold text-lg">{ARS(g.saved)}</span>
                  <span className="text-[12px] text-txt-3 font-mono">de {ARS(g.target)}</span>
                </div>

                <div className="h-2 bg-track rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${g.pct}%`, background: g.done ? '#5bbf7a' : '#d4a53a' }}
                  />
                </div>

                <div className="flex items-center justify-between mt-2.5">
                  <span className="text-[12px] text-txt-2 font-mono">{g.pct}%</span>
                  <span className="text-[11.5px] text-txt-3">
                    {g.done
                      ? '¡Listo!'
                      : g.etaMonths
                        ? `Faltan ${ARS(g.remaining)} · llegás en ${g.etaMonths} ${g.etaMonths === 1 ? 'mes' : 'meses'}`
                        : `Faltan ${ARS(g.remaining)}`}
                  </span>
                </div>

                {!g.done && (
                  <Button className="w-full mt-3" onClick={() => setAdding(g)}>Sumar plata</Button>
                )}
              </Card>
            ))}
          </div>
        )}

        {!goals.length || avg > 0 ? null : (
          <p className="text-[11.5px] text-txt-3 mt-3">
            Cuando tengas más movimientos cargados, Finance OS va a estimar cuándo alcanzás cada objetivo.
          </p>
        )}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Nuevo objetivo" sub="Finance OS calcula el tiempo estimado con tu ahorro real.">
        <form onSubmit={save}>
          <Input name="name" label="Objetivo" required placeholder="Ej: Monitores nuevos, Fondo de emergencia…" />
          <div className="grid grid-cols-2 gap-3">
            <Input name="target" label="Meta" type="number" step="0.01" min="1" required placeholder="0.00" />
            <Input name="saved" label="Ya tengo" type="number" step="0.01" min="0" defaultValue={0} />
          </div>
          <Input name="deadline" label="Fecha límite (opcional)" type="date" />
          <div className="flex gap-3 mt-5">
            <Button type="button" className="flex-1" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" variant="primary" className="flex-1" loading={saving}>Crear</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!adding} onClose={() => setAdding(null)} title={`Sumar a "${adding?.name}"`} sub={adding ? `Faltan ${ARS(adding.remaining)}.` : undefined}>
        {adding && (
          <form onSubmit={contribute} key={adding.id}>
            <Input name="amount" label="Monto" type="number" step="0.01" required placeholder="0.00" />
            <p className="text-[11.5px] text-txt-3 -mt-1">
              Apartar plata que ya tenés no cambia tu patrimonio: solo le pone una etiqueta.
            </p>
            <div className="flex gap-3 mt-5">
              <Button type="button" className="flex-1" onClick={() => setAdding(null)}>Cancelar</Button>
              <Button type="submit" variant="primary" className="flex-1" loading={saving}>Sumar</Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  )
}
