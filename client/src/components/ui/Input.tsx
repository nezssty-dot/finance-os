import { clsx } from 'clsx'
import { InputHTMLAttributes, SelectHTMLAttributes, forwardRef } from 'react'

const base = 'w-full bg-bg-2 border border-line text-txt px-3 py-2.5 rounded-btn text-sm font-sans transition-colors focus:outline-none focus:border-gold-line'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label?: string }>(
  ({ label, className, ...props }, ref) => (
    <div className="mb-3.5">
      {label && <label className="block text-xs font-semibold text-txt-2 mb-1.5">{label}</label>}
      <input ref={ref} className={clsx(base, className)} {...props} />
    </div>
  ),
)

export function Select({ label, className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <div className="mb-3.5">
      {label && <label className="block text-xs font-semibold text-txt-2 mb-1.5">{label}</label>}
      <select className={clsx(base, 'cursor-pointer', className)} {...props}>{children}</select>
    </div>
  )
}
