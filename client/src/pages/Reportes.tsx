import { useState } from 'react'
import { useStore } from '@/lib/store'
import { useFetch } from '@/hooks/useFetch'
import { useToast } from '@/lib/toast'
import { download } from '@/lib/api'
import { ARS, fmtDate, MONTHS } from '@/lib/format'
import { TopBar } from '@/components/layout/TopBar'
import { Card, WealthCard, Button, CategoryBar, EmptyState, SkeletonCard } from '@/components/ui'
import { donutChart, barChart, incomeVsExpenseBar } from '@/lib/charts'

type Period = 'month' | 'quarter' | 'year'

export function Reportes() {
  const { year, user } = useStore()
  const toast = useToast()
  const [period, setPeriod] = useState<Period>('month')
  const [index, setIndex] = useState(new Date().getMonth())
  const [busy, setBusy] = useState<string | null>(null)

  const { data, loading } = useFetch<any>(
    `/reports/summary?year=${year}&period=${period}&index=${index}`,
    [year, period, index]
  )

  const options =
    period === 'month'
      ? MONTHS.map((m, i) => ({ v: i, label: m }))
      : period === 'quarter'
        ? [0, 1, 2, 3].map((i) => ({ v: i, label: `Q${i + 1}` }))
        : [{ v: 0, label: String(year) }]

  function changePeriod(p: Period) {
    setPeriod(p)
    setIndex(p === 'month' ? new Date().getMonth() : 0)
  }

  const slug = data ? data.label.toLowerCase().replace(/\s+/g, '-') : 'reporte'

  async function exportCSV() {
    setBusy('csv')
    try {
      await download(
        `/reports/movements.csv?year=${year}&period=${period}&index=${index}`,
        `finance-os-${slug}.csv`
      )
      toast('CSV descargado', 'success')
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setBusy(null)
    }
  }

  async function exportExcel() {
    if (!data) return
    setBusy('xlsx')
    try {
      // Loaded on demand so the spreadsheet library never weighs down app startup.
      const XLSX = await import('xlsx')

      const movements = data.movements.map((m: any) => ({
        Fecha: new Date(m.date).toLocaleDateString('es-AR'),
        Tipo: m.type,
        Descripción: m.description,
        Contraparte: m.counterpart ?? '',
        Categoría: m.category,
        Cuenta: m.account,
        Moneda: m.currency,
        Monto: m.amount,
      }))

      const resumen = [
        { Concepto: 'Período', Valor: data.label },
        { Concepto: 'Ingresos', Valor: data.totals.income },
        { Concepto: 'Gastos', Valor: data.totals.expense },
        { Concepto: 'Balance', Valor: data.totals.balance },
        { Concepto: '', Valor: '' },
        { Concepto: 'Patrimonio neto', Valor: data.patrimonio.neto },
        { Concepto: 'Disponible', Valor: data.patrimonio.disponible },
        { Concepto: 'Invertido', Valor: data.patrimonio.invertido },
        { Concepto: 'Por cobrar', Valor: data.patrimonio.porCobrar },
        { Concepto: 'Deudas', Valor: data.patrimonio.deudas },
      ]

      const categorias = data.categories.map((c: any) => ({
        Categoría: c.name,
        Gasto: c.amount,
        'Porcentaje del gasto': data.totals.expense > 0 ? c.amount / data.totals.expense : 0,
      }))

      const wb = XLSX.utils.book_new()

      const s1 = XLSX.utils.json_to_sheet(resumen)
      s1['!cols'] = [{ wch: 22 }, { wch: 18 }]
      XLSX.utils.book_append_sheet(wb, s1, 'Resumen')

      const s2 = XLSX.utils.json_to_sheet(movements)
      s2['!cols'] = [{ wch: 12 }, { wch: 14 }, { wch: 40 }, { wch: 22 }, { wch: 18 }, { wch: 16 }, { wch: 8 }, { wch: 14 }]
      XLSX.utils.book_append_sheet(wb, s2, 'Movimientos')

      if (categorias.length) {
        const s3 = XLSX.utils.json_to_sheet(categorias)
        s3['!cols'] = [{ wch: 24 }, { wch: 16 }, { wch: 20 }]
        XLSX.utils.book_append_sheet(wb, s3, 'Categorías')
      }

      XLSX.writeFile(wb, `finance-os-${slug}.xlsx`)
      toast('Excel descargado', 'success')
    } catch (e: any) {
      toast(e.message || 'No se pudo generar el Excel', 'error')
    } finally {
      setBusy(null)
    }
  }

  /**
   * Exporta el reporte a PDF.
   *
   * NO usa window.open: Electron y los navegadores bloquean los pop-ups, y por eso la
   * exportación fallaba con "El navegador bloqueó la ventana". En su lugar se escribe el
   * reporte en un iframe oculto y se imprime desde ahí — no hay ventana que bloquear.
   */
  function exportPDF() {
    if (!data) return

    const cs = data.categories ?? []
    const paleta = ['#d4a53a', '#5b9bd4', '#5bbf7a', '#d9615c', '#b06fd4', '#d4915b', '#4fb3a8', '#c96b9a', '#8a8a8a']
    const slices = cs.slice(0, 8).map((c: any, i: number) => ({
      label: c.name,
      value: Number(c.amount) || 0,
      color: c.color || paleta[i % paleta.length],
    }))

    const donut = donutChart(slices, { size: 190, thickness: 30 })
    const barras = barChart(slices, { width: 430, formatValue: (n) => ARS(n) })
    const flujo = incomeVsExpenseBar(data.totals.income, data.totals.expense, { width: 470, format: (n) => ARS(n) })

    const leyenda = slices
      .map((s: { label: string; value: number; color: string }) => {
        const pctCat = data.totals.expense > 0 ? Math.round((s.value / data.totals.expense) * 100) : 0
        return `<div class="leg-item">
          <span class="dot" style="background:${s.color}"></span>
          <span class="leg-name">${escapeHtml(s.label)}</span>
          <span class="leg-pct">${pctCat}%</span>
        </div>`
      })
      .join('')

    const rows = data.movements
      .map(
        (m: any) => `<tr>
          <td class="mono dim">${new Date(m.date).toLocaleDateString('es-AR')}</td>
          <td>${escapeHtml(m.description)}${m.counterpart ? `<div class="dim sm">${escapeHtml(m.counterpart)}</div>` : ''}</td>
          <td class="dim">${escapeHtml(m.category)}</td>
          <td class="dim">${escapeHtml(m.account)}</td>
          <td class="mono right ${m.type === 'INCOME' || m.type === 'COLLECTION' ? 'pos' : 'neg'}">${
            m.type === 'INCOME' || m.type === 'COLLECTION' ? '+' : '−'
          }${ARS(m.amount)}</td>
        </tr>`
      )
      .join('')

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>Finance OS — ${escapeHtml(data.label)}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; }
  body { font-family: Inter, -apple-system, system-ui, sans-serif; color: #14141a; margin: 0; font-size: 11px; }
  .mono { font-family: "SF Mono", ui-monospace, Menlo, monospace; }
  .right { text-align: right; }
  .dim { color: #71717a; }
  .sm { font-size: 9.5px; }
  .pos { color: #157347; } .neg { color: #b02a26; }

  header { display: flex; justify-content: space-between; align-items: flex-end;
           border-bottom: 2px solid #d4a53a; padding-bottom: 12px; margin-bottom: 20px; }
  .brand { font-size: 20px; font-weight: 800; letter-spacing: -0.4px; }
  .brand span { color: #d4a53a; }
  .period { font-size: 13px; font-weight: 700; }

  .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 20px; }
  .card { border: 1px solid #e4e4e7; border-radius: 9px; padding: 11px 13px; }
  .card.hero { border-color: #d4a53a; background: #fdf9ef; }
  .card .k { font-size: 8.5px; text-transform: uppercase; letter-spacing: .7px; color: #71717a; font-weight: 700; }
  .card .v { font-size: 15px; font-weight: 800; margin-top: 4px; font-family: "SF Mono", ui-monospace, monospace; }

  h2 { font-size: 10.5px; text-transform: uppercase; letter-spacing: .9px; color: #71717a;
       margin: 20px 0 9px; font-weight: 700; }

  /* Bloque de gráficos: dona + leyenda a la izquierda, barras a la derecha */
  .charts { display: flex; gap: 22px; align-items: center; border: 1px solid #e4e4e7;
            border-radius: 10px; padding: 16px 18px; margin-bottom: 6px; }
  .charts .left { display: flex; align-items: center; gap: 14px; }
  .leg-item { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; font-size: 9.5px; }
  .leg-name { flex: 1; color: #3f3f46; }
  .leg-pct { font-family: ui-monospace, monospace; color: #71717a; font-weight: 700; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }

  .flow { border: 1px solid #e4e4e7; border-radius: 10px; padding: 14px 18px; margin-bottom: 6px; }

  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 8.5px; text-transform: uppercase; letter-spacing: .6px;
       color: #71717a; border-bottom: 1px solid #d4d4d8; padding: 6px 7px; }
  th.right { text-align: right; }
  td { padding: 6px 7px; border-bottom: 1px solid #f1f1f3; vertical-align: top; }
  tbody tr:nth-child(even) { background: #fafafa; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }

  footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid #e4e4e7;
           display: flex; justify-content: space-between; font-size: 9px; color: #a1a1aa; }
</style></head><body>
<header>
  <div>
    <div class="brand">FINANCE<span>OS</span></div>
    <div class="dim sm" style="margin-top:2px">${escapeHtml(user?.name ?? '')}</div>
  </div>
  <div class="right">
    <div class="period">${escapeHtml(data.label)}</div>
    <div class="dim sm">Generado el ${new Date().toLocaleDateString('es-AR')}</div>
  </div>
</header>

<div class="cards">
  <div class="card"><div class="k">Ingresos</div><div class="v pos">${ARS(data.totals.income)}</div></div>
  <div class="card"><div class="k">Gastos</div><div class="v neg">${ARS(data.totals.expense)}</div></div>
  <div class="card"><div class="k">Balance</div><div class="v">${ARS(data.totals.balance)}</div></div>
  <div class="card hero"><div class="k">Patrimonio neto</div><div class="v">${ARS(data.patrimonio.neto)}</div></div>
</div>

<h2>Flujo del período</h2>
<div class="flow">${flujo}</div>

${donut ? `<h2>Distribución del gasto</h2>
<div class="charts">
  <div class="left">
    ${donut}
    <div>${leyenda}</div>
  </div>
  <div>${barras}</div>
</div>` : ''}

<h2>Movimientos (${data.movements.length})</h2>
<table>
  <thead><tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th>Cuenta</th><th class="right">Monto</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="5" class="dim">Sin movimientos en el período.</td></tr>'}</tbody>
</table>

<footer>
  <span>Finance OS · Reporte ${escapeHtml(data.label)}</span>
  <span>Disponible ${ARS(data.patrimonio.disponible)} · Invertido ${ARS(data.patrimonio.invertido)} · Deudas ${ARS(data.patrimonio.deudas)}</span>
</footer>
</body></html>`

    // Iframe oculto en vez de pop-up: no hay ventana que el navegador pueda bloquear.
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
    document.body.appendChild(frame)

    const doc = frame.contentDocument
    if (!doc) {
      document.body.removeChild(frame)
      toast('No se pudo preparar el PDF. Probá de nuevo.', 'error')
      return
    }

    doc.open()
    doc.write(html)
    doc.close()

    // Se imprime cuando el contenido terminó de renderizar. El iframe se saca después:
    // si se quitara enseguida, el diálogo de impresión se quedaría sin documento.
    const printWhenReady = () => {
      try {
        frame.contentWindow?.focus()
        frame.contentWindow?.print()
        toast('Elegí "Guardar como PDF" en el diálogo', 'success')
      } catch {
        toast('No se pudo abrir el diálogo de impresión', 'error')
      } finally {
        setTimeout(() => {
          if (frame.parentNode) document.body.removeChild(frame)
        }, 1000)
      }
    }

    if (doc.readyState === 'complete') setTimeout(printWhenReady, 60)
    else frame.onload = () => setTimeout(printWhenReady, 60)
  }

  return (
    <>
      <TopBar title="Reportes" sub={data?.label} />
      <div className="p-7 animate-fade-in">
        <div className="flex flex-wrap gap-2 items-center mb-5">
          <div className="flex gap-1 bg-bg-2 border border-line rounded-btn p-1">
            {(['month', 'quarter', 'year'] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => changePeriod(p)}
                className={`px-3 py-1.5 rounded-[7px] text-xs font-semibold transition-colors ${
                  period === p ? 'bg-gold text-bg' : 'text-txt-2 hover:text-txt'
                }`}
              >
                {p === 'month' ? 'Mensual' : p === 'quarter' ? 'Trimestral' : 'Anual'}
              </button>
            ))}
          </div>

          {period !== 'year' && (
            <select
              value={index}
              onChange={(e) => setIndex(Number(e.target.value))}
              className="bg-bg-2 border border-line text-txt-2 px-3 py-2 rounded-btn text-sm"
            >
              {options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          )}

          <div className="flex-1" />

          <Button onClick={exportPDF} disabled={!data}>PDF</Button>
          <Button onClick={exportExcel} loading={busy === 'xlsx'} disabled={!data}>Excel</Button>
          <Button onClick={exportCSV} loading={busy === 'csv'} disabled={!data}>CSV</Button>
        </div>

        {loading && !data ? (
          <div className="grid md:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} />)}
          </div>
        ) : !data ? null : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              <WealthCard label="Ingresos" value={data.totals.income} />
              <WealthCard label="Gastos" value={data.totals.expense} />
              <WealthCard label="Balance" value={data.totals.balance} />
              <WealthCard label="Patrimonio neto" value={data.patrimonio.neto} hero />
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <Card title="Gasto por categoría">
                {!data.categories.length ? (
                  <EmptyState icon="📂" title="Sin gastos" description={`No hay gastos en ${data.label.toLowerCase()}.`} />
                ) : (
                  data.categories.map((c: any) => (
                    <CategoryBar
                      key={c.name}
                      name={c.name}
                      amount={c.amount}
                      pct={data.totals.expense > 0 ? Math.round((c.amount / data.totals.expense) * 100) : 0}
                      color={c.color}
                    />
                  ))
                )}
              </Card>

              <Card title={`Movimientos (${data.movements.length})`}>
                {!data.movements.length ? (
                  <EmptyState icon="🧾" title="Sin movimientos" description="Nada registrado en este período." />
                ) : (
                  <div className="max-h-[420px] overflow-y-auto -mx-1 px-1">
                    {data.movements.slice(0, 60).map((m: any) => {
                      const pos = m.type === 'INCOME' || m.type === 'COLLECTION'
                      return (
                        <div key={m.id} className="flex items-center gap-3 py-2 border-b border-bg-2 last:border-0">
                          <span className="text-[11px] text-txt-3 font-mono w-14 shrink-0">{fmtDate(m.date)}</span>
                          <span className="flex-1 text-[12.5px] truncate">{m.description}</span>
                          <span className={`font-mono font-bold text-[12.5px] ${pos ? 'text-success' : 'text-danger'}`}>
                            {pos ? '+' : '−'}{ARS(m.amount)}
                          </span>
                        </div>
                      )
                    })}
                    {data.movements.length > 60 && (
                      <div className="text-[11px] text-txt-3 pt-2.5 text-center">
                        Y {data.movements.length - 60} más — están todos en el PDF y el Excel.
                      </div>
                    )}
                  </div>
                )}
              </Card>
            </div>
          </>
        )}
      </div>
    </>
  )
}

function escapeHtml(s: string) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  )
}
