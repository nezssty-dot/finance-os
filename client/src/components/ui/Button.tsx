import { clsx } from 'clsx'
import { ButtonHTMLAttributes, forwardRef } from 'react'

type Variant = 'primary' | 'ghost' | 'danger'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  loading?: boolean
  icon?: React.ReactNode
}

// Del componente "Btn" real del Figma (nodo 4:2411): Primary es la pill verde sólida
// (#00FF6B, hover #00DB71 — el mismo "Success/S600" del sistema); Secondary es SIN
// relleno, borde sólido, texto del mismo color que el borde — no gris relleno como
// tenía antes. `border-txt text-txt` en vez de `border-black` a propósito: en oscuro
// --c-txt es blanco, y el botón tiene que invertirse con el tema, no quedar siempre
// negro sobre un fondo oscuro.
const styles: Record<Variant, string> = {
  primary: 'bg-gold text-black hover:bg-gold-2',
  ghost: 'border border-txt text-txt bg-transparent hover:bg-txt/5',
  danger: 'border border-danger text-danger bg-transparent hover:bg-danger/10',
}

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant = 'ghost', loading, icon, children, className, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center gap-2 px-4 py-2.5 rounded-btn text-[13.5px] transition-all duration-150',
        // active:scale-95 es CSS puro — el mismo "se hunde" al clic en Windows y Mac,
        // sin animación de JS de por medio.
        'active:scale-95 disabled:active:scale-100',
        'disabled:opacity-50 disabled:cursor-default',
        styles[variant],
        className,
      )}
      {...props}
    >
      {loading ? <Spin /> : icon}
      {children}
    </button>
  ),
)

const Spin = () => <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
