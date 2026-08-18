import { clsx } from 'clsx'
import { HTMLAttributes } from 'react'

interface Props extends HTMLAttributes<HTMLDivElement> {
  highlight?: boolean
  /** Pasar `solid` para una tarjeta opaca (sin vidrio), útil en listas muy densas. */
  solid?: boolean
}

export function Card({ highlight, solid, className, children, ...props }: Props) {
  return (
    <div
      className={clsx(
        'rounded-card p-5 transition-colors',
        // Por defecto: vidrio (Liquid Glass). Con `solid`: panel opaco tradicional.
        solid ? 'bg-panel border border-line' : 'glass',
        highlight && 'ring-1 ring-accent-line',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}
