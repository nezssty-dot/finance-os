/**
 * ¿Este movimiento es el pago de un servicio? PURO: sin base, sin fechas de "ahora".
 *
 * Cuando entra un gasto (importado o sincronizado), esto decide si corresponde a un
 * servicio que el usuario tiene cargado —para marcarlo pagado sin que lo haga a mano.
 *
 * ─── LA REGLA DE ORO: ANTE LA DUDA, NO ───
 *
 * Un falso positivo marca "pagado" algo que no se pagó, o linkea el gasto equivocado.
 * Eso es peor que no detectar nada: el usuario deja de ver un vencimiento que sigue
 * vivo. Por eso el matching es CONSERVADOR y exige las tres cosas a la vez:
 *
 *   1. El nombre del servicio aparece en la descripción del movimiento.
 *   2. El monto es parecido (dentro de una tolerancia — los servicios en dólares o con
 *      impuestos varían un poco mes a mes).
 *   3. La fecha del movimiento cae cerca de un vencimiento real del servicio.
 *
 * Si las tres no se cumplen, se devuelve null y el usuario lo marca a mano. Preferir
 * pedir una confirmación de más antes que registrar un pago fantasma.
 */

import { normalize } from "./classify";
import { dueDatesBetween, type ServiceLike } from "./services-math";

export interface MatchableService {
  id: string;
  name: string;
  amount: number;
  currency: string;
  service: ServiceLike;
}

export interface MatchableMovement {
  description: string;
  amount: number; // valor absoluto del gasto
  currency: string;
  date: Date;
}

export interface ServiceMatch {
  serviceId: string;
  dueDate: Date;
  /** Qué tan seguro es el match, 0..1. Para poder ordenar si hay varios candidatos. */
  score: number;
}

// Cuánto puede diferir el monto y seguir contando como el mismo servicio.
const AMOUNT_TOLERANCE_PCT = 0.15; // ±15%
// Cuántos días alrededor de un vencimiento se acepta el pago (débitos que caen tarde,
// fines de semana, feriados).
const DATE_WINDOW_DAYS = 7;

/**
 * Busca, entre los servicios candidatos, cuál corresponde a este movimiento.
 * Devuelve el mejor match (mayor score) o null si ninguno cumple las tres condiciones.
 */
export function matchMovementToService(
  movement: MatchableMovement,
  services: MatchableService[]
): ServiceMatch | null {
  const descNorm = normalize(movement.description);
  if (!descNorm) return null;

  let best: ServiceMatch | null = null;

  for (const svc of services) {
    // (0) La moneda tiene que coincidir. Un débito en ARS no paga un servicio en USD.
    if (svc.currency !== movement.currency) continue;

    // (1) El nombre del servicio tiene que aparecer en la descripción.
    const nameNorm = normalize(svc.name);
    if (nameNorm.length < 3 || !descNorm.includes(nameNorm)) continue;

    // (2) El monto tiene que ser parecido.
    const diff = Math.abs(movement.amount - svc.amount);
    const tolerance = svc.amount * AMOUNT_TOLERANCE_PCT;
    if (diff > tolerance) continue;

    // (3) La fecha tiene que caer cerca de un vencimiento real.
    const windowStart = new Date(movement.date.getTime() - DATE_WINDOW_DAYS * 86_400_000);
    const windowEnd = new Date(movement.date.getTime() + DATE_WINDOW_DAYS * 86_400_000);
    const nearbyDues = dueDatesBetween(svc.service, windowStart, windowEnd);
    if (nearbyDues.length === 0) continue;

    // El vencimiento más cercano a la fecha del movimiento.
    let closest = nearbyDues[0];
    let closestDist = Math.abs(closest.getTime() - movement.date.getTime());
    for (const due of nearbyDues) {
      const dist = Math.abs(due.getTime() - movement.date.getTime());
      if (dist < closestDist) {
        closest = due;
        closestDist = dist;
      }
    }

    // Score: nombre más largo (más específico) y monto/fecha más ajustados suman.
    const amountScore = 1 - diff / (tolerance || 1); // 1 = monto exacto
    const dateScore = 1 - closestDist / (DATE_WINDOW_DAYS * 86_400_000); // 1 = mismo día
    const nameScore = Math.min(1, nameNorm.length / 12);
    const score = amountScore * 0.4 + dateScore * 0.4 + nameScore * 0.2;

    if (!best || score > best.score) {
      best = { serviceId: svc.id, dueDate: closest, score };
    }
  }

  return best;
}
