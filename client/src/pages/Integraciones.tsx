import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '@/lib/store'
import { useFetch, useMutate } from '@/hooks/useFetch'
import { useToast } from '@/lib/toast'
import { api } from '@/lib/api'
import { ARS } from '@/lib/format'
import { TopBar } from '@/components/layout/TopBar'
import { Card, Button, Badge, Input, Modal, SkeletonRows } from '@/components/ui'
import { INSTITUTIONS, type Institution } from '@/lib/institutions'

const STATUS: Record<string, { color: string; label: string }> = {
  CONNECTED: { color: '#5bbf7a', label: 'Conectada' },
  EXPIRED: { color: '#d4a53a', label: 'Permiso vencido' },
  DISCONNECTED: { color: '#6a6a74', label: 'Desconectada' },
}

const INTERVALS = [
  { v: 0, label: 'Manual' },
  { v: 5, label: '5 min' },
  { v: 15, label: '15 min' },
  { v: 30, label: '30 min' },
  { v: 60, label: '1 hora' },
]

const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—'

/**
 * Estado de una institución sin conector propio (bancos, billeteras, exchanges).
 *
 * "Vinculada" pisa cualquier otro estado: si el usuario ya la carga a mano desde
 * Cuentas, eso importa más que si en general se conecta por extracto o todavía no
 * tiene conector — para ESE usuario, ya está resuelta.
 */
function statusFor(inst: Institution, accounts: { provider?: string | null }[]) {
  const linked = accounts.some((a) => a.provider === inst.id)
  if (linked) return { label: 'Vinculada', color: '#5bbf7a', linked: true }
  if (inst.kind === 'IMPORT') return { label: 'Vía extracto', color: '#a2a2aa', linked: false }
  return { label: 'Próximamente', color: '#d4a53a', linked: false }
}

export function Integraciones() {
  const toast = useToast()
  const { mutate } = useMutate()
  const refresh = useStore((s) => s.refresh)

  const { data, loading } = useFetch<any>('/integrations')
  const { data: catalog } = useFetch<any[]>('/integrations/catalog')
  const { data: logs } = useFetch<any[]>('/integrations/logs')
  const { data: accounts } = useFetch<any[]>('/accounts')

  const [syncing, setSyncing] = useState<string | null>(null)
  const [login, setLogin] = useState<any | null>(null)

  if (loading && !data) {
    return (
      <>
        <TopBar title="Integraciones" />
        <div className="p-7"><Card><SkeletonRows rows={3} /></Card></div>
      </>
    )
  }

  const connected: any[] = data?.integrations ?? []
  const reconciliation: any[] = data?.reconciliation ?? []

  const stateOf = (id: string) => connected.find((i) => i.provider === id)

  async function connect(meta: any) {
    if (meta.auth === 'PASSWORD_GRANT') { setLogin(meta); return }
    try {
      const { url } = await api<{ url: string }>(`/integrations/${meta.id}/connect`)
      window.location.href = url
    } catch (e: any) {
      toast(e.message || 'No se pudo iniciar la conexión', 'error')
    }
  }

  async function submitLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const meta = login
    const ok = await mutate(
      () =>
        api(`/integrations/${meta.id}/connect`, {
          method: 'POST',
          body: { username: f.get('username'), password: f.get('password') },
        }),
      { toast, success: `${meta.label} conectada` }
    )
    if (ok) setLogin(null)
  }

  async function sync(id: string) {
    setSyncing(id)
    try {
      const r: any = await api(`/integrations/${id}/sync`, { method: 'POST' })
      const bits: string[] = []
      if (r.imported) bits.push(`${r.imported} nuevos`)
      if (r.updated) bits.push(`${r.updated} actualizados`)
      if (r.holdings) bits.push(`${r.holdings} posiciones`)
      toast(bits.length ? `Listo: ${bits.join(', ')}.` : 'Ya estabas al día.', 'success')
      // Las advertencias son lo que el proveedor NO dejó traer. Callarlas sería peor
      // que fallar: el usuario confiaría en un total incompleto.
      for (const w of r.warnings ?? []) toast(w, 'error')
    } catch (e: any) {
      toast(e.message || 'Falló la sincronización', 'error')
    } finally {
      setSyncing(null)
      refresh()
    }
  }

  async function schedule(id: string, minutes: number) {
    await mutate(
      () => api(`/integrations/${id}/schedule`, { method: 'PATCH', body: { minutes } }),
      { toast, success: minutes ? `Sincroniza cada ${minutes} min` : 'Sincronización manual' }
    )
  }

  async function disconnect(meta: any) {
    if (!confirm(`¿Desconectar ${meta.label}? Los movimientos ya importados se quedan.`)) return
    await mutate(() => api(`/integrations/${meta.id}`, { method: 'DELETE' }), {
      toast, success: `${meta.label} desconectada`,
    })
  }

  return (
    <>
      <TopBar title="Integraciones" sub="Cada proveedor es un módulo independiente" />
      <div className="p-7 animate-fade-in max-w-4xl">

        {(catalog ?? []).map((meta: any) => {
          const st = stateOf(meta.id)
          const isConnected = st?.status === 'CONNECTED'
          const badge = STATUS[st?.status ?? 'DISCONNECTED']
          const rec = reconciliation.find((r: any) => r.provider === meta.id)

          return (
            <Card key={meta.id} className="mb-4">
              <div className="flex items-start gap-4 flex-wrap">
                <div className="flex-1 min-w-[220px]">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-[15px]">{meta.label}</span>
                    <Badge color={badge.color}>{badge.label}</Badge>
                    {meta.auth === 'PASSWORD_GRANT' && <Badge color="#d4a53a">Sin OAuth</Badge>}
                  </div>
                  <p className="text-[12.5px] text-txt-2">
                    {[
                      meta.capabilities.movements && 'Movimientos',
                      meta.capabilities.holdings && 'Cartera',
                      meta.capabilities.balance && 'Saldo',
                    ].filter(Boolean).join(' · ')}
                    {meta.capabilities.maxHistoryDays &&
                      ` · hasta ${Math.round(meta.capabilities.maxHistoryDays / 30)} meses atrás`}
                  </p>
                </div>

                <div className="flex gap-2 flex-wrap">
                  {isConnected ? (
                    <>
                      <Button variant="primary" onClick={() => sync(meta.id)} loading={syncing === meta.id}>
                        {syncing === meta.id ? 'Sincronizando…' : 'Sincronizar ahora'}
                      </Button>
                      <Button variant="danger" onClick={() => disconnect(meta)}>Desconectar</Button>
                    </>
                  ) : (
                    <Button variant="primary" onClick={() => connect(meta)}>
                      {st?.status === 'EXPIRED' ? 'Reconectar' : 'Conectar'}
                    </Button>
                  )}
                </div>
              </div>

              {/* Lo que el usuario está entregando. Tiene derecho a saberlo ANTES. */}
              {meta.warning && !isConnected && (
                <div className="flex items-start gap-2.5 mt-4 px-4 py-3 rounded-card border border-gold-line bg-gold-dim">
                  <span className="text-gold-2 text-sm leading-none mt-0.5">⚠</span>
                  <span className="text-[12.5px] text-txt leading-relaxed">{meta.warning}</span>
                </div>
              )}

              {st?.lastError && (
                <div className="flex items-start gap-2.5 mt-4 px-4 py-3 rounded-card border border-danger/40 bg-danger/5">
                  <span className="text-danger text-sm leading-none mt-0.5">⚠</span>
                  <span className="text-[12.5px] text-txt">{st.lastError}</span>
                </div>
              )}

              {isConnected && (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-4 border-t border-line">
                    {[
                      ['Última sync', when(st.lastSyncAt)],
                      ['Próxima', st.syncIntervalMinutes ? when(st.nextSyncAt) : 'Manual'],
                      ['Duración', st.lastDurationMs ? `${(st.lastDurationMs / 1000).toFixed(1)}s` : '—'],
                      ['Importados', String(st.importedCount)],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <div className="text-[10.5px] uppercase tracking-wider text-txt-3 font-semibold mb-1">{k}</div>
                        <div className="text-[13px] font-mono">{v}</div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 pt-4 border-t border-line">
                    <div className="text-[10.5px] uppercase tracking-wider text-txt-3 font-semibold mb-2">
                      Sincronizar automáticamente
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {INTERVALS.map((i) => (
                        <button
                          key={i.v}
                          onClick={() => schedule(meta.id, i.v)}
                          className={`px-2.5 py-1 rounded-btn text-[12px] font-medium border transition-colors ${
                            st.syncIntervalMinutes === i.v
                              ? 'border-gold-line bg-gold-dim text-gold-2'
                              : 'border-line text-txt-2 hover:text-txt hover:border-line-2'
                          }`}
                        >
                          {i.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-txt-3 mt-2">
                      Solo mientras Finance OS esté abierto. Es una app de escritorio, no un servicio.
                    </p>
                  </div>

                  {rec && (
                    <div className="mt-4 pt-4 border-t border-line">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10.5px] uppercase tracking-wider text-txt-3 font-semibold">
                          Conciliación
                        </span>
                        <Badge color={rec.matches ? '#5bbf7a' : '#d4a53a'}>
                          {rec.matches ? 'Coincide' : 'Hay diferencia'}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <div className="text-[11px] text-txt-3">Ellos dicen</div>
                          <div className="font-mono font-bold text-[14px]">{ARS(rec.reported)}</div>
                        </div>
                        <div>
                          <div className="text-[11px] text-txt-3">Nosotros calculamos</div>
                          <div className="font-mono font-bold text-[14px]">{ARS(rec.derived)}</div>
                        </div>
                        <div>
                          <div className="text-[11px] text-txt-3">Diferencia</div>
                          <div className="font-mono font-bold text-[14px]" style={{ color: rec.matches ? '#5bbf7a' : '#d4a53a' }}>
                            {ARS(rec.diff)}
                          </div>
                        </div>
                      </div>
                      {!rec.matches && (
                        <p className="text-[11.5px] text-txt-3 mt-2">
                          Falta importar algo, o hay movimientos anteriores a la fecha desde la que sincronizás.
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </Card>
          )
        })}

        {logs && logs.length > 0 && (
          <Card title="Historial de sincronizaciones" className="mb-4">
            {logs.map((h: any) => {
              const failed = h.status === 'FAILED'
              const partial = h.status === 'PARTIAL'
              return (
                <div key={h.id} className="flex items-center gap-3 py-2.5 border-b border-bg-2 last:border-0">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: failed ? '#d9615c' : partial ? '#d4a53a' : '#5bbf7a' }}
                  />
                  <span className="text-[11.5px] text-txt-3 font-mono w-28 shrink-0">{when(h.createdAt)}</span>
                  <span className="text-[11px] text-txt-3 w-24 shrink-0 truncate">{h.provider}</span>
                  <span className="flex-1 text-[12.5px] min-w-0">
                    {failed ? (
                      <span className="text-danger truncate block">{h.error ?? 'Falló'}</span>
                    ) : (
                      <>
                        <b className="text-txt">{h.imported}</b> nuevos
                        {h.updated > 0 && <> · <b className="text-txt">{h.updated}</b> actualizados</>}
                        {h.skipped > 0 && <span className="text-txt-3"> · {h.skipped} sin cambios</span>}
                      </>
                    )}
                  </span>
                  <span className="text-[11px] text-txt-3 font-mono shrink-0">
                    {(h.durationMs / 1000).toFixed(1)}s
                  </span>
                </div>
              )
            })}
          </Card>
        )}

        <div className="mt-2 mb-3">
          <h2 className="text-[13px] font-bold text-txt uppercase tracking-wide">Bancos y billeteras</h2>
          <p className="text-[12px] text-txt-3 mt-0.5">
            Argentina no tiene Open Banking: ningún banco deja leer tu cuenta por API. La
            integración real es el extracto — funciona con cualquiera de estos hoy mismo.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
          {INSTITUTIONS.filter((i) => i.kind === 'IMPORT').map((inst) => {
            const st = statusFor(inst, accounts ?? [])
            return (
              <Card key={inst.id} className="p-4">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <span className="font-bold text-[13.5px]">{inst.name}</span>
                  <Badge color={st.color}>{st.label}</Badge>
                </div>
                <p className="text-[11.5px] text-txt-3 leading-relaxed mb-3">{inst.note}</p>
                <Link to={st.linked ? '/cuentas' : '/importar'}>
                  <Button variant="ghost" className="w-full justify-center">
                    {st.linked ? 'Ver cuenta →' : 'Importar extracto →'}
                  </Button>
                </Link>
              </Card>
            )
          })}
        </div>

        <div className="mt-2 mb-3">
          <h2 className="text-[13px] font-bold text-txt uppercase tracking-wide">Cripto</h2>
          <p className="text-[12px] text-txt-3 mt-0.5">
            Todavía no tienen conector — es roadmap real, no relleno. Mientras tanto entran
            en tu patrimonio igual que los sincronizados: se cargan como cuenta manual.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
          {INSTITUTIONS.filter((i) => i.kind === 'SOON').map((inst) => {
            const st = statusFor(inst, accounts ?? [])
            return (
              <Card key={inst.id} className="p-4">
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <span className="font-bold text-[13.5px]">{inst.name}</span>
                  <Badge color={st.color}>{st.label}</Badge>
                </div>
                <p className="text-[11.5px] text-txt-3 leading-relaxed mb-3">{inst.note}</p>
                <Link to="/cuentas">
                  <Button variant="ghost" className="w-full justify-center">
                    {st.linked ? 'Ver cuenta →' : 'Cargar a mano →'}
                  </Button>
                </Link>
              </Card>
            )
          })}
        </div>
      </div>

      <Modal open={!!login} onClose={() => setLogin(null)} title={`Conectar ${login?.label ?? ''}`}>
        {login && (
          <form onSubmit={submitLogin}>
            <div className="flex items-start gap-2.5 px-4 py-3 rounded-card border border-gold-line bg-gold-dim mb-4">
              <span className="text-gold-2 text-sm leading-none mt-0.5">⚠</span>
              <span className="text-[12.5px] text-txt leading-relaxed">{login.warning}</span>
            </div>
            <Input name="username" label="Usuario" required autoComplete="off" />
            <Input name="password" label="Contraseña" type="password" required autoComplete="off" />
            <p className="text-[11.5px] text-txt-3 -mt-1 mb-4">
              Se usa una sola vez para obtener un token. <b className="text-txt-2">No se guarda.</b>
            </p>
            <div className="flex gap-3">
              <Button className="flex-1" type="button" onClick={() => setLogin(null)}>Cancelar</Button>
              <Button variant="primary" className="flex-1" type="submit">Conectar</Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  )
}
