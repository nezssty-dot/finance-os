import { createContext, useCallback, useContext, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

type Kind = 'success' | 'error' | 'info'
type Toast = { id: number; kind: Kind; text: string }

const Ctx = createContext<(text: string, kind?: Kind) => void>(() => {})
export const useToast = () => useContext(Ctx)

const STYLES: Record<Kind, string> = {
  success: 'border-success/50 text-success',
  error: 'border-danger/50 text-danger',
  info: 'border-gold-line text-gold-2',
}
const ICONS: Record<Kind, string> = { success: '✓', error: '✕', info: 'i' }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const push = useCallback((text: string, kind: Kind = 'success') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
  }, [])

  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 24, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.96 }}
              transition={{ duration: 0.18 }}
              className={`flex items-center gap-3 bg-panel border ${STYLES[t.kind]} rounded-card px-4 py-3 shadow-2xl pointer-events-auto max-w-sm`}
            >
              <span className="w-5 h-5 rounded-full border border-current flex items-center justify-center text-[11px] font-bold shrink-0">
                {ICONS[t.kind]}
              </span>
              <span className="text-[13px] text-txt font-medium">{t.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  )
}
