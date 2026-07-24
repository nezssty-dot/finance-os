interface Props { icon?: string; title: string; description?: string; action?: React.ReactNode }

export function EmptyState({ icon = '📊', title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <span className="text-4xl mb-4">{icon}</span>
      <h3 className="text-lg font-bold mb-1">{title}</h3>
      {description && <p className="text-sm text-txt-3 max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
