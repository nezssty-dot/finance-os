import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '@/lib/store'
import { useFetch, useMutate } from '@/hooks/useFetch'
import { useToast } from '@/lib/toast'
import { api, download } from '@/lib/api'
import { TopBar } from '@/components/layout/TopBar'
import { Card, Button, Input, Select, Modal } from '@/components/ui'

const CURRENCIES = [
  { v: 'ARS', label: 'Peso argentino (ARS)' },
  { v: 'USD', label: 'Dólar (USD)' },
  { v: 'EUR', label: 'Euro (EUR)' },
  { v: 'BRL', label: 'Real (BRL)' },
  { v: 'CLP', label: 'Peso chileno (CLP)' },
  { v: 'UYU', label: 'Peso uruguayo (UYU)' },
  { v: 'MXN', label: 'Peso mexicano (MXN)' },
]

export function Configuracion() {
  const { user, setUser, logout } = useStore()
  const toast = useToast()
  const navigate = useNavigate()
  const { mutate, saving } = useMutate()

  const [confirmRestore, setConfirmRestore] = useState<any | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const { data: rules } = useFetch<{ rules: number }>('/categories/rules/count')

  async function seedRules() {
    setBusy('seed')
    const r = await mutate(
      () =>
        api<{ categoriesCreated: number; rulesCreated: number; rulesSkipped: number }>(
          '/categories/seed-rules',
          { method: 'POST' }
        ),
      { toast }
    )
    setBusy(null)
    if (!r) return

    // Se dice qué pasó de verdad, incluido "no hice nada". Un toast que dice "listo"
    // cuando no cambió nada deja al usuario sin saber si funcionó o si ya estaba.
    if (!r.rulesCreated) {
      toast('Ya estaban todas cargadas. No se tocó ninguna regla.', 'info')
      return
    }
    const bits = [`${r.rulesCreated} reglas nuevas`]
    if (r.categoriesCreated) bits.push(`${r.categoriesCreated} categorías creadas`)
    if (r.rulesSkipped) bits.push(`${r.rulesSkipped} ya existían`)
    toast(bits.join(' · '), 'success')
  }

  async function saveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    await mutate(
      () =>
        api('/users/me', {
          method: 'PATCH',
          body: { name: f.get('name'), email: f.get('email'), currency: f.get('currency') },
        }),
      { toast, success: 'Perfil actualizado', onSuccess: (u: any) => setUser(u) }
    )
  }

  async function changePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)

    if (f.get('newPassword') !== f.get('confirm')) {
      toast('Las contraseñas nuevas no coinciden', 'error')
      return
    }

    const ok = await mutate(
      () =>
        api('/users/me/password', {
          method: 'POST',
          body: { currentPassword: f.get('currentPassword'), newPassword: f.get('newPassword') },
        }),
      { toast, success: 'Contraseña actualizada. Se cerraron las demás sesiones.' }
    )
    if (ok) form.reset()
  }

  async function backup() {
    setBusy('backup')
    try {
      const stamp = new Date().toISOString().slice(0, 10)
      await download('/users/me/backup', `finance-os-backup-${stamp}.json`)
      toast('Backup descargado', 'success')
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setBusy(null)
    }
  }

  function pickBackupFile() {
    fileInput.current?.click()
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // so picking the same file twice still fires
    if (!file) return

    try {
      const parsed = JSON.parse(await file.text())
      if (!parsed.version || !Array.isArray(parsed.movements))
        throw new Error('Ese archivo no parece un backup de Finance OS')
      setConfirmRestore(parsed)
    } catch (err: any) {
      toast(err.message || 'No se pudo leer el archivo', 'error')
    }
  }

  async function doRestore() {
    if (!confirmRestore) return
    setBusy('restore')
    try {
      const r: any = await api('/users/me/restore', { method: 'POST', body: confirmRestore })
      setConfirmRestore(null)
      toast(`Restaurado: ${r.restored.movements} movimientos, ${r.restored.accounts} cuentas`, 'success')
      // Everything changed underneath. Reload rather than patch a dozen caches.
      setTimeout(() => window.location.reload(), 900)
    } catch (e: any) {
      toast(e.message || 'Falló la restauración', 'error')
      setBusy(null)
    }
  }

  async function doLogout() {
    await logout()
    navigate('/login')
  }

  const counts = confirmRestore?.counts ?? {}

  return (
    <>
      <TopBar title="Configuración" sub={user?.email} />
      <div className="p-7 animate-fade-in max-w-3xl">
        <div className="grid gap-4">
          <Card title="Perfil">
            <form onSubmit={saveProfile}>
              <div className="grid sm:grid-cols-2 gap-3">
                <Input name="name" label="Nombre" required defaultValue={user?.name} />
                <Input name="email" label="Email" type="email" required defaultValue={user?.email} />
              </div>
              <Select name="currency" label="Moneda principal" defaultValue={user?.currency ?? 'ARS'}>
                {CURRENCIES.map((c) => (
                  <option key={c.v} value={c.v}>{c.label}</option>
                ))}
              </Select>
              <p className="text-[11.5px] text-txt-3 -mt-1 mb-3">
                Es la moneda por defecto de las cuentas y movimientos nuevos. No convierte
                lo que ya está cargado.
              </p>
              <Button type="submit" variant="primary" loading={saving}>Guardar cambios</Button>
            </form>
          </Card>

          <Card title="Contraseña">
            <form onSubmit={changePassword}>
              <Input name="currentPassword" label="Contraseña actual" type="password" required autoComplete="current-password" />
              <div className="grid sm:grid-cols-2 gap-3">
                <Input name="newPassword" label="Nueva contraseña" type="password" required minLength={8} autoComplete="new-password" />
                <Input name="confirm" label="Repetila" type="password" required minLength={8} autoComplete="new-password" />
              </div>
              <p className="text-[11.5px] text-txt-3 -mt-1 mb-3">
                Al cambiarla se cierran todas las demás sesiones abiertas.
              </p>
              <Button type="submit" variant="primary" loading={saving}>Cambiar contraseña</Button>
            </form>
          </Card>

          <Card title="Tus datos">
            <p className="text-[13px] text-txt-2 leading-relaxed mb-4">
              El backup es un archivo JSON con todo: cuentas, movimientos, inversiones,
              deudas, objetivos, presupuestos y las reglas que Finance OS aprendió.
              Los tokens de Mercado Pago <b className="text-txt">no</b> se incluyen a propósito —
              un backup en la carpeta de descargas no debería ser una llave de tu cuenta.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={backup} loading={busy === 'backup'}>
                Descargar backup
              </Button>
              <Button onClick={pickBackupFile}>Restaurar desde backup</Button>
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                onChange={onFilePicked}
                className="hidden"
              />
            </div>
            <p className="text-[11.5px] text-txt-3 mt-3">
              ¿Buscás exportar movimientos a Excel o CSV? Está en <b className="text-txt-2">Reportes</b>.
            </p>
          </Card>

          <Card title="Clasificación automática">
            <p className="text-[13px] text-txt-2 leading-relaxed mb-2">
              Finance OS aprende de vos: cada vez que categorizás un movimiento, recuerda ese
              comercio y lo aplica solo la próxima vez. Hoy tenés{' '}
              <b className="text-txt">{rules?.rules ?? '…'}</b> regla{rules?.rules === 1 ? '' : 's'} aprendida
              {rules?.rules === 1 ? '' : 's'}.
            </p>
            <p className="text-[13px] text-txt-2 leading-relaxed mb-4">
              Cargar las reglas base le da un punto de partida: Spotify → STREAMING, YPF →
              COMBUSTIBLE, PedidosYa → DELIVERY y unos cuantos comercios más.{' '}
              <b className="text-txt">Nunca pisa lo que ya le enseñaste</b> — si vos categorizaste
              Spotify como PRODUCCION, sigue siendo PRODUCCION.
            </p>
            <Button variant="primary" onClick={seedRules} loading={busy === 'seed'}>
              Cargar reglas base
            </Button>
            <p className="text-[11.5px] text-txt-3 mt-3">
              Se puede correr las veces que quieras: no duplica nada.
            </p>
          </Card>

          <Card title="Sesión">
            <p className="text-[13px] text-txt-2 mb-4">
              Tus datos quedan guardados en esta computadora. Cerrar sesión no borra nada.
            </p>
            <Button onClick={doLogout}>Cerrar sesión</Button>
          </Card>
        </div>
      </div>

      <Modal
        open={!!confirmRestore}
        onClose={() => setConfirmRestore(null)}
        title="Restaurar backup"
        sub="Esto reemplaza todo lo que tenés cargado hoy."
      >
        {confirmRestore && (
          <>
            <div className="bg-panel-2 border border-line rounded-card p-4 mb-4">
              <div className="text-[11px] text-txt-3 uppercase tracking-wider font-semibold mb-2">
                El archivo contiene
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px] font-mono">
                <span className="text-txt-2">Movimientos</span><span className="text-right font-bold">{counts.movements ?? confirmRestore.movements?.length ?? 0}</span>
                <span className="text-txt-2">Cuentas</span><span className="text-right font-bold">{counts.accounts ?? confirmRestore.accounts?.length ?? 0}</span>
                <span className="text-txt-2">Inversiones</span><span className="text-right font-bold">{counts.investments ?? confirmRestore.investments?.length ?? 0}</span>
                <span className="text-txt-2">Deudas</span><span className="text-right font-bold">{counts.debts ?? confirmRestore.debts?.length ?? 0}</span>
                <span className="text-txt-2">Objetivos</span><span className="text-right font-bold">{counts.goals ?? confirmRestore.goals?.length ?? 0}</span>
                <span className="text-txt-2">Presupuestos</span><span className="text-right font-bold">{counts.budgets ?? confirmRestore.budgets?.length ?? 0}</span>
              </div>
              {confirmRestore.exportedAt && (
                <div className="text-[11px] text-txt-3 mt-3 pt-3 border-t border-line">
                  Exportado el {new Date(confirmRestore.exportedAt).toLocaleString('es-AR')}
                </div>
              )}
            </div>

            <div className="flex items-start gap-2.5 px-4 py-3 rounded-card border border-danger/40 bg-danger/5 mb-4">
              <span className="text-danger text-sm leading-none mt-0.5">⚠</span>
              <span className="text-[12.5px] text-txt leading-relaxed">
                Todo lo que tenés cargado ahora se borra y se reemplaza por el contenido del
                archivo. Si algo falla a mitad de camino no se pierde nada: la restauración es
                una sola operación, o entra completa o no entra.
              </span>
            </div>

            <div className="flex gap-3">
              <Button className="flex-1" onClick={() => setConfirmRestore(null)}>Cancelar</Button>
              <Button variant="danger" className="flex-1" onClick={doRestore} loading={busy === 'restore'}>
                Restaurar
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  )
}
