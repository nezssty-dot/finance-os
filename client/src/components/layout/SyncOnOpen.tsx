import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { useStore } from '@/lib/store'

/**
 * "Sincronizando..." al abrir la app.
 *
 * Corre una sola vez cuando entrás (monta con el AppShell), llama a /integrations/sync-all
 * y muestra el resultado por proveedor, como una notificación abajo a la derecha. Cuando
 * termina, refresca los datos (bump del dataVersion) para que TODO —dashboard, patrimonio,
 * timeline, forecast— tome lo nuevo sin que toques nada. A los pocos segundos se va solo.
 *
 * Por qué acá y no en el arranque de Electron: si la sync se cuelga o tarda, la app tiene
 * que abrir igual. Esto es una llamada normal montada en el front — nunca bloquea el inicio.
 * Si no hay ninguna cuenta conectada, no muestra nada.
 */

interface SyncResult {
  provider: string
  label: string
  ok: boolean
  summary: string
  imported?: number
  updated?: number
}

export function SyncOnOpen() {
  const refresh = useStore((s) => s.refresh)
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle')
  const [results, setResults] = useState<SyncResult[]>([])
  const ran = useRef(false)

  useEffect(() => {
    // Guard: en dev, React monta dos veces (StrictMode). Sin esto, sincronizaría dos veces.
    if (ran.current) return
    ran.current = true

    let alive = true
    ;(async () => {
      try {
        const res = await api<{ synced: number; results: SyncResult[] }>('/integrations/sync-all', {
          method: 'POST',
        })
        if (!alive) return
        if (!res.synced) return // no hay cuentas conectadas: no molestar

        setResults(res.results)
        setPhase('running')

        // Un beat para que se lea el "Sincronizando...", después el resultado.
        setTimeout(() => {
          if (!alive) return
          setPhase('done')
          // Si algo entró, refrescar para que la app tome lo nuevo.
          if (res.results.some((r) => (r.imported ?? 0) + (r.updated ?? 0) > 0)) refresh()
          // Y a los segundos, desaparece.
          setTimeout(() => alive && setPhase('idle'), 4000)
        }, 900)
      } catch {
        // Si la sync falla entera, no se muestra nada: la app funciona igual con lo que ya hay.
      }
    })()

    return () => {
      alive = false
    }
  }, [refresh])

  if (phase === 'idle') return null

  return (
    <div className="fixed bottom-5 right-5 z-50 w-[300px] animate-fade-in">
      <div className="bg-panel border border-line rounded-card shadow-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center gap-2.5">
          {phase === 'running' ? (
            <span className="w-4 h-4 rounded-full border-2 border-gold border-t-transparent animate-spin shrink-0" />
          ) : (
            <span className="w-4 h-4 rounded-full bg-success grid place-items-center shrink-0">
              <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 text-bg" fill="none" stroke="currentColor" strokeWidth="4">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </span>
          )}
          <span className="text-[13px] font-semibold">
            {phase === 'running' ? 'Sincronizando…' : 'Listo'}
          </span>
        </div>
        <div className="px-4 py-2.5 space-y-2">
          {results.map((r) => (
            <div key={r.provider} className="flex items-center gap-2 text-[12.5px]">
              <span className={`shrink-0 ${r.ok ? 'text-success' : 'text-danger'}`}>
                {r.ok ? '✓' : '✕'}
              </span>
              <span className="font-medium text-txt">{r.label}</span>
              <span className="text-txt-3 ml-auto text-right">{r.summary}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
