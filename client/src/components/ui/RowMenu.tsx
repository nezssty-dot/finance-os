import { useState, useRef, useEffect } from 'react'
import { MoreVertical } from 'lucide-react'

/**
 * El "⋮" al final de cada fila de una tabla — reemplaza los links Editar/Borrar que
 * antes aparecían siempre al hacer hover (ver Figma: cada fila tiene un solo ícono de
 * menú, no dos botones de texto compitiendo por espacio).
 */
export function RowMenu({ onEdit, onDelete }: { onEdit?: () => void; onDelete?: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  if (!onEdit && !onDelete) return null

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-8 h-8 rounded-full flex items-center justify-center text-txt-3 hover:text-txt hover:bg-panel-2 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 data-[open=true]:opacity-100"
        data-open={open}
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-36 bg-panel border border-line rounded-[14px] shadow-lg py-1 z-20 overflow-hidden">
          {onEdit && (
            <button
              onClick={() => { setOpen(false); onEdit() }}
              className="w-full text-left px-3.5 py-2 text-[13px] text-txt hover:bg-panel-2 transition-colors"
            >
              Editar
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => { setOpen(false); onDelete() }}
              className="w-full text-left px-3.5 py-2 text-[13px] text-danger hover:bg-danger/10 transition-colors"
            >
              Borrar
            </button>
          )}
        </div>
      )}
    </div>
  )
}
