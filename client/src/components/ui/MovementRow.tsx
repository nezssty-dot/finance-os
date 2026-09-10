import { ARS, money, fmtDate } from '@/lib/format'
import { RowMenu } from './RowMenu'

interface Movement {
  id: string
  type: string
  amount: number
  currency?: string
  description: string
  date: string
  account?: { name: string } | null
  category?: { name: string; color: string; icon?: string | null } | null
  budget?: { name: string } | null
}

const POSITIVE = ['INCOME', 'COLLECTION']

interface Props {
  m: Movement
  showAccount?: boolean
  onEdit?: () => void
  onDelete?: () => void
}

// Columnas fijas, mismo orden en la fila y en el encabezado: ícono, Nombre, Monto,
// Fecha, Categoría (pill), menú. Calcado de la referencia (Nombre/Cantidad/Fecha/
// Status) — no una reinterpretación con otro orden de columnas.
//
// Anchos en PX (no "auto"): cada fila es su propio CSS Grid independiente del
// header, así que si una columna usa "auto" su ancho depende del contenido de ESA
// fila — "$8.000" y "$114.000" miden distinto y las columnas quedan escalonadas en
// vez de alineadas como una tabla real. Con ancho fijo, header y filas coinciden.
//
// Responsive en 3 pisos, no solo "hidden" en Fecha/Categoría: ocultar un ítem con
// display:none lo saca del grid, pero la plantilla de columnas (fija) seguía
// reservando sus 120px/152px igual — en una tarjeta angosta eso dejaba CASI TODO el
// ancho para columnas fijas vacías y el Nombre (1fr) se achicaba a 0, invisible. Acá
// la plantilla en sí cambia por breakpoint, así una columna oculta libera su espacio
// de verdad. Los breakpoints (md para Fecha, lg para Categoría) tienen que coincidir
// exacto con los "hidden md:/lg:" de abajo — si no, quedan columnas fantasma vacías.
const GRID = 'grid-cols-[40px_1fr_96px_32px] md:grid-cols-[40px_1fr_104px_110px_32px] lg:grid-cols-[40px_1fr_112px_120px_152px_32px]'

/**
 * Fila de movimiento — misma que usan el Dashboard ("Últimos Movimientos") y la tabla
 * completa de /movimientos. El "⋮" solo aparece si le pasan onEdit/onDelete — en el
 * resumen del Dashboard no hay acciones, así que no se muestra pero la columna queda
 * (vacía) para que las dos tablas alineen igual.
 */
export function MovementRow({ m, showAccount, onEdit, onDelete }: Props) {
  const pos = POSITIVE.includes(m.type)
  const neutral = m.type === 'TRANSFER' || m.type === 'INTERNAL'
  const bg = m.category?.color ? `${m.category.color}22` : neutral ? 'var(--c-panel-2)' : pos ? 'var(--c-success-dim)' : 'var(--c-danger-dim)'
  const fg = m.category?.color ?? (neutral ? 'var(--c-txt-3)' : pos ? 'var(--c-success)' : 'var(--c-danger)')

  return (
    <div className={`grid ${GRID} gap-4 items-center py-3.5 px-2 -mx-2 hover:bg-panel-2/50 rounded-lg transition-colors group`}>
      <span className="w-10 h-10 rounded-[12px] flex items-center justify-center font-bold text-sm shrink-0" style={{ background: bg, color: fg }}>
        {m.category?.icon ?? (neutral ? '⇄' : pos ? '+' : '−')}
      </span>

      <div className="min-w-0">
        <div className="font-normal text-[13.5px] truncate">{m.description}</div>
        {showAccount && m.account && <div className="text-[11px] text-txt-3 mt-0.5 truncate">{m.account.name}</div>}
      </div>

      <span className="font-normal text-[13.5px] tabular-nums truncate">
        {m.currency ? money(m.amount, m.currency) : ARS(m.amount)}
      </span>

      <span className="text-[12.5px] text-txt-3 whitespace-nowrap hidden md:inline">{fmtDate(m.date)}</span>

      {/* Pill con puntito — el mismo lenguaje "• Paid / • Overdue" de la referencia,
          con el color real de la categoría (no un estado inventado que esta app no
          tiene). El presupuesto de proyecto, si tiene, va como segunda pill. */}
      <div className="hidden lg:flex flex-wrap items-center gap-1.5 max-w-full">
        {m.category && (
          <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2.5 py-1 rounded-full max-w-full" style={{ background: `${m.category.color}22`, color: m.category.color }}>
            <span className="w-1 h-1 rounded-full shrink-0" style={{ background: m.category.color }} />
            <span className="truncate">{m.category.name}</span>
          </span>
        )}
        {m.budget && (
          <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2.5 py-1 rounded-full max-w-full bg-accent-dim text-accent-2">
            <span className="w-1 h-1 rounded-full bg-accent-2 shrink-0" />
            <span className="truncate">{m.budget.name}</span>
          </span>
        )}
      </div>

      <RowMenu onEdit={onEdit} onDelete={onDelete} />
    </div>
  )
}

/** Encabezado de columnas — mismo grid que MovementRow, mismo orden que la referencia
 * (Nombre / Monto / Fecha / Categoría). Sin línea divisoria entre filas abajo (la
 * separación es solo espacio + hover), igual que la tabla de referencia. */
export function MovementsHeader() {
  // px-2 -mx-2 (igual que MovementRow, no solo px-2): la fila usa ese combo para que
  // el hover pinte 8px más ancho que el contenido sin mover el contenido — pero eso
  // hace que el CONTENIDO de la fila arranque 8px más a la izquierda que el header
  // (que no tenía el -mx-2 cancelando el padding). Con el mismo combo acá, header y
  // filas arrancan en el mismo píxel en las 6 columnas, no solo en la primera.
  return (
    <div className={`grid ${GRID} gap-4 px-2 -mx-2 pb-3 text-[11px] font-medium text-txt-3`}>
      {/* "Nombre" pisa la columna del ícono (col-span-2) en vez de dejarla vacía —
          si no, el label arranca 56px más a la derecha que el título de la tarjeta
          de arriba y toda la tabla se ve "corrida" respecto al resto de la card. */}
      <span className="col-span-2">Nombre</span>
      <span>Monto</span>
      <span className="hidden md:inline">Fecha</span>
      <span className="hidden lg:inline">Categoría</span>
      <span />
    </div>
  )
}
