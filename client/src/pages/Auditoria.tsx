import { useState } from 'react'
import { useFetch } from '@/hooks/useFetch'
import { ARS, MONTHS } from '@/lib/format'
import { TopBar } from '@/components/layout/TopBar'
import { Card, Select, AsyncGate } from '@/components/ui'

/**
 * Auditoría financiera.
 *
 * Le da al usuario confianza en sus balances: revisa los movimientos del mes y le muestra
 * lo que puede estar mal (duplicados, sin categoría, fechas raras) SIN tocar nada. Toda la
 * lógica vive en el motor puro del servidor (lib/audit); acá solo se muestra el reporte.
 */

interface Finding {
  kind: string
  severity: 'warning' | 'info'
  message: string
  movementIds: string[]
}
interface AuditReport {
  analyzed: number
  findings: Finding[]
  totalsByCurrency: Record<string, { income: number; expense: number; net: number }>
  ok: boolean
}

const now = new Date()

export function Auditoria() {
  const [year] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const { data, loading, error, refetch } = useFetch<AuditReport>(`/audit?year=${year}&month=${month}`, [year, month])

  const monthPicker = (
    <Select value={String(month)} onChange={(e) => setMonth(Number(e.target.value))}>
      {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
    </Select>
  )

  if (loading && !data) return <AsyncGate title="Auditoría" />
  if (!data) return <AsyncGate title="Auditoría" error={error} onRetry={refetch} />

  const warnings = data.findings.filter((f) => f.severity === 'warning')
  const infos = data.findings.filter((f) => f.severity === 'info')

  return (
    <>
      <TopBar title="Auditoría" sub="Revisá que tus balances cierren" />
      <div className="p-7 animate-fade-in">
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <div className="w-44">{monthPicker}</div>
          <span className="text-[13px] text-txt-3">{MONTHS[month]} {year}</span>
        </div>

        {/* Encabezado: verde si cierra, ámbar si hay algo para revisar */}
        <Card className="mb-4">
          <div className="flex items-center gap-4">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shrink-0"
              style={{
                background: data.ok ? 'rgba(91,191,122,.14)' : 'rgba(212,165,58,.14)',
                border: `1px solid ${data.ok ? 'rgba(91,191,122,.4)' : 'rgba(212,165,58,.4)'}`,
              }}
            >
              {data.ok ? '✓' : '⚠'}
            </div>
            <div>
              <div className="text-lg font-bold">
                {data.ok ? 'Todo en orden' : `${warnings.length} ${warnings.length === 1 ? 'cosa' : 'cosas'} para revisar`}
              </div>
              <div className="text-[13px] text-txt-3">
                {data.analyzed} {data.analyzed === 1 ? 'movimiento analizado' : 'movimientos analizados'}
                {infos.length > 0 && ` · ${infos.length} ${infos.length === 1 ? 'sugerencia' : 'sugerencias'}`}
              </div>
            </div>
          </div>
        </Card>

        {/* Totales por moneda calculados con el mismo signo que los saldos */}
        {Object.entries(data.totalsByCurrency).map(([cur, t]) => (
          <Card key={cur} className="mb-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-txt-3 mb-3">Balance del mes · {cur}</div>
            <div className="grid grid-cols-3 gap-3">
              <div><div className="text-[11px] text-txt-3 mb-1">Ingresos</div><div className="font-mono font-bold text-success">{money(t.income, cur)}</div></div>
              <div><div className="text-[11px] text-txt-3 mb-1">Egresos</div><div className="font-mono font-bold text-danger">{money(t.expense, cur)}</div></div>
              <div><div className="text-[11px] text-txt-3 mb-1">Neto</div><div className={`font-mono font-bold ${t.net >= 0 ? 'text-success' : 'text-danger'}`}>{money(t.net, cur)}</div></div>
            </div>
          </Card>
        ))}

        {/* Hallazgos */}
        {data.findings.length === 0 ? (
          <Card>
            <div className="text-center py-6">
              <div className="text-3xl mb-2">🎉</div>
              <div className="font-semibold text-[15px]">Los balances de {MONTHS[month]} cierran</div>
              <div className="text-[13px] text-txt-3 mt-1">No se encontraron duplicados, movimientos sin categoría ni fechas fuera de lugar.</div>
            </div>
          </Card>
        ) : (
          <Card>
            <h3 className="text-sm font-semibold mb-3">Qué revisar</h3>
            <div className="space-y-2.5">
              {[...warnings, ...infos].map((f, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 px-4 py-3 rounded-[11px] border"
                  style={{
                    borderColor: f.severity === 'warning' ? 'rgba(212,165,58,.32)' : 'var(--line, #242428)',
                    background: f.severity === 'warning' ? 'rgba(212,165,58,.06)' : 'transparent',
                  }}
                >
                  <span className="text-[15px] shrink-0 mt-0.5" style={{ color: f.severity === 'warning' ? '#e7bd52' : '#6a6a74' }}>
                    {f.severity === 'warning' ? '⚠' : 'ℹ'}
                  </span>
                  <div>
                    <div className="text-[13.5px] text-txt leading-snug">{f.message}</div>
                    <div className="text-[11px] text-txt-3 mt-0.5">
                      {f.movementIds.length} {f.movementIds.length === 1 ? 'movimiento' : 'movimientos'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </>
  )
}

// Formatea en la moneda del total (ARS sin decimales, el resto con 2).
function money(n: number, currency: string): string {
  if (currency === 'ARS') return ARS(n)
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n || 0)
}
