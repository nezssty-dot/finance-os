const BASE = '/api'
let token: string | null = null

export function setToken(t: string | null) { token = t }
export function getToken() { return token }

async function refreshToken(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
    if (!r.ok) return false
    const d = await r.json()
    setToken(d.accessToken)
    return true
  } catch { return false }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; retry?: boolean } = {}): Promise<T> {
  const { method = 'GET', body, retry = true } = opts
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const r = await fetch(`${BASE}${path}`, {
    method, headers, credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  })
  if (r.status === 401 && retry && await refreshToken()) return api(path, { method, body, retry: false })
  if (r.status === 204) return null as T
  const data = await r.json().catch(() => null)
  if (!r.ok) throw new Error(data?.error || 'Error del servidor')
  return data as T
}

/**
 * Downloads a file from an authenticated endpoint.
 * A plain link can't do this: the access token is held in memory only (never in
 * localStorage), so the browser would send the request unauthenticated.
 */
export async function download(path: string, filename: string): Promise<void> {
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`

  let r = await fetch(`${BASE}${path}`, { headers, credentials: 'include' })
  if (r.status === 401 && (await refreshToken())) {
    if (token) headers.Authorization = `Bearer ${token}`
    r = await fetch(`${BASE}${path}`, { headers, credentials: 'include' })
  }
  if (!r.ok) throw new Error('No se pudo generar el archivo')

  const blob = await r.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
