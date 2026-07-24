import { useStore } from '@/lib/store'
import { useFetch } from '@/hooks/useFetch'
import { ARS, MONTHS_SHORT } from '@/lib/format'
import { TopBar } from '@/components/layout/TopBar'
import { WealthCard, Card, Badge, EmptyState, AsyncGate } from '@/components/ui'

export function Forecast() {
  const { year } = useStore()
  const { data, loading, error, refetch } = useFetch<any>(`/forecast?year=${year}`, [year])

  if (loading && !data) return <AsyncGate title="Forecast" />
  if (!data) return <AsyncGate title="Forecast" error={error} onRetry={refetch} />
  if (data.message) return <><TopBar title="Forecast" /><div className="p-7"><EmptyState icon="🔮" title={data.message} /></div></>

  return (
    <>
      <TopBar title="Forecast" sub={`Proyecciones ${year}`} />
      <div className="p-7 animate-fade-in">
        <div className="grid grid-cols-3 gap-3 mb-4">
          <WealthCard label="Ingreso promedio" value={data.averages.income} sub="Ponderado" />
          <WealthCard label="Gasto promedio" value={data.averages.expense} sub="Ponderado" />
          <WealthCard label="Ahorro promedio" value={data.averages.saving} sub="Mensual" />
        </div>
        <Card className="mb-4">
          <h3 className="text-sm font-semibold mb-3">Mes a mes</h3>
          {data.forecast.map((f: any) => (
            <div key={f.month} className="flex items-center gap-3 py-2 border-b border-bg-2 last:border-0">
              <span className="text-sm text-txt-2 w-8">{MONTHS_SHORT[f.month]}</span>
              <Badge color={f.type === 'actual' ? '#5bbf7a' : '#d4a53a'}>{f.type === 'actual' ? 'Real' : 'Proy.'}</Badge>
              <span className="font-mono text-sm font-bold text-success flex-1 text-right">+{ARS(f.income)}</span>
              <span className="font-mono text-sm font-bold text-danger flex-1 text-right">−{ARS(f.expense)}</span>
              <span className={`font-mono text-sm font-bold flex-1 text-right ${f.saving >= 0 ? 'text-success' : 'text-danger'}`}>{ARS(f.saving)}</span>
            </div>
          ))}
        </Card>
        <Card highlight>
          <h3 className="text-sm font-semibold text-gold-2 mb-4">Proyección a fin de año</h3>
          <div className="space-y-3">
            <div className="flex justify-between"><span className="text-txt-2">Ahorro acumulado</span><span className="font-mono font-bold text-success">{ARS(data.projections.yearEndSaving)}</span></div>
            <div className="flex justify-between"><span className="text-txt-2">Patrimonio actual</span><span className="font-mono font-bold">{ARS(data.projections.currentPatrimonio)}</span></div>
            <div className="flex justify-between"><span className="text-txt-2">Patrimonio proyectado (dic)</span><span className="font-mono font-bold text-success">{ARS(data.projections.projectedPatrimonio)}</span></div>
          </div>
          <p className="text-xs text-txt-3 mt-4">Basado en promedio ponderado de {12 - data.projections.remainingMonths} meses con datos reales</p>
        </Card>
      </div>
    </>
  )
}
