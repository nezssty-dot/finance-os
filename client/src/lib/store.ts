import { create } from 'zustand'
import { api, setToken, getToken } from './api'

export type User = {
  id: string
  email: string
  name: string
  currency: string
  /** null = brand new account, the welcome wizard hasn't run yet */
  onboardedAt: string | null
}

interface AppState {
  user: User | null
  year: number
  loading: boolean
  /**
   * Bumped after every mutation. Every screen's data depends on it, so saving a
   * movement anywhere makes the dashboard, the net worth and the charts redraw on
   * their own. There is no "refresh" button because there is nothing to refresh.
   */
  dataVersion: number
  refresh: () => void
  setUser: (u: User) => void
  setYear: (y: number) => void
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  checkAuth: () => Promise<boolean>
}

export const useStore = create<AppState>((set) => ({
  user: null,
  year: new Date().getFullYear(),
  loading: true,
  dataVersion: 0,
  refresh: () => set((s) => ({ dataVersion: s.dataVersion + 1 })),
  setUser: (u) => set({ user: u }),
  setYear: (y) => set({ year: y }),

  login: async (email, password) => {
    const d = await api<{ accessToken: string; user: User }>('/auth/login', { method: 'POST', body: { email, password } })
    setToken(d.accessToken)
    set({ user: d.user })
  },

  register: async (name, email, password) => {
    const d = await api<{ accessToken: string; user: User }>('/auth/register', { method: 'POST', body: { name, email, password } })
    setToken(d.accessToken)
    set({ user: d.user })
  },

  logout: async () => {
    try { await api('/auth/logout', { method: 'POST' }) } catch {}
    setToken(null)
    set({ user: null })
  },

  checkAuth: async () => {
    if (!getToken()) {
      try {
        const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
        if (!r.ok) { set({ loading: false }); return false }
        const d = await r.json()
        setToken(d.accessToken)
      } catch { set({ loading: false }); return false }
    }
    try {
      const user = await api<User>('/auth/me')
      set({ user, loading: false })
      return true
    } catch { set({ loading: false }); return false }
  },
}))
