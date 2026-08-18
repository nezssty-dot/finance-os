/**
 * Salud financiera: un puntaje 0-100. PURO: sin base, sin fechas ocultas.
 *
 * ─── LA REGLA QUE MANDA: TODO PUNTO SE PUEDE EXPLICAR ───
 *
 * Un puntaje de salud que no podés desarmar es un horóscopo. Acá el número es la suma de
 * factores con peso fijo, y cada factor produce su propia línea (✔ o ⚠) con el porqué.
 * La lista de señales NO es decorativa: es literalmente de dónde sale el número. Si te da
 * 85, podés ver exactamente qué te sumó y qué te restó.
 *
 * Es una heurística, no una verdad revelada. Por eso los umbrales son explícitos y
 * discutibles, y están acá arriba para poder ajustarlos sin cazar magia por el código.
 *
 * ─── POR QUÉ ESTOS FACTORES ───
 *
 * Son los que un asesor miraría primero, y los que el usuario dibujó: cuánto ahorrás, si
 * tenés deudas, si el flujo cierra, cuánto pesan las suscripciones, y si un solo gasto
 * discrecional se te está yendo de las manos. Todo en pesos (ARS): la salud se mide en la
 * moneda en la que vivís el día a día.
 */

// Pesos de cada factor. Suman 100. Cambiar acá cambia el puntaje, a la vista.
const WEIGHTS = {
  savings: 35, // lo que más define la salud: ¿te queda plata al final del mes?
  debt: 25, // ¿debés, y cuánto respecto a lo que ganás?
  cashflow: 20, // ¿los ingresos cubren los gastos, o vivís en rojo?
  subscriptions: 10, // ¿las suscripciones se comen una parte sana o desproporcionada?
  concentration: 10, // ¿hay un gasto discrecional que domina todo?
} as const;

// Umbrales, todos discutibles y a la vista.
const SAVINGS_GREAT = 0.3; // ahorrar 30%+ del ingreso = tope del factor
const SUBS_OK = 0.15; // suscripciones bajo el 15% del ingreso = sano
const SUBS_HIGH = 0.3; // arriba del 30% = alerta
const CONCENTRATION_HIGH = 0.25; // un rubro discrecional >25% del gasto = alerta
// Rubros que cuentan como "discrecional" para la alerta de concentración. Comida del súper
// o servicios no entran: son necesarios. Delivery, compras y salidas sí.
const DISCRETIONARY = new Set(["DELIVERY", "COMPRAS", "COMIDA"]);

export interface HealthInput {
  /** Ingreso del período (mes actual o promedio reciente), en ARS. */
  income: number;
  /** Gasto del período, en ARS. */
  expense: number;
  /** Deuda pendiente total (lo que debés), en ARS. */
  debtOutstanding: number;
  /** Gasto mensual comprometido en servicios/suscripciones (ARS). */
  monthlyServices: number;
  /** Cuántos servicios activos hay. */
  serviceCount: number;
  /** Gasto por categoría del período: { DELIVERY: 45000, ... } en ARS. */
  categorySpend: Record<string, number>;
}

export interface HealthFactor {
  ok: boolean;
  label: string;
  /** Puntos que aportó este factor (0..peso). Para poder auditar el total. */
  points: number;
  max: number;
}

export interface HealthResult {
  score: number; // 0..100, entero
  rating: string; // "Excelente" | "Muy bien" | "Bien" | "Regular" | "Atención"
  factors: HealthFactor[];
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function ratingFor(score: number): string {
  if (score >= 80) return "Excelente";
  if (score >= 65) return "Muy bien";
  if (score >= 50) return "Bien";
  if (score >= 35) return "Regular";
  return "Atención";
}

export function computeHealth(input: HealthInput): HealthResult {
  const { income, expense, debtOutstanding, monthlyServices, serviceCount, categorySpend } = input;

  const factors: HealthFactor[] = [];

  // ── Ahorro (35) ──
  // Proporción del ingreso que te queda. Ahorrar 30%+ es el tope; negativo es 0.
  const savingsRate = income > 0 ? (income - expense) / income : 0;
  const savingsScore = clamp01(savingsRate / SAVINGS_GREAT) * WEIGHTS.savings;
  factors.push({
    ok: savingsRate >= 0.1,
    label:
      savingsRate >= 0.1
        ? `Ahorrás el ${Math.round(savingsRate * 100)}% de lo que ingresás`
        : savingsRate >= 0
          ? `Ahorrás poco: ${Math.round(savingsRate * 100)}% del ingreso`
          : `Gastás más de lo que ingresás`,
    points: Math.round(savingsScore),
    max: WEIGHTS.savings,
  });

  // ── Deuda (25) ──
  // Sin deuda = tope. Con deuda, se descuenta según cuánto pesa contra el ingreso:
  // deber medio ingreso mensual no es lo mismo que deber tres.
  let debtScore: number;
  let debtOk: boolean;
  let debtLabel: string;
  if (debtOutstanding <= 0) {
    debtScore = WEIGHTS.debt;
    debtOk = true;
    debtLabel = "Sin deudas";
  } else if (income > 0) {
    const ratio = debtOutstanding / income; // deuda en "meses de ingreso"
    debtScore = clamp01(1 - ratio / 3) * WEIGHTS.debt; // 3 meses de ingreso o más → 0
    debtOk = ratio <= 1;
    debtLabel = debtOk
      ? `Deuda manejable (menos de un mes de ingreso)`
      : `Deuda alta: ${ratio.toFixed(1)} meses de ingreso`;
  } else {
    debtScore = 0;
    debtOk = false;
    debtLabel = "Tenés deuda y no hay ingresos registrados";
  }
  factors.push({ ok: debtOk, label: debtLabel, points: Math.round(debtScore), max: WEIGHTS.debt });

  // ── Flujo de caja (20) ──
  // ¿El ingreso cubre el gasto? Es parecido al ahorro pero mira lo binario: estar en
  // verde o en rojo. Un mes podés ahorrar poco (bajo en el factor ahorro) pero seguir en
  // verde (bien acá).
  const flowOk = income >= expense;
  const flowScore = flowOk
    ? WEIGHTS.cashflow
    : income > 0
      ? // Cuánto te PASÁS respecto a tu ingreso: gastar 60% de más pega más que gastar
        // 10% de más. Es más honesto que mirar income/expense a secas, que era demasiado
        // benévolo con el sobregasto fuerte.
        clamp01(1 - (expense - income) / income) * WEIGHTS.cashflow
      : 0;
  factors.push({
    ok: flowOk,
    label: flowOk ? "Buen flujo: cubrís tus gastos" : "Flujo ajustado: los gastos superan los ingresos",
    points: Math.round(flowScore),
    max: WEIGHTS.cashflow,
  });

  // ── Suscripciones (10) ──
  // Cuánto del ingreso se va en servicios fijos. Sano bajo 15%, alerta sobre 30%.
  const subsRate = income > 0 ? monthlyServices / income : 0;
  let subsScore: number;
  if (subsRate <= SUBS_OK) subsScore = WEIGHTS.subscriptions;
  else if (subsRate >= SUBS_HIGH) subsScore = 0;
  else subsScore = clamp01((SUBS_HIGH - subsRate) / (SUBS_HIGH - SUBS_OK)) * WEIGHTS.subscriptions;
  const subsOk = subsRate <= SUBS_OK;
  factors.push({
    ok: subsOk,
    label: subsOk
      ? serviceCount > 0
        ? `Suscripciones bajo control (${serviceCount})`
        : "Sin gastos fijos cargados"
      : `Muchas suscripciones: ${Math.round(subsRate * 100)}% de tu ingreso`,
    points: Math.round(subsScore),
    max: WEIGHTS.subscriptions,
  });

  // ── Concentración de gasto discrecional (10) ──
  // ¿Un solo rubro que podrías recortar se está comiendo todo? Delivery es el ejemplo
  // clásico. Se mira contra el gasto total, no el ingreso.
  let worstCat: string | null = null;
  let worstShare = 0;
  if (expense > 0) {
    for (const [cat, amt] of Object.entries(categorySpend)) {
      if (!DISCRETIONARY.has(cat)) continue;
      const share = amt / expense;
      if (share > worstShare) {
        worstShare = share;
        worstCat = cat;
      }
    }
  }
  const concentrationOk = worstShare < CONCENTRATION_HIGH;
  const concentrationScore = concentrationOk
    ? WEIGHTS.concentration
    : clamp01(1 - (worstShare - CONCENTRATION_HIGH) / CONCENTRATION_HIGH) * WEIGHTS.concentration;
  factors.push({
    ok: concentrationOk,
    label:
      concentrationOk || !worstCat
        ? "Gastos repartidos, sin excesos"
        : `${titleCase(worstCat)} alto: ${Math.round(worstShare * 100)}% de tus gastos`,
    points: Math.round(concentrationScore),
    max: WEIGHTS.concentration,
  });

  const score = Math.round(factors.reduce((s, f) => s + f.points, 0));
  return { score, rating: ratingFor(score), factors };
}

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}
