import { useState } from 'react'
import { useFetch, useMutate } from '@/hooks/useFetch'
import { useToast } from '@/lib/toast'
import { api } from '@/lib/api'
import { ARS } from '@/lib/format'
import { TopBar } from '@/components/layout/TopBar'
import { Card, Button, Modal, Input, Select, Badge, EmptyState, SkeletonRows } from '@/components/ui'

const STATUS: Record<string, { color: string; label: string }> = {
  over: { color: '#d9615c', label: 'Excedido' },
  at_risk: { color: '#e8c14a', label: 'En riesgo' },
  warning: { color: '#e8c14a', label: 'Atención' },
  ok: { color: '#5bbf7a', label: 'Al día' },
}

export function Presupuestos() {
  const toast = useToast()
  const { mutate, saving } = useMutate()
  const { data: budgets, loading } = useFetch<any[]>('/budgets')
  const { data: categories } = useFetch<any[]>('/categories')
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<'CATEGORY' | 'PROJECT'>('CATEGORY')

  const alerts = (budgets ?? []).filter((b) => b.alert)

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const body: any = { type, limit: Number(f.get('limit')) }
    if (type === 'CATEGORY') body.categoryId = f.get('categoryId')
    else body.name = f.get('name')
    const ok = await mutate(
      () => api('/budgets', { method: 'POST', body }),
      { toast, success: 'Presupuesto creado' }
    )
    if (ok) { setOpen(false); setType('CATEGORY') }
  }

  async function remove(b: any) {
    if (!confirm(`¿Borrar el presupuesto de ${b.category.name}?`)) return
    await mutate(() => api(`/budgets/${b.id}`, { method: 'DELETE' }), { toast, success: 'Presupuesto eliminado' })
  }

  return (
    <>
      <TopBar title="Presupuestos" sub="Cuánto llevás gastado este mes, y dónde vas a terminar" />
      <div className="p-7 animate-fade-in">
        {alerts.length > 0 && (
          <div className="mb-4 space-y-2">
            {alerts.map((b) => (
              <div key={b.id} className="flex items-center gap-2.5 px-4 py-2.5 rounded-card border border-gold-line bg-gold-dim">
                <span className="text-gold-2 text-sm">⚠</span>
                <span className="text-[12.5px] text-txt">{b.alert}</span>
              </div>
            ))}
          </div>
        )}

        <div className="mb-4">
          <Button variant="primary" onClick={() => setOpen(true)}>+ Nuevo presupuesto</Button>
        </div>

        {loading && !budgets ? (
          <Card><SkeletonRows rows={3} /></Card>
        ) : !budgets?.length ? (
          <Card>
            <EmptyState
              icon="📊"
              title="Sin presupuestos"
              description="Poné un límite por categoría y Finance OS te avisa antes de que te pases, no después."
              action={<Button variant="primary" onClick={() => setOpen(true)}>+ Crear presupuesto</Button>}
            />
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {budgets.map((b) => {
              const s = STATUS[b.status]
              return (
                <Card key={b.id} className="group">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: b.type === 'PROJECT' ? 'var(--c-accent)' : b.category.color }} />
                      <span className="font-bold text-[14px]">{b.label}</span>
                      {b.type === 'PROJECT' && <Badge color="var(--c-accent)">Proyecto</Badge>}
                      <Badge color={s.color}>{s.label}</Badge>
                    </div>
                    <button onClick={() => remove(b)} className="text-txt-3 hover:text-danger text-xs opacity-0 group-hover:opacity-100 transition-opacity">Borrar</button>
                  </div>

                  <div className="flex items-end justify-between mb-2">
                    <span className="font-mono font-bold text-lg" style={{ color: b.status === 'over' ? '#d9615c' : undefined }}>
                      {ARS(b.spent)}
                    </span>
                    <span className="text-[12px] text-txt-3 font-mono">de {ARS(b.limit)}</span>
                  </div>

                  <div className="h-2 bg-track rounded-full overflow-hidden relative">
                    <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(b.pct, 100)}%`, background: s.color }} />
                  </div>

                  <div className="flex items-center justify-between mt-2.5 text-[11.5px]">
                    <span className="text-txt-2 font-mono">{b.pct}% usado</span>
                    <span className="text-txt-3">
                      {b.status === 'over'
                        ? `Te pasaste ${ARS(b.spent - b.limit)}`
                        : b.type === 'PROJECT' ? `Llevás gastado ${ARS(b.spent)}` : `Proyección: ${ARS(b.projected)}`}
                    </span>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Nuevo presupuesto"
        sub={type === 'CATEGORY' ? 'Un límite mensual por categoría.' : 'Un total que junta movimientos de cualquier categoría.'}
      >
        <form onSubmit={save} key={type}>
          <div className="grid grid-cols-2 gap-2 mb-1">
            <button
              type="button"
              onClick={() => setType('CATEGORY')}
              className={`px-3 py-2 rounded-btn text-[13px] font-medium border transition-colors ${type === 'CATEGORY' ? 'bg-gold-dim text-gold-2 border-gold-line' : 'text-txt-2 border-line hover:text-txt'}`}
            >
              Por categoría
            </button>
            <button
              type="button"
              onClick={() => setType('PROJECT')}
              className={`px-3 py-2 rounded-btn text-[13px] font-medium border transition-colors ${type === 'PROJECT' ? 'bg-gold-dim text-gold-2 border-gold-line' : 'text-txt-2 border-line hover:text-txt'}`}
            >
              Por proyecto
            </button>
          </div>

          {type === 'CATEGORY' ? (
            <Select name="categoryId" label="Categoría" required>
              <option value="">Elegí una…</option>
              {(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          ) : (
            <Input name="name" label="Nombre del proyecto" required placeholder="Ej: Viaje a Buenos Aires" />
          )}
          <Input name="limit" label="Límite" type="number" step="0.01" min="1" required placeholder="0.00" />
          {type === 'PROJECT' && (
            <p className="text-[11.5px] text-txt-3 -mt-1 mb-2">
              Después asignás movimientos de cualquier categoría a este proyecto desde Movimientos.
            </p>
          )}
          <div className="flex gap-3 mt-5">
            <Button type="button" className="flex-1" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" variant="primary" className="flex-1" loading={saving}>Crear</Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
