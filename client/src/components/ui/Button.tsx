import { clsx } from 'clsx'
import { ButtonHTMLAttributes, forwardRef } from 'react'

type Variant = 'primary' | 'ghost' | 'danger'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  loading?: boolean
  icon?: React.ReactNode
}

// Pills sólidas, sin borde — así se ven los botones en el kit de Figma (fondo plano,
// nunca contorno).
const styles: Record<Variant, string> = {
  primary: 'bg-gold text-black hover:bg-gold-2 font-semibold',
  ghost: 'bg-panel-2 text-txt-2 hover:bg-line-2 hover:text-txt',
  danger: 'bg-panel-2 text-danger hover:bg-danger/10',
}

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant = 'ghost', loading, icon, children, className, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center gap-2 px-4 py-2.5 rounded-btn text-[13.5px] font-semibold transition-all duration-150',
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
