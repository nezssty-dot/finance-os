import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStore } from '@/lib/store'
import { useToast } from '@/lib/toast'
import { api } from '@/lib/api'
import { ARS } from '@/lib/format'
import { Button, Input, Select, Spinner } from '@/components/ui'

const CURRENCIES = [
  { v: 'ARS', label: 'Peso argentino (ARS)' },
  { v: 'USD', label: 'Dólar (USD)' },
  { v: 'EUR', label: 'Euro (EUR)' },
  { v: 'BRL', label: 'Real (BRL)' },
  { v: 'CLP', label: 'Peso chileno (CLP)' },
  { v: 'UYU', label: 'Peso uruguayo (UYU)' },
  { v: 'MXN', label: 'Peso mexicano (MXN)' },
]

const SUGGESTED = [
  { name: 'Mercado Pago', type: 'MERCADO_PAGO' },
  { name: 'Efectivo', type: 'CASH' },
  { name: 'Banco', type: 'BANK' },
  { name: 'Reserva', type: 'RESERVE' },
]

const ACCOUNT_TYPES = [
  { v: 'MERCADO_PAGO', label: 'Mercado Pago' },
  { v: 'BANK', label: 'Banco' },
  { v: 'CASH', label: 'Efectivo' },
  { v: 'RESERVE', label: 'Reserva' },
  { v: 'WALLET', label: 'Wallet' },
  { v: 'BROKER', label: 'Broker' },
  { v: 'OTHER', label: 'Otra' },
]

type Draft = { name: string; type: string; openingBalance: number }

export function Onboarding() {
  const { user, setUser, refresh } = useStore()
  const toast = useToast()

  const [step, setStep] = useState(0)
  const [currency, setCurrency] = useState(user?.currency ?? 'ARS')
  const [accounts, setAccounts] = useState<Draft[]>([])
  const [saving, setSaving] = useState(false)

  const total = accounts.reduce((s, a) => s + a.openingBalance, 0)

  function addAccount(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    const name = String(f.get('name') ?? '').trim()
    if (!name) return

    setAccounts((prev) => [
      ...prev,
      { name, type: String(f.get('type')), openingBalance: Number(f.get('openingBalance') || 0) },
    ])
    form.reset()
  }

  function quickAdd(s: { name: string; type: string }) {
    if (accounts.some((a) => a.name.toLowerCase() === s.name.toLowerCase())) return
    setAccounts((prev) => [...prev, { ...s, openingBalance: 0 }])
  }

  /**
   * Everything the wizard collected is written here, at the end.
   *
   * Nothing is persisted step by step: if someone closes the window at step 2, they
   * shouldn't come back to a half-built account list with no way to finish it.
   */
  async function finish(connectMp: boolean) {
    setSaving(true)
    try {
      if (currency !== user?.currency) await api('/users/me', { method: 'PATCH', body: { currency } })

      for (const a of accounts)
        await api('/accounts', {
          method: 'POST',
          body: { name: a.name, type: a.type, currency, openingBalance: a.openingBalance },
        })

      const updated: any = await api('/users/me/onboard', { method: 'POST' })
      setUser(updated)
      refresh()

      if (connectMp) {
        const { url } = await api<{ url: string }>('/integrations/mercadopago/connect')
        window.location.href = url
        return
      }

      toast(accounts.length ? `Listo. ${accounts.length} cuentas creadas.` : 'Listo, ya podés empezar.', 'success')
    } catch (e: any) {
      toast(e.message || 'Algo salió mal', 'error')
      setSaving(false)
    }
  }

  const steps = ['Moneda', 'Cuentas', 'Mercado Pago']

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="text-center mb-7">
          <div className="text-2xl font-extrabold tracking-tight mb-1">
            FINANCE<span className="text-gold">OS</span>
          </div>
          <p className="text-txt-3 text-[13px]">
            Hola{user?.name ? `, ${user.name.split(' ')[0]}` : ''}. Tres pasos y estás adentro.
          </p>
        </div>

        {/* progress */}
        <div className="flex items-center gap-2 mb-6">
          {steps.map((label, i) => (
            <div key={label} className="flex-1">
              <div
                className={`h-1 rounded-full transition-colors duration-300 ${
                  i <= step ? 'bg-gold' : 'bg-track'
                }`}
              />
              <div className={`text-[10.5px] mt-1.5 font-semibold ${i <= step ? 'text-gold-2' : 'text-txt-3'}`}>
                {label}
              </div>
            </div>
          ))}
        </div>

        <div className="bg-panel border border-line rounded-card p-6">
          <AnimatePresence mode="wait">
            {step === 0 && (
              <motion.div
                key="currency"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.18 }}
              >
                <h2 className="text-lg font-bold mb-1">¿En qué moneda pensás tu plata?</h2>
                <p className="text-[13px] text-txt-2 mb-5">
                  Es la moneda por defecto. Después podés tener cuentas en otras.
                </p>

                <Select value={currency} onChange={(e) => setCurrency(e.target.value)} label="Moneda principal">
                  {CURRENCIES.map((c) => (
                    <option key={c.v} value={c.v}>{c.label}</option>
                  ))}
                </Select>

                <Button variant="primary" className="w-full mt-4" onClick={() => setStep(1)}>
                  Siguiente
                </Button>
              </motion.div>
            )}

            {step === 1 && (
              <motion.div
                key="accounts"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.18 }}
              >
                <h2 className="text-lg font-bold mb-1">¿Dónde tenés la plata?</h2>
                <p className="text-[13px] text-txt-2 mb-4">
                  Cargá el saldo que hay hoy en cada una. De ahí en adelante, Finance OS lo
                  calcula solo con tus movimientos.
                </p>

                <div className="flex flex-wrap gap-1.5 mb-4">
                  {SUGGESTED.map((s) => {
                    const added = accounts.some((a) => a.name.toLowerCase() === s.name.toLowerCase())
                    return (
                      <button
                        key={s.name}
                        onClick={() => quickAdd(s)}
                        disabled={added}
                        className={`px-2.5 py-1 rounded-btn text-[12px] font-medium border transition-colors ${
                          added
                            ? 'border-gold-line bg-gold-dim text-gold-2 cursor-default'
                            : 'border-line text-txt-2 hover:text-txt hover:border-line-2'
                        }`}
                      >
                        {added ? '✓ ' : '+ '}{s.name}
                      </button>
                    )
                  })}
                </div>

                {accounts.length > 0 && (
                  <div className="bg-bg-2 border border-line rounded-card p-3 mb-4">
                    {accounts.map((a, i) => (
                      <div key={i} className="flex items-center gap-2 py-1.5">
                        <span className="flex-1 text-[13px] font-semibold">{a.name}</span>
                        <span className="font-mono text-[12.5px] text-txt-2">{ARS(a.openingBalance)}</span>
                        <button
                          onClick={() => setAccounts((p) => p.filter((_, x) => x !== i))}
                          className="text-txt-3 hover:text-danger text-xs px-1"
                          aria-label={`Quitar ${a.name}`}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <div className="flex justify-between pt-2 mt-1 border-t border-line text-[12.5px]">
                      <span className="text-txt-3">Total</span>
                      <span className="font-mono font-bold">{ARS(total)}</span>
                    </div>
                  </div>
                )}

                <form onSubmit={addAccount} className="border border-line rounded-card p-3 mb-4">
                  <div className="grid grid-cols-2 gap-2">
                    <Input name="name" label="Nombre" placeholder="Ej: Banco Galicia" />
                    <Select name="type" label="Tipo" defaultValue="OTHER">
                      {ACCOUNT_TYPES.map((t) => (
                        <option key={t.v} value={t.v}>{t.label}</option>
                      ))}
                    </Select>
                  </div>
                  <Input name="openingBalance" label="Saldo actual" type="number" step="0.01" placeholder="0.00" />
                  <Button type="submit" className="w-full">Agregar cuenta</Button>
                </form>

                <div className="flex gap-3">
                  <Button className="flex-1" onClick={() => setStep(0)}>Atrás</Button>
                  <Button variant="primary" className="flex-1" onClick={() => setStep(2)}>
                    Siguiente
                  </Button>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="mp"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.18 }}
              >
                <h2 className="text-lg font-bold mb-1">¿Conectamos Mercado Pago?</h2>
                <p className="text-[13px] text-txt-2 mb-5">
                  Trae tus movimientos solo y los categoriza. Es opcional: podés hacerlo
                  después desde Integraciones, o no hacerlo nunca y cargar todo a mano.
                </p>

                <div className="bg-bg-2 border border-line rounded-card p-4 mb-5 text-[12.5px] text-txt-2 leading-relaxed">
                  Finance OS solo lee tus movimientos. No puede mover plata, ni pagar, ni
                  cobrar. El permiso lo revocás cuando quieras.
                </div>

                {saving ? (
                  <div className="flex items-center justify-center gap-3 py-4">
                    <Spinner />
                    <span className="text-[13px] text-txt-2">Preparando todo…</span>
                  </div>
                ) : (
                  <>
                    <Button variant="primary" className="w-full mb-2" onClick={() => finish(true)}>
                      Conectar Mercado Pago
                    </Button>
                    <Button className="w-full mb-4" onClick={() => finish(false)}>
                      Ahora no, entrar al Dashboard
                    </Button>
                    <button
                      onClick={() => setStep(1)}
                      className="w-full text-[12px] text-txt-3 hover:text-txt-2 transition-colors"
                    >
                      ← Volver a las cuentas
                    </button>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {step < 2 && (
          <button
            onClick={() => finish(false)}
            disabled={saving}
            className="w-full text-center text-[12px] text-txt-3 hover:text-txt-2 mt-4 transition-colors"
          >
            Saltar por ahora
          </button>
        )}
      </div>
    </div>
  )
}
