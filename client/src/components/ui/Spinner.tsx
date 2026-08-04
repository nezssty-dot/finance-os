export function Spinner({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center p-12 text-txt-3 ${className}`}>
      <span className="w-6 h-6 border-[3px] border-line border-t-gold rounded-full animate-spin mr-3" />
      Cargando…
    </div>
  )
}
