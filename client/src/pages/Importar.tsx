import { useCallback, useRef, useState } from 'react'
import { useFetch, useMutate } from '@/hooks/useFetch'
import { useToast } from '@/lib/toast'
import { api } from '@/lib/api'
import { ARS, fmtDate } from '@/lib/format'
import { TopBar } from '@/components/layout/TopBar'
import { Card, Button, Select, Badge, EmptyState, Spinner } from '@/components/ui'
import { importEngine, ACCEPTED_EXTENSIONS } from '@/lib/import/engine'
import type { ReadResult, DetectedSource } from '@/lib/import/engine'

/**
 * IMPORTAR MOVIMIENTOS
 *
 * ─── EL FLUJO, Y POR QUÉ TIENE TRES PASOS ───
 *
 *   1. ARCHIVO   el usuario arrastra o elige
 *   2. REVISIÓN  se le MUESTRA lo que se entendió, antes de tocar nada
 *   3. IMPORTAR  recién ahí se guarda
 *
 * El paso 2 es innegociable. Un resumen mal parseado —una columna corrida, un decimal
 * confundido, una fecha en formato americano— importa cientos de movimientos MAL, y no
 * falla: se guardan perfecto. El usuario lo descubre semanas después, cuando los totales
 * no le cierran, y para entonces no sabe cuáles vinieron del archivo y cuáles cargó a mano.
 *
 * Deshacer eso es un infierno. Mostrarlo antes cuesta un clic.
 *
 * La cuenta se elige DENTRO del paso 2 (no después): Cuenta y Moneda de la vista previa
 * dependen de cuál esté elegida, así que hay que saberlo antes de mostrar la tabla. Si el
 * origen se detectó (Mercado Pago, un banco…), se preselecciona sola buscando una cuenta
 * marcada con ese mismo proveedor — el usuario la puede cambiar, nunca queda forzada.
 *
 * ─── LO QUE ESTA PANTALLA NO HACE ───
 *
 * No sabe leer PDF, ni Excel, ni CSV. No sabe qué es Mercado Pago. No parsea fechas.
 * Todo eso vive en el motor (lib/import/) y en el servidor. Acá solo se orquesta y se
 * muestra. Si algún día hay que agregar un formato, este archivo no se toca.
 */

/**
 * Los formatos que se le muestran al usuario salen del MOTOR, no de una lista escrita a
 * mano. Así, cuando se registra un importer nuevo (OFX, QIF, el que sea), el cartel se
 * actualiza solo y nunca miente sobre lo que la app puede leer.
 */
const SUPPORTED_FORMATS = [
  ...new Set(ACCEPTED_EXTENSIONS.map((e) => e.replace('.', '').toUpperCase())),
]

interface PreviewCategory {
  id: string
  name: string
  color: string
}

interface PreviewRow {
  date: string | null
  description: string
  amount: number | null
  raw: string[]
  /** Sugerida por las reglas del usuario (ClassificationRule) — nunca IA. Si nada
   *  coincide viene null, y se muestra tal cual: inventar una categoría acá sería
   *  peor que no sugerir ninguna. */
  category: PreviewCategory | null
}

interface PreviewResponse {
  mapping: { columns: string[]; hasHeader: boolean; decimal: string }
  rows: PreviewRow[]
  total: number
  /**
   * Las filas que NO se pudieron leer, con el motivo y el texto original. Se muestran
   * siempre: si el usuario importa 100 movimientos y 6 quedan afuera, tiene que verlo.
   * Antes se descartaban en silencio y la plata simplemente no aparecía.
   */
  rejected?: { line: number; reason: string; raw?: string }[]
  diagnostics?: {
    columns: { index: number; role: string; header: string | null; sample: string | null }[]
    dateColumnFound: boolean
    amountColumnFound: boolean
    notes: string[]
  }
}

interface AccountOption {
  id: string
  name: string
  currency: string
  provider?: string | null
}

/** Traduce el rol de columna que reporta el detector, para mostrarlo en español. */
function roleLabelEs(role: string): string {
  const map: Record<string, string> = {
    date: 'Fecha', description: 'Descripción', amount: 'Importe',
    debit: 'Débito', credit: 'Crédito', balance: 'Saldo', ignore: 'ignorada',
  }
  return map[role] ?? role
}

type Stage = 'idle' | 'reading' | 'preview' | 'importing'

/** "mercadopago" (como lo llama el detector de origen, lib/import/sources.ts) vs
 *  "mercado_pago" (como lo guarda el conector real, ver IntegrationManager). Todo
 *  lo demás coincide tal cual entre un origen detectado y un `Account.provider`. */
const SOURCE_TO_PROVIDER: Record<string, string> = { mercadopago: 'mercado_pago' }

/**
 * A qué cuenta probablemente van estos movimientos, a partir del origen detectado.
 *
 * Es una ayuda, no una decisión: el select sigue siendo editable. Primero busca una
 * cuenta vinculada a ese proveedor (sincronizada de verdad, o marcada a mano desde
 * Cuentas); si no hay, prueba por nombre — alguien pudo haber creado la cuenta
 * "Banco Galicia" sin marcarla como tal. Sin corazonada, devuelve '' y no fuerza nada.
 */
function guessAccount(source: DetectedSource | null, accounts: AccountOption[]): string {
  if (!source || !accounts.length) return ''

  const slug = SOURCE_TO_PROVIDER[source.id] ?? source.id
  const byProvider = accounts.find((a) => a.provider === slug)
  if (byProvider) return byProvider.id

  const name = source.name.toLowerCase()
  const byName = accounts.find(
    (a) => a.name.toLowerCase().includes(name) || name.includes(a.name.toLowerCase())
  )
  return byName?.id ?? ''
}

export function Importar() {
  const toast = useToast()
  const { mutate, saving } = useMutate()

  const { data: accounts } = useFetch<AccountOption[]>('/accounts')

  const [stage, setStage] = useState<Stage>('idle')
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [read, setRead] = useState<ReadResult | null>(null)
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [accountId, setAccountId] = useState('')
  const [autoGuessed, setAutoGuessed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setStage('idle')
    setFile(null)
    setRead(null)
    setPreview(null)
    setError(null)
    setAutoGuessed(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleFile = useCallback(async (f: File) => {
    setError(null)
    setFile(f)
    setStage('reading')

    try {
      // 1. El motor elige el importer y convierte el archivo en texto delimitado.
      const result = await importEngine.read(f)
      setRead(result)

      // 2. El servidor lo analiza con el motor que YA EXISTE — el mismo que está
      //    probado con formatos reales de Galicia, Santander, Macro y Brubank —
      //    y de paso sugiere categoría por fila con las reglas del usuario.
      const p = await api<PreviewResponse>('/integrations/import/preview', {
        method: 'POST',
        body: { text: result.text },
      })

      if (!p.total) {
        // Nunca más un error genérico: si el detector dejó notas (falta la fecha, el
        // importe, o el formato de número es raro), se muestran tal cual.
        const notes = p.diagnostics?.notes ?? []
        const detected = p.diagnostics?.columns
          ?.filter((c) => c.role !== 'ignore')
          .map((c) => `${c.header ?? `columna ${c.index + 1}`} → ${roleLabelEs(c.role)}`)
          .join(', ')
        setError(
          notes.length
            ? notes.join(' ') + (detected ? ` (columnas detectadas: ${detected})` : '')
            : 'Se leyó el archivo pero no se reconoció ningún movimiento. Puede que el formato sea distinto al esperado.'
        )
        setStage('idle')
        return
      }

      setPreview(p)

      // 3. Si el origen se detectó, probamos adivinar la cuenta. Sin corazonada,
      //    dejamos lo que el usuario ya tenía elegido — no le pisamos una decisión.
      const guess = guessAccount(result.source, accounts ?? [])
      if (guess) { setAccountId(guess); setAutoGuessed(true) }

      setStage('preview')
    } catch (e) {
      setError((e as Error).message)
      setStage('idle')
    }
  }, [accounts])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  const commit = async () => {
    if (!read || !accountId) return
    setStage('importing')

    const res = await mutate(
      () =>
        api<{ imported: number; skipped: number }>('/integrations/import/commit', {
          method: 'POST',
          body: { text: read.text, accountId },
        }),
      { toast }
    )

    if (res) {
      // Los duplicados se cuentan aparte y se DICEN. Importar el mismo resumen dos veces
      // es lo más común del mundo, y el motor ya los descarta por content-hash — pero si
      // no se lo decimos, el usuario ve "0 importados" y cree que falló.
      toast(
        res.skipped
          ? `${res.imported} movimientos importados · ${res.skipped} ya estaban`
          : `${res.imported} movimientos importados`,
        'success'
      )
      reset()
    } else {
      setStage('preview')
    }
  }

  const selectedAccount = (accounts ?? []).find((a) => a.id === accountId) ?? null

  return (
    <>
      <TopBar title="Importar" />

      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* ─── PASO 1: el archivo ─── */}
        {stage === 'idle' && (
          <>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className={[
                'rounded-2xl border-2 border-dashed p-16 text-center cursor-pointer',
                'transition-all duration-200',
                dragging
                  ? 'border-gold bg-gold/5 scale-[1.01]'
                  : 'border-line hover:border-line-2 hover:bg-panel/50',
              ].join(' ')}
            >
              <div className="text-5xl mb-4 opacity-60">📥</div>
              <div className="text-lg font-semibold text-txt mb-1">
                {dragging ? 'Soltalo acá' : 'Arrastrá tu resumen'}
              </div>
              <div className="text-sm text-txt-3 mb-6">o hacé clic para elegirlo</div>

              <div className="flex items-center justify-center gap-2 flex-wrap">
                {SUPPORTED_FORMATS.map((f) => (
                  <span
                    key={f}
                    className="text-[11px] font-mono px-2.5 py-1 rounded-md bg-panel-2 border border-line text-txt-3"
                  >
                    {f}
                  </span>
                ))}
              </div>

              <input
                ref={inputRef}
                type="file"
                className="hidden"
                accept={ACCEPTED_EXTENSIONS.join(',')}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleFile(f)
                }}
              />
            </div>

            {error && (
              <Card className="p-4 border-danger/30 bg-danger/5">
                <div className="flex gap-3">
                  <span className="text-danger text-lg leading-none">⚠</span>
                  <div>
                    <div className="text-sm font-medium text-txt mb-0.5">
                      No se pudo leer {file?.name}
                    </div>
                    <div className="text-sm text-txt-2">{error}</div>
                  </div>
                </div>
              </Card>
            )}

            <Card className="p-5">
              <div className="text-sm font-semibold text-txt mb-3">Cómo funciona</div>
              <ol className="space-y-2.5 text-sm text-txt-2">
                {[
                  'Exportá el resumen desde tu homebanking o billetera.',
                  'Arrastralo acá. Detectamos el formato, las columnas y de dónde salió, solos.',
                  'Revisá lo que entendimos —incluida la cuenta y la categoría sugerida— antes de guardar nada.',
                  'Los movimientos repetidos se descartan: podés importar el mismo archivo dos veces sin duplicar.',
                ].map((t, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="text-gold font-mono text-xs mt-0.5">{i + 1}</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ol>
            </Card>
          </>
        )}

        {/* ─── Leyendo ─── */}
        {stage === 'reading' && (
          <Card className="p-16 text-center">
            <Spinner />
            <div className="mt-4 text-sm text-txt-2">Leyendo {file?.name}…</div>
            {file && file.name.toLowerCase().endsWith('.pdf') && (
              <div className="mt-1 text-xs text-txt-3">
                Los PDF tardan un poco más: hay que reconstruir las columnas.
              </div>
            )}
          </Card>
        )}

        {/* ─── PASO 2: la revisión ─── */}
        {stage === 'preview' && preview && read && (
          <>
            <Card className="p-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-txt">{file?.name}</span>
                    <Badge color="#71717A">{read.table.format.toUpperCase()}</Badge>
                    {read.source && (
                      <Badge color="#d4a53a">{read.source.name}</Badge>
                    )}
                  </div>
                  <div className="text-sm text-txt-3">
                    {preview.total} movimiento{preview.total === 1 ? '' : 's'} reconocido
                    {preview.total === 1 ? '' : 's'}
                    {preview.rows.length < preview.total &&
                      ` · se muestran los primeros ${preview.rows.length}`}
                    {!!preview.rejected?.length && (
                      <span className="text-danger">
                        {' '}· {preview.rejected.length} sin reconocer
                      </span>
                    )}
                  </div>
                </div>

                <Button variant="ghost" onClick={reset}>
                  Cambiar archivo
                </Button>
              </div>

              {/* Las filas que no entraron, con el motivo y el texto original. Se muestran
                  SIEMPRE que existan: si algo del resumen no se importó, el usuario tiene
                  que verlo y saber por qué, en vez de descubrir el faltante meses después. */}
              {!!preview.rejected?.length && (
                <div className="mb-4 rounded-[12px] border border-danger/40 bg-danger/5 px-4 py-3">
                  <div className="text-[13px] font-semibold text-danger mb-1.5">
                    {preview.rejected.length} línea
                    {preview.rejected.length === 1 ? '' : 's'} no se pudo leer
                  </div>
                  <div className="text-[12px] text-txt-3 mb-2.5">
                    Estas no se van a importar. Suele ser un formato de fecha o de número
                    distinto al del resto del archivo.
                  </div>
                  <div className="space-y-1.5 max-h-[168px] overflow-y-auto">
                    {preview.rejected.slice(0, 12).map((r, i) => (
                      <div key={i} className="text-[11.5px] flex gap-2.5 items-baseline">
                        <span className="text-txt-3 font-mono shrink-0">L{r.line}</span>
                        <span className="text-danger shrink-0">{r.reason}</span>
                        {r.raw && (
                          <span className="text-txt-3 font-mono truncate">{r.raw.slice(0, 70)}</span>
                        )}
                      </div>
                    ))}
                    {preview.rejected.length > 12 && (
                      <div className="text-[11.5px] text-txt-3">
                        …y {preview.rejected.length - 12} más
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Card>

            {/* La cuenta se elige ACÁ: Cuenta y Moneda de la tabla de abajo salen
                de esta elección, así que tiene que estar resuelta antes de mostrarla. */}
            <Card className="p-5">
              <div className="flex items-end gap-4 flex-wrap">
                <div className="flex-1 min-w-[220px]">
                  <Select
                    label="¿A qué cuenta van?"
                    value={accountId}
                    onChange={(e) => { setAccountId(e.target.value); setAutoGuessed(false) }}
                  >
                    <option value="">Elegí una cuenta…</option>
                    {(accounts ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.currency})
                      </option>
                    ))}
                  </Select>
                </div>
                {autoGuessed && selectedAccount && (
                  <div className="text-[11.5px] text-txt-3 mb-4 max-w-xs">
                    Elegida sola por el origen detectado — cambiala si no es correcta.
                  </div>
                )}
              </div>
              {!accounts?.length && (
                <div className="text-sm text-txt-3">
                  Primero creá una cuenta en <span className="text-txt-2">Cuentas</span>.
                </div>
              )}
            </Card>

            <Card className="overflow-hidden">
              <div className="px-5 py-3 border-b border-line flex items-center justify-between">
                <span className="text-sm font-semibold text-txt">Vista previa</span>
                <span className="text-xs text-txt-3">
                  Revisá que las columnas estén bien antes de importar
                </span>
              </div>

              <div className="overflow-x-auto max-h-[420px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-panel-2 border-b border-line">
                    <tr className="text-left text-xs text-txt-3">
                      <th className="px-4 py-2.5 font-medium">Fecha</th>
                      <th className="px-4 py-2.5 font-medium">Descripción</th>
                      <th className="px-4 py-2.5 font-medium">Cuenta</th>
                      <th className="px-4 py-2.5 font-medium">Moneda</th>
                      <th className="px-4 py-2.5 font-medium">Tipo</th>
                      <th className="px-4 py-2.5 font-medium">Categoría sugerida</th>
                      <th className="px-4 py-2.5 font-medium text-right">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r, i) => (
                      <tr
                        key={i}
                        className="border-b border-line/40 last:border-0 hover:bg-panel-2/50"
                      >
                        <td className="px-4 py-2.5 font-mono text-xs text-txt-2 whitespace-nowrap">
                          {r.date ? fmtDate(r.date) : <span className="text-danger">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-txt max-w-xs truncate">
                          {r.description || <span className="text-txt-3">sin descripción</span>}
                        </td>
                        <td className="px-4 py-2.5 text-txt-2 max-w-[140px] truncate whitespace-nowrap">
                          {selectedAccount?.name ?? <span className="text-txt-3">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-txt-3 whitespace-nowrap">
                          {selectedAccount?.currency ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          {r.amount == null ? (
                            <span className="text-txt-3">—</span>
                          ) : r.amount >= 0 ? (
                            <Badge color="#5bbf7a">Ingreso</Badge>
                          ) : (
                            <Badge color="#6a6a74">Gasto</Badge>
                          )}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          {r.category ? (
                            <Badge color={r.category.color}>{r.category.name}</Badge>
                          ) : (
                            <span className="text-txt-3 text-xs">sin sugerencia</span>
                          )}
                        </td>
                        <td
                          className={[
                            'px-4 py-2.5 text-right font-mono whitespace-nowrap',
                            r.amount == null
                              ? 'text-danger'
                              : r.amount >= 0
                                ? 'text-success'
                                : 'text-txt',
                          ].join(' ')}
                        >
                          {r.amount == null ? '—' : ARS(r.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* ─── PASO 3: importar ─── */}
            <Card className="p-5">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="text-sm text-txt-2">
                  {preview.total} movimiento{preview.total === 1 ? '' : 's'} listo
                  {preview.total === 1 ? '' : 's'} para importar
                  {selectedAccount && <> a <b className="text-txt">{selectedAccount.name}</b></>}
                </div>
                <Button
                  onClick={commit}
                  disabled={!accountId || saving}
                  loading={saving}
                >
                  Importar {preview.total} movimiento{preview.total === 1 ? '' : 's'}
                </Button>
              </div>
            </Card>
          </>
        )}

        {stage === 'idle' && !error && !accounts?.length && (
          <EmptyState
            icon="🏦"
            title="Todavía no tenés cuentas"
            description="Creá una cuenta antes de importar movimientos: los movimientos tienen que ir a algún lado."
          />
        )}
      </div>
    </>
  )
}
