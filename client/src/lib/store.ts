import { create } from 'zustand'
import { api, setToken } from './api'

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
    // Finance OS es local y de un solo usuario por máquina: no hay credenciales que
    // pedir. Esta ruta resuelve (o crea, la primera vez) el usuario dueño de esta
    // instalación y abre sesión sola, sin pasar por /login.
    try {
      const d = await api<{ accessToken: string; user: User }>('/auth/local', { method: 'POST' })
      setToken(d.accessToken)
      set({ user: d.user, loading: false })
      return true
    } catch { set({ loading: false }); return false }
  },
}))
