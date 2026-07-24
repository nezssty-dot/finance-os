import { clsx } from 'clsx'

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse bg-line/40 rounded-lg', className)} />
}

export function SkeletonCard() {
  return (
    <div className="bg-panel border border-line rounded-card p-5">
      <Skeleton className="h-3 w-24 mb-3" />
      <Skeleton className="h-6 w-36 mb-2" />
      <Skeleton className="h-3 w-20" />
    </div>
  )
}

export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-[9px]" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-2.5 w-1/5" />
          </div>
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  )
}
