import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useStore } from '@/lib/store'

export function Login() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('')
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false)
  const { login } = useStore(); const nav = useNavigate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError('')
    try { await login(email, password); nav('/') } catch (e: any) { setError(e.message) }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[radial-gradient(1200px_600px_at_50%_-10%,rgba(212,165,58,.07),transparent_60%)]">
      <div className="w-full max-w-sm bg-panel border border-line rounded-[20px] p-8 shadow-2xl animate-fade-in">
        <div className="flex items-center gap-2.5 justify-center font-extrabold text-[19px] mb-1.5">
          <span className="w-[34px] h-[34px] rounded-[10px] bg-gradient-to-br from-gold to-[#a87d1f] flex items-center justify-center text-[#1a1206] font-black text-[19px] shadow-lg shadow-gold/20">F</span>
          Finance OS
        </div>
        <p className="text-center text-txt-3 text-sm mb-6">Ingresá a tu cuenta</p>
        {error && <div className="bg-danger text-white text-sm px-3.5 py-2.5 rounded-btn mb-4">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="mb-3.5"><label className="block text-xs font-semibold text-txt-2 mb-1.5">Email</label><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="w-full bg-bg-2 border border-line text-txt px-3 py-2.5 rounded-btn text-sm focus:outline-none focus:border-gold-line" placeholder="vos@email.com" /></div>
          <div className="mb-3.5"><label className="block text-xs font-semibold text-txt-2 mb-1.5">Contraseña</label><input value={password} onChange={(e) => setPassword(e.target.value)} type="password" className="w-full bg-bg-2 border border-line text-txt px-3 py-2.5 rounded-btn text-sm focus:outline-none focus:border-gold-line" placeholder="••••••••" /></div>
          <button disabled={loading} className="w-full py-3 bg-gold hover:bg-gold-2 text-[#1a1206] font-bold rounded-[12px] text-[14.5px] transition-colors disabled:opacity-50 mt-1">{loading ? 'Ingresando…' : 'Ingresar'}</button>
        </form>
        <p className="text-center text-txt-3 text-sm mt-5">¿No tenés cuenta? <Link to="/register" className="text-gold-2 hover:underline">Registrate</Link></p>
        <p className="text-center text-txt-3 text-xs mt-3">Demo: demo@financeos.app / demo1234</p>
      </div>
    </div>
  )
}
