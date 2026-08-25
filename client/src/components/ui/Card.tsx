import { clsx } from 'clsx'
import { HTMLAttributes } from 'react'

interface Props extends HTMLAttributes<HTMLDivElement> {
  highlight?: boolean
}

// Tarjeta sólida muy redondeada — la superficie base del look de Figma. Sin vidrio/blur.
// En claro flota blanca sobre el gris del fondo con una sombra apenas perceptible (así
// se ve en el Figma); en oscuro el contraste ya alcanza solo con el color, sin sombra.
export function Card({ highlight, className, children, ...props }: Props) {
  return (
    <div
      className={clsx(
        'rounded-card p-6 bg-panel shadow-[0_1px_2px_rgba(20,23,26,.04),0_8px_24px_rgba(20,23,26,.04)] dark:shadow-none transition-colors',
        highlight && 'ring-1 ring-accent-line',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}
