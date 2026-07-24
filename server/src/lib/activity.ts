/**
 * Resumen de actividad reciente: hoy, esta semana, este mes. PURO: sin base, sin red.
 *
 * Alimenta las tarjetas "vivas" del dashboard —lo que ganaste y gastaste hoy, y cómo va
 * el balance de la semana y del mes— para que la pantalla muestre movimiento real y no
 * solo totales estáticos. Todo derivado de los movimientos, la única fuente de verdad.
 */

export interface ActivityMovement {
  date: Date | string;
  type: string;
  amount: number | string;
}

export interface ActivitySummary {
  todayIncome: number;
  todayExpense: number;
  weekIncome: number;
  weekExpense: number;
  weekBalance: number;
  monthIncome: number;
  monthExpense: number;
  monthBalance: number;
}

/** Inicio del día (medianoche local) de una fecha. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Inicio de la semana, tomando el LUNES como primer día (como en Argentina), a la
 * medianoche.
 */
function startOfWeek(d: Date): Date {
  const day = startOfDay(d);
  const dow = (day.getDay() + 6) % 7; // 0 = lunes … 6 = domingo
  day.setDate(day.getDate() - dow);
  return day;
}

/**
 * Suma ingresos y gastos por ventana temporal. Solo cuenta INCOME y EXPENSE: mover plata
 * entre cuentas o apartar para un objetivo no es ni ingreso ni gasto.
 */
export function activitySummary(movements: ActivityMovement[], now: Date = new Date()): ActivitySummary {
  const dayStart = startOfDay(now).getTime();
  const dayEnd = dayStart + 864e5; // + 1 día
  const weekStart = startOfWeek(now).getTime();
  const weekEnd = weekStart + 7 * 864e5;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();

  const s: ActivitySummary = {
    todayIncome: 0, todayExpense: 0,
    weekIncome: 0, weekExpense: 0, weekBalance: 0,
    monthIncome: 0, monthExpense: 0, monthBalance: 0,
  };

  for (const m of movements) {
    if (m.type !== "INCOME" && m.type !== "EXPENSE") continue;
    const t = new Date(m.date).getTime();
    if (Number.isNaN(t)) continue;
    const amount = Math.abs(Number(m.amount) || 0);
    const isIncome = m.type === "INCOME";

    // Cada ventana es un rango cerrado-abierto [inicio, fin): así un movimiento con fecha
    // futura (mañana, la semana que viene) NO se cuela en la ventana de hoy/esta semana.
    if (t >= monthStart && t < monthEnd) {
      if (isIncome) s.monthIncome += amount;
      else s.monthExpense += amount;
    }
    if (t >= weekStart && t < weekEnd) {
      if (isIncome) s.weekIncome += amount;
      else s.weekExpense += amount;
    }
    if (t >= dayStart && t < dayEnd) {
      if (isIncome) s.todayIncome += amount;
      else s.todayExpense += amount;
    }
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  s.todayIncome = round(s.todayIncome);
  s.todayExpense = round(s.todayExpense);
  s.weekIncome = round(s.weekIncome);
  s.weekExpense = round(s.weekExpense);
  s.monthIncome = round(s.monthIncome);
  s.monthExpense = round(s.monthExpense);
  s.weekBalance = round(s.weekIncome - s.weekExpense);
  s.monthBalance = round(s.monthIncome - s.monthExpense);

  return s;
}
