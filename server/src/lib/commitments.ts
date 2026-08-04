/**
 * Compromisos recurrentes (servicios y suscripciones). PURO: sin base, sin red.
 *
 * ─── QUÉ RESUELVE ───
 *
 * Dos preguntas distintas que la app mezclaba en una sola:
 *
 *   1. "¿Cuánto necesito TODOS los meses?"  → los servicios mensuales.
 *   2. "¿Cuánto me sale al año lo anual?"   → los anuales, que caen UNA vez.
 *
 * Meterlos en el mismo número engaña: si Pro Tools sale US$300 al año, contarlo como
 * US$25 por mes hace parecer que todos los meses necesitás esa plata, y no es así — el
 * mes que vence necesitás los 300 enteros. Por eso acá van SEPARADOS.
 *
 * Además convierte todo a la moneda que elija el usuario con la cotización del día, para
 * poder comparar peras con peras. Un servicio en dólares y uno en pesos no se suman
 * crudos: eso da un número sin sentido.
 *
 * ─── LA REGLA DE SIEMPRE ───
 *
 * Si no hay cotización, NO se inventa. El total convertido queda en null y se marca
 * `complete: false`, para que la pantalla avise en vez de mostrar un número incompleto
 * como si fuera exacto.
 */

import type { Frequency } from "./services-math";

export interface CommitmentService {
  name?: string;
  amount: number;
  currency?: string;
  frequency: Frequency;
  interval?: number;
  active?: boolean;
}

export interface CommitmentGroup {
  /** Montos en su moneda original, sin mezclar. */
  byCurrency: Record<string, number>;
  /** Total convertido a la moneda elegida, o null si faltó cotización. */
  converted: number | null;
  /** false = quedó plata sin convertir; el total NO está completo. */
  complete: boolean;
  /** Cuántos servicios entraron en este grupo. */
  count: number;
}

export interface CommitmentSummary {
  /** Lo que se paga todos los meses (mensuales y semanales). */
  monthly: CommitmentGroup;
  /** Los anuales, con su monto ANUAL completo (no dividido). */
  annual: CommitmentGroup;
  /** El equivalente mensual de los anuales, para quien quiera ahorrarlo de a poco. */
  annualPerMonth: number | null;
  /** La moneda en la que están los totales convertidos. */
  currency: string;
  /** La cotización usada (null si no había). */
  rate: number | null;
}

/** Convierte un monto entre ARS y USD. Devuelve null si no hay cotización. */
function convertAmount(
  amount: number,
  from: string,
  to: string,
  rate: number | null
): number | null {
  if (from === to) return amount;
  if (rate === null || !Number.isFinite(rate) || rate <= 0) return null;
  if (from === "USD" && to === "ARS") return amount * rate;
  if (from === "ARS" && to === "USD") return amount / rate;
  // Otra moneda necesitaría su propia cotización: no se adivina.
  return null;
}

/** Lleva un monto a su equivalente MENSUAL según la frecuencia. */
function toMonthly(s: CommitmentService): number {
  const amount = Number(s.amount) || 0;
  const interval = Math.max(1, s.interval || 1);
  if (s.frequency === "WEEKLY") return (amount * 52) / 12 / interval;
  return amount / interval; // MONTHLY
}

function emptyGroup(): CommitmentGroup {
  return { byCurrency: {}, converted: 0, complete: true, count: 0 };
}

function addTo(group: CommitmentGroup, amount: number, currency: string, target: string, rate: number | null) {
  group.byCurrency[currency] = (group.byCurrency[currency] ?? 0) + amount;
  group.count++;
  const conv = convertAmount(amount, currency, target, rate);
  if (conv === null) {
    // No se pudo convertir: el total queda con lo que sí se pudo sumar, pero marcado
    // como incompleto para que la pantalla avise en vez de mostrarlo como exacto.
    group.complete = false;
  } else if (group.converted !== null) {
    group.converted += conv;
  }
}

function round(group: CommitmentGroup) {
  for (const k of Object.keys(group.byCurrency)) {
    group.byCurrency[k] = Math.round(group.byCurrency[k] * 100) / 100;
  }
  if (group.converted !== null) group.converted = Math.round(group.converted * 100) / 100;
}

/**
 * Resume los compromisos separando mensuales de anuales y convirtiendo a la moneda elegida.
 *
 * @param services  los servicios activos
 * @param rate      cotización del día (pesos por dólar), o null si no hay
 * @param currency  moneda en la que se quieren ver los totales ("ARS" o "USD")
 */
export function commitmentSummary(
  services: CommitmentService[],
  rate: number | null,
  currency = "ARS"
): CommitmentSummary {
  const monthly = emptyGroup();
  const annual = emptyGroup();

  for (const s of services) {
    if (s.active === false) continue;
    const cur = s.currency || "ARS";
    const amount = Number(s.amount) || 0;
    if (!amount) continue;

    if (s.frequency === "YEARLY") {
      // El monto ANUAL completo, sin dividir: es lo que hay que tener el mes que vence.
      const interval = Math.max(1, s.interval || 1);
      addTo(annual, amount / interval, cur, currency, rate);
    } else {
      addTo(monthly, toMonthly(s), cur, currency, rate);
    }
  }

  round(monthly);
  round(annual);

  const annualPerMonth =
    annual.converted !== null ? Math.round((annual.converted / 12) * 100) / 100 : null;

  return { monthly, annual, annualPerMonth, currency, rate };
}
