import { useState } from 'react'
import { useFetch, useMutate } from '@/hooks/useFetch'
import { useToast } from '@/lib/toast'
import { api } from '@/lib/api'
import { ARS, money } from '@/lib/format'
import { TopBar } from '@/components/layout/TopBar'
import { Card, Button, Modal, Input, Select, EmptyState, SkeletonRows } from '@/components/ui'

const FREQ_LABEL: Record<string, string> = {
  MONTHLY: 'Mensual',
  WEEKLY: 'Semanal',
  YEARLY: 'Anual',
}

// Texto humano para "cuándo vence": hoy, mañana, en X días, o vencido.
function dueLabel(days: number | null): { text: string; tone: string } {
  if (days == null) return { text: 'Sin fecha', tone: 'txt-3' }
  if (days < 0) return { text: `Venció hace ${Math.abs(days)}d`, tone: 'danger' }
  if (days === 0) return { text: 'Vence hoy', tone: 'gold' }
  if (days === 1) return { text: 'Vence mañana', tone: 'gold' }
  if (days <= 7) return { text: `En ${days} días`, tone: 'txt' }
  return { text: `En ${days} días`, tone: 'txt-2' }
}


/** Lo que devuelve /services/summary: la salud de suscripciones y la cotización usada. */
interface ServicesSummary {
  health?: {
    pending: number
    paid: number
    total: number
    monthlyByCurrency: Record<string, number>
    monthlyConverted: { currency: string; total: number; complete: boolean } | null
    yearlyConverted: number | null
    nextDue: { name: string; inDays: number; amount: number; currency: string } | null
    shareOfIncome: number | null
  }
  fx?: { rate: number; kind: string | null; date: string | null } | null
}

export function Servicios() {
  const toast = useToast()
  const { mutate, saving } = useMutate()
  const { data: services, loading } = useFetch<any[]>('/services')
  const { data: summary } = useFetch<ServicesSummary>('/services/summary')
  const health = summary?.health
  const { data: calendar } = useFetch<any>('/services/calendar?days=45')
  const { data: accounts } = useFetch<any[]>('/accounts')
  const { data: categories } = useFetch<any[]>('/categories')

  const [editing, setEditing] = useState<any | null>(null) // servicio en edición, o {} para nuevo

  const list = services ?? []
  const active = list.filter((s) => s.active)
  const paused = list.filter((s) => !s.active)

  // Total comprometido por mes (solo mensuales activos en ARS, para el encabezado).
  const monthlyARS = active
    .filter((s) => s.frequency === 'MONTHLY' && s.currency === 'ARS')
    .reduce((sum, s) => sum + s.amount, 0)

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const body: any = {
      name: f.get('name'),
      amount: Number(f.get('amount')),
      currency: f.get('currency'),
      frequency: f.get('frequency'),
      interval: Number(f.get('interval') || 1),
      dueDay: f.get('dueDay') ? Number(f.get('dueDay')) : null,
      autoDebit: f.get('autoDebit') === 'on',
      accountId: f.get('accountId') || null,
      categoryId: f.get('categoryId') || null,
      notes: f.get('notes') || null,
    }
    const isNew = !editing?.id
    const ok = await mutate(
      () =>
        api(isNew ? '/services' : `/services/${editing.id}`, {
          method: isNew ? 'POST' : 'PATCH',
          body,
        }),
      { toast, success: isNew ? 'Servicio agregado' : 'Servicio actualizado' }
    )
    if (ok) setEditing(null)
  }

  async function togglePaid(s: any) {
    // Marca (o desmarca) el próximo vencimiento como pagado a mano.
    const isPaid = s.nextDuePaid
    await mutate(
      () =>
        api(`/services/${s.id}/pay${isPaid ? `?dueDate=${s.nextDueDate}` : ''}`, {
          method: isPaid ? 'DELETE' : 'POST',
          body: isPaid ? undefined : { dueDate: s.nextDueDate },
        }),
      { toast, success: isPaid ? 'Marcado como pendiente' : 'Marcado como pagado' }
    )
  }

  async function toggleActive(s: any) {
    await mutate(() => api(`/services/${s.id}`, { method: 'PATCH', body: { active: !s.active } }), {
      toast,
      success: s.active ? 'Servicio pausado' : 'Servicio reactivado',
    })
  }

  async function remove(s: any) {
    if (!confirm(`¿Borrar "${s.name}"? El historial de pagos también se borra.`)) return
    await mutate(() => api(`/services/${s.id}`, { method: 'DELETE' }), {
      toast,
      success: 'Servicio eliminado',
    })
  }

  return (
    <>
      <TopBar
        title="Servicios"
        sub={monthlyARS > 0 ? `${ARS(monthlyARS)} por mes en servicios mensuales` : undefined}
      />
      <div className="p-7 animate-fade-in">
        {/* Salud de suscripciones: todo lo que hace falta para decidir, de un vistazo.
            Los servicios en dólares vienen ya convertidos a la cotización del día. */}
        {health && health.total > 0 && (
          <Card className="mb-5">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex gap-7 flex-wrap">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-txt-3 mb-1">Pendientes</div>
                  <div className="font-mono font-bold text-[19px]">{health.pending}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-txt-3 mb-1">Pagadas</div>
                  <div className="font-mono font-bold text-[19px] text-success">{health.paid}</div>
                </div>
                {health.monthlyConverted && (
                  <>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-txt-3 mb-1">Por mes</div>
                      <div className="font-mono font-bold text-[19px]">{ARS(health.monthlyConverted.total)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-txt-3 mb-1">Por año</div>
                      <div className="font-mono font-bold text-[19px] text-txt-2">{ARS(health.yearlyConverted ?? 0)}</div>
                    </div>
                  </>
                )}
                {health.shareOfIncome !== null && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-txt-3 mb-1">De tus ingresos</div>
                    <div className={`font-mono font-bold text-[19px] ${health.shareOfIncome > 15 ? 'text-danger' : 'text-gold-2'}`}>
                      {health.shareOfIncome}%
                    </div>
                  </div>
                )}
              </div>
              {health.nextDue && (
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-txt-3 mb-1">Próximo</div>
                  <div className="text-[13px] font-semibold">{health.nextDue.name}</div>
                  <div className="text-[11px] text-txt-3">
                    {health.nextDue.inDays === 0 ? 'hoy' : `en ${health.nextDue.inDays} ${health.nextDue.inDays === 1 ? 'día' : 'días'}`}
                  </div>
                </div>
              )}
            </div>
            {summary?.fx && (
              <div className="text-[11px] text-txt-3 mt-3 pt-3 border-t border-line">
                Los servicios en dólares están convertidos al dólar {summary.fx.kind ?? 'MEP'} de {ARS(summary.fx.rate)}.
              </div>
            )}
            {health.monthlyConverted === null && (
              <div className="text-[11px] text-txt-3 mt-3 pt-3 border-t border-line">
                Sin cotización del dólar todavía: los montos en otras monedas se muestran por separado.
              </div>
            )}
          </Card>
        )}

        <div className="mb-5">
          <Button variant="primary" onClick={() => setEditing({})}>
            + Nuevo servicio
          </Button>
        </div>

        {loading ? (
          <SkeletonRows />
        ) : list.length === 0 ? (
          <EmptyState
            icon="🔁"
            title="Todavía no cargaste ningún servicio"
            description="Spotify, el alquiler, el gimnasio, Monotributo. Cargalos una vez y Finance OS te avisa cuándo vencen y cuánto tenés comprometido cada mes."
          />
        ) : (
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Columna izquierda: la lista de servicios */}
            <div className="lg:col-span-2 space-y-5">
              <section className="space-y-2.5">
                {active.map((s) => {
                  const due = dueLabel(s.daysUntilNext)
                  return (
                    <Card key={s.id} className="p-4">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => togglePaid(s)}
                          title={s.nextDuePaid ? 'Marcar pendiente' : 'Marcar pagado'}
                          className={`shrink-0 w-6 h-6 rounded-full border-2 grid place-items-center transition ${
                            s.nextDuePaid
                              ? 'bg-success border-success text-bg'
                              : 'border-line-2 hover:border-txt-3'
                          }`}
                        >
                          {s.nextDuePaid && (
                            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="3">
                              <path d="M20 6L9 17l-5-5" />
                            </svg>
                          )}
                        </button>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-[14px] truncate">{s.name}</span>
                            {s.autoDebit && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-panel-2 text-txt-3 border border-line shrink-0">
                                débito
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-[12px] text-txt-3">
                            <span>
                              {FREQ_LABEL[s.frequency]}
                              {s.interval > 1 ? ` ×${s.interval}` : ''}
                            </span>
                            {s.category && (
                              <>
                                <span>·</span>
                                <span style={{ color: s.category.color }}>{s.category.name}</span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <div className="font-mono font-semibold text-[14px]">
                            {money(s.amount, s.currency)}
                          </div>
                          <div className={`text-[11.5px] text-${due.tone} mt-0.5`}>
                            {s.nextDuePaid ? 'Pago este período' : due.text}
                          </div>
                        </div>

                        <div className="flex gap-1 shrink-0 ml-1">
                          <IconBtn title="Editar" onClick={() => setEditing(s)} d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          <IconBtn title="Pausar" onClick={() => toggleActive(s)} d="M10 4H6v16h4V4zm8 0h-4v16h4V4z" />
                          <IconBtn title="Borrar" danger onClick={() => remove(s)} d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                        </div>
                      </div>
                    </Card>
                  )
                })}
              </section>

              {paused.length > 0 && (
                <section>
                  <h3 className="text-[12px] font-semibold text-txt-3 uppercase tracking-wide mb-2">
                    Pausados
                  </h3>
                  <div className="space-y-2">
                    {paused.map((s) => (
                      <Card key={s.id} className="p-3.5 opacity-60">
                        <div className="flex items-center gap-3">
                          <span className="flex-1 font-medium text-[13px]">{s.name}</span>
                          <span className="font-mono text-[13px] text-txt-3">
                            {money(s.amount, s.currency)}
                          </span>
                          <button
                            onClick={() => toggleActive(s)}
                            className="text-[12px] text-gold-2 hover:underline"
                          >
                            Reactivar
                          </button>
                          <IconBtn title="Borrar" danger onClick={() => remove(s)} d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                        </div>
                      </Card>
                    ))}
                  </div>
                </section>
              )}
            </div>

            {/* Columna derecha: calendario de próximos vencimientos */}
            <div className="lg:col-span-1">
              <Card title="Próximos vencimientos" className="sticky top-24">
                {!calendar || calendar.events.length === 0 ? (
                  <p className="text-[13px] text-txt-3 py-2">
                    No hay vencimientos en los próximos 45 días.
                  </p>
                ) : (
                  <div className="space-y-1 -mx-1">
                    {groupByDay(calendar.events).map(([day, events]) => (
                      <div key={day} className="px-1">
                        <div className="text-[11px] font-semibold text-txt-3 uppercase tracking-wide pt-3 pb-1.5">
                          {dayHeader(day)}
                        </div>
                        {events.map((ev: any, i: number) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 py-1.5 text-[13px]"
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${ev.paid ? 'bg-success' : 'bg-gold'}`}
                            />
                            <span className={`flex-1 truncate ${ev.paid ? 'text-txt-3 line-through' : 'text-txt-2'}`}>
                              {ev.name}
                            </span>
                            <span className="font-mono text-[12.5px] text-txt-3">
                              {money(ev.amount, ev.currency)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}
      </div>

      {/* Formulario de alta / edición */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Editar servicio' : 'Nuevo servicio'}
        sub="El monto y la frecuencia alimentan tu forecast y el disponible real."
      >
        {editing && (
          <form onSubmit={save}>
            <Input name="name" label="Nombre" defaultValue={editing.name} placeholder="Spotify, Alquiler, Monotributo…" required autoFocus />
            <div className="grid grid-cols-2 gap-3">
              <Input name="amount" label="Monto" type="number" step="0.01" min="0" defaultValue={editing.amount} required />
              <Select name="currency" label="Moneda" defaultValue={editing.currency ?? 'ARS'}>
                <option value="ARS">ARS</option>
                <option value="USD">USD</option>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Select name="frequency" label="Frecuencia" defaultValue={editing.frequency ?? 'MONTHLY'}>
                <option value="MONTHLY">Mensual</option>
                <option value="WEEKLY">Semanal</option>
                <option value="YEARLY">Anual</option>
              </Select>
              <Input name="dueDay" label="Día de vencimiento" type="number" min="1" max="31" defaultValue={editing.dueDay} placeholder="Ej: 10" />
            </div>
            <Select name="accountId" label="Cuenta de pago (opcional)" defaultValue={editing.accountId ?? ''}>
              <option value="">Sin especificar</option>
              {(accounts ?? []).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
            <Select name="categoryId" label="Categoría (opcional)" defaultValue={editing.categoryId ?? ''}>
              <option value="">Sin categoría</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
            <Input name="notes" label="Notas (opcional)" defaultValue={editing.notes} placeholder="Plan familiar, renovación anual…" />
            <label className="flex items-center gap-2 mb-4 mt-1 cursor-pointer">
              <input type="checkbox" name="autoDebit" defaultChecked={editing.autoDebit} className="w-4 h-4 accent-gold" />
              <span className="text-[13px] text-txt-2">Débito automático</span>
            </label>
            <div className="flex gap-2">
              <Button type="button" onClick={() => setEditing(null)} className="flex-1">Cancelar</Button>
              <Button type="submit" variant="primary" loading={saving} className="flex-1">
                {editing.id ? 'Guardar' : 'Agregar'}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  )
}

function IconBtn({ d, onClick, title, danger }: { d: string; onClick: () => void; title: string; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-7 h-7 grid place-items-center rounded-lg hover:bg-panel-2 transition ${
        danger ? 'text-txt-3 hover:text-danger' : 'text-txt-3 hover:text-txt'
      }`}
    >
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </button>
  )
}

// Agrupa los eventos del calendario por día (YYYY-MM-DD), preservando el orden.
function groupByDay(events: any[]): [string, any[]][] {
  const map = new Map<string, any[]>()
  for (const ev of events) {
    if (!map.has(ev.dueDate)) map.set(ev.dueDate, [])
    map.get(ev.dueDate)!.push(ev)
  }
  return [...map.entries()]
}

// "Hoy", "Mañana" o la fecha en formato corto.
function dayHeader(iso: string): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const date = new Date(iso + 'T00:00:00')
  const diff = Math.round((date.getTime() - today.getTime()) / 86_400_000)
  if (diff === 0) return 'Hoy'
  if (diff === 1) return 'Mañana'
  return date.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'short' })
}
