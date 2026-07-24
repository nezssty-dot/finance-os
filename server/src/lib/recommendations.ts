/**
 * Recomendaciones financieras accionables. PURO: sin base, sin red.
 *
 * A diferencia de las estadísticas ("gastaste X"), esto sugiere QUÉ HACER: dónde recortar,
 * qué deuda conviene cancelar, si estás muy concentrado en una cuenta, etc. Cada consejo
 * sale de una regla clara sobre el snapshot financiero, así que es explicable y testeable.
 *
 * Nunca inventa plata ni mezcla monedas: trabaja sobre el disponible/patrimonio en ARS que
 * le pasa el motor financiero. Si un dato falta, esa recomendación simplemente no aparece.
 */

export interface RecoSnapshot {
  monthIncome: number;
  monthExpense: number;
  avgMonthlyIncome: number;
  avgMonthlyExpense: number;
  /** Categorías de gasto de ESTE mes: { name, amount }. */
  categoriesThisMonth: { name: string; amount: number }[];
  /** Promedio mensual por categoría (para detectar excesos). */
  categoryAverages?: Record<string, number>;
  /** Cuentas con su saldo en ARS (para detectar concentración). */
  accounts: { name: string; balance: number }[];
  /** Deudas abiertas con lo que falta pagar. */
  debts: { name: string; outstanding: number }[];
  disponibleARS: number;
  invertidoARS: number;
  netWorthARS: number;
  /** Gasto mensual en suscripciones (servicios recurrentes), si se conoce. */
  subscriptionsMonthly?: number;
  subscriptionCount?: number;
  /** Ahorro proyectado a fin de año al ritmo actual, si se conoce. */
  projectedYearEndSavings?: number;
}

export interface Recommendation {
  text: string;
  tone: "good" | "warn" | "tip";
  /** Menor = más importante. Para ordenar. */
  priority: number;
}

// Categorías que suelen ser recortables (ocio/discrecional). Se comparan normalizadas.
const DISCRETIONARY = ["ocio", "salidas", "delivery", "comida afuera", "restaurant", "entretenimiento", "streaming", "compras", "ropa", "juegos", "bar"];

function norm(s: string): string {
  return String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}
function isDiscretionary(name: string): boolean {
  const n = norm(name);
  return DISCRETIONARY.some((d) => n.includes(d));
}
function pesos(n: number): string {
  return "$" + Math.round(n).toLocaleString("es-AR");
}
function pct(n: number): number {
  return Math.round(n * 100);
}

export function recommendations(s: RecoSnapshot): Recommendation[] {
  const out: Recommendation[] = [];

  const savingsRate = s.monthIncome > 0 ? (s.monthIncome - s.monthExpense) / s.monthIncome : 0;

  // 1) Gastás más de lo que entra este mes.
  if (s.monthExpense > s.monthIncome && s.monthIncome > 0) {
    const gap = s.monthExpense - s.monthIncome;
    out.push({
      text: `Este mes gastaste ${pesos(gap)} más de lo que entró. Revisá los gastos grandes antes de que se vuelva costumbre.`,
      tone: "warn",
      priority: 1,
    });
  }

  // 2) Tasa de ahorro baja + dónde recortar concretamente.
  if (s.monthIncome > 0 && savingsRate < 0.1 && savingsRate >= 0) {
    out.push({
      text: `Estás ahorrando el ${pct(savingsRate)}% de lo que entra. Por debajo del 10% cuesta construir un colchón.`,
      tone: "warn",
      priority: 2,
    });
    // El gasto discrecional más grande, con una meta de recorte del 15%.
    const disc = s.categoriesThisMonth
      .filter((c) => isDiscretionary(c.name))
      .sort((a, b) => b.amount - a.amount)[0];
    if (disc && disc.amount > 0) {
      const saving = disc.amount * 0.15;
      out.push({
        text: `Podrías sumar ${pesos(saving)} al mes recortando un 15% lo que gastás en ${disc.name} (hoy ${pesos(disc.amount)}).`,
        tone: "tip",
        priority: 3,
      });
    }
  }

  // 3) ¿Podés cancelar alguna deuda sin quedarte sin liquidez?
  //    Regla conservadora: la deuda entra en la MITAD de tu disponible.
  if (s.debts.length && s.disponibleARS > 0) {
    const payable = s.debts
      .filter((d) => d.outstanding > 0 && d.outstanding <= s.disponibleARS * 0.5)
      .sort((a, b) => a.outstanding - b.outstanding)[0];
    if (payable) {
      out.push({
        text: `Podrías cancelar la deuda "${payable.name}" (${pesos(payable.outstanding)}) este mes sin comprometer tu liquidez.`,
        tone: "tip",
        priority: 4,
      });
    }
  }

  // 4) Concentración: una cuenta con demasiada plata.
  const totalFunds = s.accounts.reduce((a, c) => a + Math.max(0, c.balance), 0);
  if (totalFunds > 0) {
    const top = [...s.accounts].sort((a, b) => b.balance - a.balance)[0];
    if (top && top.balance > 0) {
      const share = top.balance / totalFunds;
      if (share > 0.6) {
        out.push({
          text: `${top.name} concentra el ${pct(share)}% de tus fondos. Diversificar en más de una cuenta reduce riesgo.`,
          tone: "tip",
          priority: 5,
        });
      }
    }
  }

  // 5) Suscripciones pesando sobre el ingreso.
  if (s.subscriptionsMonthly && s.monthIncome > 0) {
    const share = s.subscriptionsMonthly / s.monthIncome;
    if (share > 0.1) {
      const cnt = s.subscriptionCount ?? 0;
      out.push({
        text: `Tus suscripciones son ${pesos(s.subscriptionsMonthly)} por mes${cnt ? ` (${cnt} activas)` : ""}, un ${pct(share)}% de tu ingreso. Revisá si usás todas.`,
        tone: "warn",
        priority: 6,
      });
    }
  }

  // 6) Exceso puntual en una categoría respecto a su promedio.
  if (s.categoryAverages) {
    let worst: { name: string; over: number; amount: number } | null = null;
    for (const c of s.categoriesThisMonth) {
      const avg = s.categoryAverages[c.name];
      if (avg && avg > 0 && c.amount > avg * 1.3) {
        const over = (c.amount - avg) / avg;
        if (!worst || over > worst.over) worst = { name: c.name, over, amount: c.amount };
      }
    }
    if (worst) {
      out.push({
        text: `Gastaste un ${pct(worst.over)}% más en ${worst.name} que tu promedio (${pesos(worst.amount)} este mes).`,
        tone: "warn",
        priority: 7,
      });
    }
  }

  // 7) Peso de las inversiones en el patrimonio (contexto, no alarma).
  if (s.netWorthARS > 0 && s.invertidoARS > 0) {
    const share = s.invertidoARS / s.netWorthARS;
    out.push({
      text: `Tus inversiones equivalen al ${pct(share)}% de tu patrimonio.`,
      tone: share >= 0.2 ? "good" : "tip",
      priority: 8,
    });
  }

  // 8) Proyección de cierre de año.
  if (typeof s.projectedYearEndSavings === "number") {
    const p = s.projectedYearEndSavings;
    out.push({
      text:
        p >= 0
          ? `Al ritmo actual cerrás el año con ${pesos(p)} ahorrados.`
          : `Al ritmo actual cerrás el año ${pesos(Math.abs(p))} en rojo. Ajustar ahora te da margen.`,
      tone: p >= 0 ? "good" : "warn",
      priority: 9,
    });
  }

  // 9) Refuerzo positivo si venís bien.
  if (s.monthIncome > 0 && savingsRate >= 0.2) {
    out.push({
      text: `Vas muy bien: estás ahorrando el ${pct(savingsRate)}% de lo que entra. Sostené el ritmo.`,
      tone: "good",
      priority: 2,
    });
  }

  return out.sort((a, b) => a.priority - b.priority);
}
