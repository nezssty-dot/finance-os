import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface Props {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  title?: string
  sub?: string
}

export function Modal({ open, onClose, children, title, sub }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm p-10 overflow-y-auto"
          onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
        >
          <motion.div
            initial={{ scale: 0.96, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }}
            className="bg-panel border border-line-2 rounded-[18px] w-full max-w-md p-6 shadow-2xl"
          >
            {title && <h3 className="text-lg font-bold">{title}</h3>}
            {sub && <p className="text-sm text-txt-3 mt-1 mb-5">{sub}</p>}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
