import { clsx } from 'clsx'

interface Props { color?: string; children: React.ReactNode; className?: string }

export function Badge({ color = '#71717A', children, className }: Props) {
  return (
    <span
      className={clsx('text-[10px] font-bold uppercase tracking-wide px-2.5 py-0.5 rounded-full', className)}
      style={{ background: color + '2a', color }}
    >
      {children}
    </span>
  )
}
