import { clsx } from 'clsx'
import { HTMLAttributes } from 'react'

interface Props extends HTMLAttributes<HTMLDivElement> {
  highlight?: boolean
}

export function Card({ highlight, className, children, ...props }: Props) {
  return (
    <div
      className={clsx(
        'bg-panel border rounded-card p-5 transition-colors',
        highlight ? 'border-gold-line' : 'border-line',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}
