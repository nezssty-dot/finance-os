/**
 * "Salud de suscripciones". PURO: sin base, sin red.
 *
 * Responde de un vistazo las preguntas que importan sobre los servicios recurrentes:
 * cuántos pagaste este mes, cuántos faltan, cuánto te salen por mes, cuál vence próximo y
 * —lo más útil— qué porcentaje de tus ingresos se van en suscripciones. Como Finance OS ya
 * conoce ingresos y servicios, todo esto se calcula solo, sin que el usuario sume nada.
 */

import { nextDueDate, type ServiceLike } from "./services-math";
import { totalIn } from "./fx";

export interface ServiceStatus extends ServiceLike {
  /** ¿Ya se pagó en el período actual? Lo marca el usuario o la conciliación. */
  paidThisPeriod?: boolean;
  name?: string;
  currency?: string; // "ARS" | "USD" | ...
}

export interface SubscriptionHealth {
  pending: number;
  paid: number;
  total: number;
  /** Gasto mensual comprometido por moneda (no se mezclan ARS y USD). */
  monthlyByCurrency: Record<string, number>;
  /**
   * Costo mensual TOTAL convertido a una sola moneda usando la cotización del día.
   * Es null si no hay cotización: nunca se inventa un tipo de cambio.
   */
  monthlyConverted: { currency: string; total: number; complete: boolean } | null;
  /** Lo mismo pero anualizado, para dimensionar cuánto se va por año en suscripciones. */
  yearlyConverted: number | null;
  /** El próximo a vencer: nombre, dentro de cuántos días y monto. */
  nextDue: { name: string; inDays: number; amount: number; currency: string } | null;
  /** Qué % del ingreso del mes se va en suscripciones. */
  shareOfIncome: number | null;
}

/** Normaliza un monto a su equivalente MENSUAL según la frecuencia. Un anual pesa 1/12. */
function monthlyAmount(s: ServiceStatus): number {
  const amount = Number(s.amount) || 0;
  const interval = Math.max(1, s.interval || 1);
  switch (s.frequency) {
    case "WEEKLY":
      return (amount * 52) / 12 / interval; // ~4.33 semanas por mes
    case "MONTHLY":
      return amount / interval;
    case "YEARLY":
      return amount / 12 / interval;
    default:
      return amount;
  }
}

function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

/**
 * Calcula la salud de las suscripciones activas.
 *
 * @param services  los servicios (con paidThisPeriod marcado)
 * @param monthlyIncome  ingreso del mes en la moneda destino, para el % (null si no se sabe)
 * @param now  fecha de referencia (para el próximo vencimiento)
 * @param fx  cotización del día: { currency destino, rate }. Sin esto, no se convierte nada.
 */
export function subscriptionHealth(
  services: ServiceStatus[],
  monthlyIncome: number | null,
  now: Date = new Date(),
  fx: { currency: string; rate: number | null } = { currency: "ARS", rate: null }
): SubscriptionHealth {
  const active = services.filter((s) => s.active !== false);

  let paid = 0;
  let pending = 0;
  const monthlyByCurrency: Record<string, number> = {};

  for (const s of active) {
    if (s.paidThisPeriod) paid++;
    else pending++;

    const cur = s.currency || "ARS";
    monthlyByCurrency[cur] = (monthlyByCurrency[cur] ?? 0) + monthlyAmount(s);
  }
  // Redondeo prolijo
  for (const k of Object.keys(monthlyByCurrency)) {
    monthlyByCurrency[k] = Math.round(monthlyByCurrency[k] * 100) / 100;
  }

  // Próximo vencimiento entre los que faltan pagar.
  let nextDue: SubscriptionHealth["nextDue"] = null;
  let bestDate: Date | null = null;
  for (const s of active) {
    if (s.paidThisPeriod) continue;
    const due = nextDueDate(s, now);
    if (!due) continue;
    if (!bestDate || due.getTime() < bestDate.getTime()) {
      bestDate = due;
      nextDue = {
        name: s.name ?? "Servicio",
        inDays: daysBetween(now, due),
        amount: Number(s.amount) || 0,
        currency: s.currency || "ARS",
      };
    }
  }

  // Costo total en UNA moneda, usando la cotización del día. Si no hay cotización,
  // monthlyConverted queda null y la pantalla muestra los totales por moneda separados:
  // preferimos no mostrar un total antes que mostrar uno inventado.
  const converted = totalIn(monthlyByCurrency, fx.currency, fx.rate);
  const hasOtherCurrency = Object.keys(monthlyByCurrency).some((c) => c !== fx.currency);
  const monthlyConverted =
    fx.rate === null && hasOtherCurrency
      ? null
      : {
          currency: fx.currency,
          total: converted.total,
          complete: converted.converted,
        };

  const yearlyConverted = monthlyConverted
    ? Math.round(monthlyConverted.total * 12 * 100) / 100
    : null;

  // % del ingreso. Usa el total YA CONVERTIDO, así una suscripción en dólares también
  // pesa en la cuenta (antes solo se miraban los pesos y el número quedaba corto).
  const shareOfIncome =
    monthlyConverted && monthlyIncome && monthlyIncome > 0
      ? Math.round((monthlyConverted.total / monthlyIncome) * 1000) / 10
      : null;

  return {
    pending,
    paid,
    total: active.length,
    monthlyByCurrency,
    monthlyConverted,
    yearlyConverted,
    nextDue,
    shareOfIncome,
  };
}
