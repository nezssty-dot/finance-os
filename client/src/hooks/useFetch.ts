import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import { useStore } from '@/lib/store'

/**
 * Data fetching that re-runs whenever anything in the app mutates.
 * That is what makes the numbers update on their own after a save.
 */
export function useFetch<T>(path: string | null, deps: unknown[] = []) {
  const dataVersion = useStore((s) => s.dataVersion)
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!path) { setLoading(false); return }
    let cancelled = false
    setError(null)
    api<T>(path)
      .then((d) => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch((e) => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, dataVersion, ...deps])

  const refetch = useCallback(() => {
    if (!path) return
    api<T>(path).then(setData).catch((e) => setError(e.message))
  }, [path])

  return { data, loading, error, refetch }
}

/**
 * Wraps a mutation: shows a toast, bumps dataVersion so every screen redraws,
 * and surfaces errors instead of swallowing them.
 */
export function useMutate() {
  const refresh = useStore((s) => s.refresh)
  const [saving, setSaving] = useState(false)

  const mutate = useCallback(
    async <T,>(
      fn: () => Promise<T>,
      opts: { onSuccess?: (r: T) => void; toast?: (t: string, k?: 'success' | 'error' | 'info') => void; success?: string } = {}
    ): Promise<T | null> => {
      setSaving(true)
      try {
        const result = await fn()
        refresh()
        if (opts.success && opts.toast) opts.toast(opts.success, 'success')
        opts.onSuccess?.(result)
        return result
      } catch (e: any) {
        opts.toast?.(e.message || 'Algo salió mal', 'error')
        return null
      } finally {
        setSaving(false)
      }
    },
    [refresh]
  )

  return { mutate, saving }
}
