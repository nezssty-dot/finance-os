import { Link } from 'react-router-dom'
import { Activity, Tag, ShieldCheck, LineChart, Landmark, Repeat, TrendingUp, CreditCard } from 'lucide-react'
import { TopBar } from '@/components/layout/TopBar'
import { Card } from '@/components/ui'

// Hub de las funciones que se sacaron del riel lateral para no inflarlo de íconos
// (ver NOTAS-CONSOLIDACION.md). Timeline vivía en Movimientos, Categorías/Auditoría en
// Configuración, Forecast en Insights, y Cuentas/Servicios/Inversiones/Deudas tenían
// ícono propio — ahora todas cuelgan de un único ítem "Más" al final del riel, y
// siguen accesibles con un link directo desde acá. Importar NO vive acá: ahora es un
// botón dentro de Movimientos (ver ImportButton en esa página).
const ITEMS = [
  { to: '/cuentas', label: 'Cuentas', desc: 'Tus cuentas y sus saldos.', Icon: Landmark },
  { to: '/servicios', label: 'Servicios', desc: 'Suscripciones y pagos recurrentes.', Icon: Repeat },
  { to: '/inversiones', label: 'Inversiones', desc: 'Lo que tenés invertido.', Icon: TrendingUp },
  { to: '/deudas', label: 'Deudas', desc: 'Lo que debés y a quién.', Icon: CreditCard },
  { to: '/timeline', label: 'Timeline', desc: 'Tu actividad día a día en una línea de tiempo.', Icon: Activity },
  { to: '/categorias', label: 'Categorías', desc: 'Creá, fusioná y ordená tus categorías.', Icon: Tag },
  { to: '/auditoria', label: 'Auditoría', desc: 'Revisá que tus balances del mes cierren.', Icon: ShieldCheck },
  { to: '/forecast', label: 'Forecast', desc: 'Proyección de tu plata a futuro.', Icon: LineChart },
]

export function Mas() {
  return (
    <>
      <TopBar title="Más" sub="El resto de las herramientas de Finance OS" />
      <div className="p-7 animate-fade-in">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ITEMS.map((i) => (
            <Link key={i.to} to={i.to}>
              <Card className="h-full hover:ring-1 hover:ring-accent-line transition-all">
                <span className="w-11 h-11 rounded-full bg-accent-dim text-accent-2 flex items-center justify-center mb-3">
                  <i.Icon size={19} strokeWidth={2} />
                </span>
                <h3 className="text-title mb-1">{i.label}</h3>
                <p className="text-[12.5px] text-txt-3 leading-relaxed">{i.desc}</p>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </>
  )
}
