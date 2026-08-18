import { clsx } from 'clsx'
import { HTMLAttributes } from 'react'

interface Props extends HTMLAttributes<HTMLDivElement> {
  highlight?: boolean
}

// Tarjeta negra sólida muy redondeada — la superficie base del look de Figma. Sin
// vidrio/blur: eso era el sistema anterior, acá todo flota en negro plano sobre el
// fondo (`--c-bg`), que es lo que le da el contraste, no un borde.
export function Card({ highlight, className, children, ...props }: Props) {
  return (
    <div
      className={clsx(
        'rounded-card p-6 bg-panel transition-colors',
        highlight && 'ring-1 ring-accent-line',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}
