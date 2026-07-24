import { clsx } from 'clsx'
import { ButtonHTMLAttributes, forwardRef } from 'react'

type Variant = 'primary' | 'ghost' | 'danger'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  loading?: boolean
  icon?: React.ReactNode
}

const styles: Record<Variant, string> = {
  primary: 'bg-gold text-[#1a1206] hover:bg-gold-2 font-semibold',
  ghost: 'bg-panel border border-line text-txt-2 hover:bg-panel-2 hover:text-txt hover:border-line-2',
  danger: 'bg-panel border border-line text-danger hover:bg-danger/10',
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
