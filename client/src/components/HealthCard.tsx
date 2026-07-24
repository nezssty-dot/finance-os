import { ARS } from '@/lib/format'

interface Factor {
  ok: boolean
  label: string
}
interface Health {
  score: number
  rating: string
  factors: Factor[]
  totals?: { income: number; expense: number; saving: number }
}

// Color del puntaje según el tramo. Verde arriba, ámbar al medio, rojo abajo.
function scoreColor(score: number): string {
  if (score >= 65) return '#5bbf7a'
  if (score >= 50) return '#c7a93c'
  if (score >= 35) return '#d4a53a'
  return '#d9615c'
}

/**
 * Tarjeta grande de Salud Financiera. El puntaje es un anillo; al lado, la lista de ✔/⚠
 * que EXPLICA el número (viene del backend, que la calcula con pesos fijos y auditables).
 * A la izquierda, el resumen del mes: ingresaste / gastaste / ahorraste.
 */
export function HealthCard({ health }: { health: Health }) {
  const color = scoreColor(health.score)
  const circumference = 2 * Math.PI * 52
  const offset = circumference * (1 - health.score / 100)
  const t = health.totals

  return (
    <div className="rounded-card bg-gradient-to-br from-panel to-panel-2 border border-line p-6 mb-4">
      <div className="grid md:grid-cols-[auto_1fr] gap-6 items-center">
        {/* Anillo del puntaje */}
        <div className="flex items-center gap-5">
          <div className="relative w-[128px] h-[128px] shrink-0">
            <svg viewBox="0 0 128 128" className="w-full h-full -rotate-90">
              <circle cx="64" cy="64" r="52" fill="none" stroke="var(--line)" strokeWidth="10" />
              <circle
                cx="64"
                cy="64"
                r="52"
                fill="none"
                stroke={color}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                style={{ transition: 'stroke-dashoffset 1s ease-out' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[34px] font-bold font-mono leading-none" style={{ color }}>
                {health.score}
              </span>
              <span className="text-[10px] text-txt-3 mt-0.5">/ 100</span>
            </div>
          </div>
          <div className="md:hidden">
            <div className="text-[11px] uppercase tracking-wider text-txt-3 font-semibold">Salud financiera</div>
            <div className="text-lg font-bold" style={{ color }}>{health.rating}</div>
          </div>
        </div>

        {/* Factores + resumen del mes */}
        <div>
          <div className="hidden md:flex items-baseline gap-2 mb-3">
            <span className="text-[11px] uppercase tracking-wider text-txt-3 font-semibold">Salud financiera</span>
            <span className="text-[15px] font-bold" style={{ color }}>· {health.rating}</span>
          </div>

          {t && (t.income > 0 || t.expense > 0) && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 mb-3 text-[13px]">
              <span className="text-txt-3">Este mes:</span>
              <span>Ingresaste <b className="text-success font-mono">{ARS(t.income)}</b></span>
              <span>Gastaste <b className="text-danger font-mono">{ARS(t.expense)}</b></span>
              <span>Ahorraste <b className="font-mono" style={{ color: t.saving >= 0 ? '#5bbf7a' : '#d9615c' }}>{ARS(t.saving)}</b></span>
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
            {health.factors.map((f, i) => (
              <div key={i} className="flex items-start gap-2 text-[12.5px]">
                <span className={`shrink-0 mt-0.5 ${f.ok ? 'text-success' : 'text-gold-2'}`}>
                  {f.ok ? '✔' : '⚠'}
                </span>
                <span className={f.ok ? 'text-txt-2' : 'text-txt'}>{f.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
