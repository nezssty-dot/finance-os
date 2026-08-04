import { prisma } from "../lib/prisma";
import { matchMovementToService, type MatchableService } from "../lib/service-match";
import type { ServiceLike, Frequency } from "../lib/services-math";

/**
 * Detecta, entre movimientos recién importados o sincronizados, cuáles pagan un servicio
 * cargado — y registra el pago automáticamente.
 *
 * Se llama DESPUÉS de crear los movimientos, con sus ids. Devuelve cuántos pagos detectó,
 * para poder avisarlo ("Detecté 2 pagos de servicios") sin sorprender al usuario.
 *
 * La decisión de si un movimiento corresponde a un servicio vive en lib/service-match.ts,
 * que es puro y está testeado. Acá solo está el pegamento con la base: traer los servicios,
 * pasar cada gasto por el matcher, y escribir el ServicePayment cuando hay match.
 *
 * ─── POR QUÉ NO PISA UN PAGO QUE YA ESTABA ───
 *
 * Si el usuario ya marcó ese vencimiento a mano, o ya se detectó en una importación
 * anterior, el `create` sobre (serviceId, dueDate) falla por la unique constraint y se
 * saltea. La detección automática nunca sobrescribe algo que el usuario ya confirmó.
 */

function toServiceLike(s: any): ServiceLike {
  return {
    amount: Number(s.amount),
    frequency: s.frequency as Frequency,
    interval: s.interval,
    dueDay: s.dueDay ?? null,
    startDate: new Date(s.startDate),
    endDate: s.endDate ? new Date(s.endDate) : null,
    active: s.active,
  };
}

export interface DetectedPayment {
  serviceId: string;
  serviceName: string;
  movementId: string;
  amount: number;
}

/**
 * @param movementIds  Los movimientos a revisar (los recién creados en esta importación).
 *                     Solo se consideran gastos; los ingresos no pagan servicios.
 */
export async function detectServicePayments(
  userId: string,
  movementIds: string[]
): Promise<DetectedPayment[]> {
  if (!movementIds.length) return [];

  const services = await prisma.service.findMany({
    where: { userId, active: true },
  });
  if (!services.length) return [];

  const candidates: MatchableService[] = services.map((s) => ({
    id: s.id,
    name: s.name,
    amount: Number(s.amount),
    currency: s.currency,
    service: toServiceLike(s),
  }));

  const movements = await prisma.movement.findMany({
    where: { id: { in: movementIds }, userId, type: "EXPENSE" },
    select: { id: true, description: true, amount: true, currency: true, date: true },
  });

  const detected: DetectedPayment[] = [];

  for (const m of movements) {
    const match = matchMovementToService(
      {
        description: m.description,
        amount: Number(m.amount),
        currency: m.currency,
        date: new Date(m.date),
      },
      candidates
    );
    if (!match) continue;

    const svc = services.find((s) => s.id === match.serviceId)!;

    try {
      await prisma.servicePayment.create({
        data: {
          userId,
          serviceId: match.serviceId,
          dueDate: match.dueDate,
          paidAt: new Date(m.date), // se pagó cuando ocurrió el movimiento
          movementId: m.id,
          amount: Number(m.amount), // lo que costó ESTE pago (para detectar aumentos)
        },
      });
      detected.push({
        serviceId: svc.id,
        serviceName: svc.name,
        movementId: m.id,
        amount: Number(m.amount),
      });
    } catch {
      // Ese vencimiento ya estaba registrado (unique serviceId+dueDate). Puede ser que
      // el usuario lo marcó a mano o que ya se detectó antes: en los dos casos, no
      // tocarlo es lo correcto.
    }
  }

  return detected;
}
