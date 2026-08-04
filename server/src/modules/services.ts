import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { ah } from "../utils/asyncHandler";
import { HttpError } from "../middleware/error";
import {
  nextDueDate,
  dueDatesBetween,
  monthBounds,
  committedByCurrency,
  type ServiceLike,
  type Frequency,
} from "../lib/services-math";
import { subscriptionHealth } from "../lib/subscription-health";
import { currentRate } from "../integrations/fx/service";
import { totalIn } from "../lib/fx";

export const servicesRouter = Router();
servicesRouter.use(requireAuth);

const FREQUENCIES = ["MONTHLY", "WEEKLY", "YEARLY"] as const;

const createSchema = z.object({
  name: z.string().min(1).max(80),
  categoryId: z.string().optional().nullable(),
  accountId: z.string().optional().nullable(),
  amount: z.coerce.number().positive(),
  currency: z.string().default("ARS"),
  frequency: z.enum(FREQUENCIES).default("MONTHLY"),
  interval: z.coerce.number().int().min(1).default(1),
  dueDay: z.coerce.number().int().min(1).max(31).optional().nullable(),
  autoDebit: z.coerce.boolean().default(false),
  active: z.coerce.boolean().default(true),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});
const updateSchema = createSchema.partial();

/** Convierte una fila de Prisma en lo que el motor de fechas necesita. */
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

/**
 * Enriquece un servicio con lo que se DERIVA y nunca se guarda: su próximo vencimiento,
 * si está pago ese vencimiento, y cuántos días faltan. Igual que los saldos: se calcula
 * en cada lectura para que no pueda quedar viejo.
 */
async function shape(userId: string, s: any, today: Date) {
  const next = nextDueDate(toServiceLike(s), today);

  let nextPaid = false;
  if (next) {
    const existing = await prisma.servicePayment.findUnique({
      where: { serviceId_dueDate: { serviceId: s.id, dueDate: next } },
    });
    nextPaid = !!existing?.paidAt;
  }

  const daysUntil = next
    ? Math.round((next.getTime() - startOfDay(today).getTime()) / 86_400_000)
    : null;

  return {
    ...s,
    amount: Number(s.amount),
    nextDueDate: next ? next.toISOString() : null,
    nextDuePaid: nextPaid,
    daysUntilNext: daysUntil,
  };
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// ─────────────────────────── CRUD ───────────────────────────

servicesRouter.get(
  "/",
  ah(async (req, res) => {
    const today = new Date();
    const services = await prisma.service.findMany({
      where: { userId: req.userId },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: { category: true, account: true },
    });
    const shaped = await Promise.all(services.map((s) => shape(req.userId!, s, today)));

    // Ordena por urgencia: lo que vence antes, primero (los sin fecha, al final).
    shaped.sort((a, b) => {
      if (a.daysUntilNext == null) return 1;
      if (b.daysUntilNext == null) return -1;
      return a.daysUntilNext - b.daysUntilNext;
    });

    res.json(shaped);
  })
);

servicesRouter.post(
  "/",
  ah(async (req, res) => {
    const data = createSchema.parse(req.body);
    await assertRefsBelongToUser(req.userId!, data.categoryId, data.accountId);
    const service = await prisma.service.create({
      data: { ...data, userId: req.userId!, startDate: data.startDate ?? new Date() },
    });
    res.status(201).json(await shape(req.userId!, service, new Date()));
  })
);

servicesRouter.patch(
  "/:id",
  ah(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const found = await prisma.service.findFirst({
      where: { id: req.params.id, userId: req.userId },
    });
    if (!found) throw new HttpError(404, "Servicio no encontrado");
    await assertRefsBelongToUser(req.userId!, data.categoryId, data.accountId);
    const service = await prisma.service.update({ where: { id: req.params.id }, data });
    res.json(await shape(req.userId!, service, new Date()));
  })
);

servicesRouter.delete(
  "/:id",
  ah(async (req, res) => {
    const found = await prisma.service.findFirst({
      where: { id: req.params.id, userId: req.userId },
    });
    if (!found) throw new HttpError(404, "Servicio no encontrado");
    // ServicePayment cae por cascade (ver schema). Los movimientos NO se tocan: un pago
    // ya ocurrió aunque borres el servicio; solo se desvincula (movementId → null).
    await prisma.service.delete({ where: { id: req.params.id } });
    res.status(204).end();
  })
);

// ─────────────────────────── Calendario ───────────────────────────

/**
 * GET /api/services/calendar?days=45
 * Los vencimientos de todos los servicios activos en los próximos N días, agrupados por
 * día. Es lo que dibuja el calendario y alimenta los recordatorios.
 */
servicesRouter.get(
  "/calendar",
  ah(async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days ?? 45), 1), 365);
    const today = startOfDay(new Date());
    const until = new Date(today.getTime() + days * 86_400_000);

    const services = await prisma.service.findMany({
      where: { userId: req.userId, active: true },
      include: { category: true, account: true },
    });

    // Traigo los pagos ya registrados en la ventana, para marcar cada vencimiento.
    const payments = await prisma.servicePayment.findMany({
      where: { userId: req.userId, dueDate: { gte: today, lte: until } },
    });
    const paidKey = new Set(
      payments.filter((p) => p.paidAt).map((p) => `${p.serviceId}|${iso(p.dueDate)}`)
    );

    const events: any[] = [];
    for (const s of services) {
      for (const due of dueDatesBetween(toServiceLike(s), today, until)) {
        events.push({
          serviceId: s.id,
          name: s.name,
          amount: Number(s.amount),
          currency: s.currency,
          dueDate: iso(due),
          paid: paidKey.has(`${s.id}|${iso(due)}`),
          autoDebit: s.autoDebit,
          category: s.category ? { name: s.category.name, color: s.category.color } : null,
          account: s.account ? { name: s.account.name } : null,
        });
      }
    }
    events.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    res.json({ from: iso(today), to: iso(until), events });
  })
);

/**
 * GET /api/services/summary
 * Lo que el dashboard necesita: comprometido este mes (por moneda) y el próximo pago.
 * "Disponible real" se arma en el dashboard restando esto del disponible — no acá,
 * porque el disponible sale de balance-math y este módulo no calcula saldos.
 */
servicesRouter.get(
  "/summary",
  ah(async (req, res) => {
    const now = new Date();
    const { start, end } = monthBounds(now.getFullYear(), now.getMonth());

    const services = await prisma.service.findMany({
      where: { userId: req.userId, active: true },
    });
    const likes = services.map((s) => ({ ...toServiceLike(s), currency: s.currency }));

    // Comprometido de acá a fin de mes (no el mes entero: lo ya pagado no vuelve a
    // comprometer plata que todavía tenés). Ver detalle abajo.
    const committedThisMonth = committedByCurrency(likes, start, end);
    const committedRemaining = committedByCurrency(
      likes,
      startOfDay(now),
      end
    );

    // El próximo vencimiento entre todos los servicios.
    let nextEvent: any = null;
    for (const s of services) {
      const due = nextDueDate(toServiceLike(s), startOfDay(now));
      if (!due) continue;
      if (!nextEvent || due < nextEvent.due) {
        nextEvent = { due, service: s };
      }
    }

    // ─── Salud de suscripciones ───
    // Junta todo lo que el usuario necesita para decidir: cuántas pagó, cuántas faltan,
    // cuánto le salen por mes/año EN UNA SOLA MONEDA (convirtiendo las que están en
    // dólares a la cotización del día) y qué porcentaje de sus ingresos se llevan.
    const paidThisPeriod = await prisma.servicePayment.findMany({
      where: { userId: req.userId, paidAt: { not: null }, dueDate: { gte: start, lte: end } },
      select: { serviceId: true },
    });
    const paidIds = new Set(paidThisPeriod.map((p) => p.serviceId));

    const { rate, quote } = await currentRate(now);

    // Ingreso del mes, para saber qué peso tienen las suscripciones sobre lo que entra.
    const incomeRows = await prisma.movement.findMany({
      where: { userId: req.userId, type: "INCOME", date: { gte: start, lte: end } },
      select: { amount: true, currency: true },
    });
    const incomeByCurrency: Record<string, number> = {};
    for (const m of incomeRows) {
      const c = m.currency ?? "ARS";
      incomeByCurrency[c] = (incomeByCurrency[c] ?? 0) + Number(m.amount);
    }
    const incomeTotal = totalIn(incomeByCurrency, "ARS", rate);

    const health = subscriptionHealth(
      services.map((s) => ({
        ...toServiceLike(s),
        name: s.name,
        currency: s.currency,
        paidThisPeriod: paidIds.has(s.id),
      })),
      incomeTotal.converted ? incomeTotal.total : null,
      now,
      { currency: "ARS", rate }
    );

    res.json({
      committedThisMonth,
      committedRemaining,
      activeCount: services.length,
      health,
      // La cotización usada, para poder mostrarla junto a los totales convertidos.
      fx: rate === null ? null : { rate, kind: quote?.kind ?? null, date: quote?.date ?? null },
      nextPayment: nextEvent
        ? {
            name: nextEvent.service.name,
            amount: Number(nextEvent.service.amount),
            currency: nextEvent.service.currency,
            dueDate: iso(nextEvent.due),
          }
        : null,
    });
  })
);

// ─────────────────────────── Marcar pagado (manual) ───────────────────────────

/**
 * POST /api/services/:id/pay   { dueDate?, movementId? }
 * Marca un vencimiento como pagado a mano. Si no se pasa dueDate, se toma el próximo.
 * Idempotente sobre (serviceId, dueDate): volver a marcar el mismo vencimiento no crea
 * un segundo pago, solo lo actualiza.
 *
 * ─── EL EGRESO SE REGISTRA SOLO ───
 *
 * Si no se enlaza un movimiento existente, se CREA uno. Sin esto, marcar un servicio como
 * pagado no impactaba en ningún lado: la plata salía en la vida real pero el balance
 * seguía igual. Se marca con source "SERVICE" para poder distinguirlo de los que cargó el
 * usuario y poder revertirlo si desmarca el pago.
 */
servicesRouter.post(
  "/:id/pay",
  ah(async (req, res) => {
    const service = await prisma.service.findFirst({
      where: { id: req.params.id, userId: req.userId },
    });
    if (!service) throw new HttpError(404, "Servicio no encontrado");

    const body = z
      .object({ dueDate: z.coerce.date().optional(), movementId: z.string().optional() })
      .parse(req.body);

    const dueDate = body.dueDate ?? nextDueDate(toServiceLike(service), startOfDay(new Date()));
    if (!dueDate) throw new HttpError(400, "El servicio no tiene un vencimiento próximo para pagar");

    // ¿Ya había un pago registrado para este vencimiento? Sirve para no crear un segundo
    // movimiento si el usuario vuelve a tocar "pagar" sobre algo ya pagado.
    const existing = await prisma.servicePayment.findUnique({
      where: { serviceId_dueDate: { serviceId: service.id, dueDate } },
    });

    let movementId = body.movementId ?? existing?.movementId ?? null;

    if (!movementId) {
      const created = await prisma.movement.create({
        data: {
          userId: req.userId!,
          source: "SERVICE",
          type: "EXPENSE",
          amount: Number(service.amount),
          currency: service.currency,
          description: service.name,
          date: dueDate,
          accountId: service.accountId,
          categoryId: service.categoryId,
        },
      });
      movementId = created.id;
    }

    const payment = await prisma.servicePayment.upsert({
      where: { serviceId_dueDate: { serviceId: service.id, dueDate } },
      update: { paidAt: new Date(), movementId },
      create: {
        userId: req.userId!,
        serviceId: service.id,
        dueDate,
        paidAt: new Date(),
        movementId,
        amount: Number(service.amount),
      },
    });
    res.json(payment);
  })
);

/** DELETE /api/services/:id/pay?dueDate=... — desmarca un pago (por si fue un error). */
servicesRouter.delete(
  "/:id/pay",
  ah(async (req, res) => {
    const service = await prisma.service.findFirst({
      where: { id: req.params.id, userId: req.userId },
    });
    if (!service) throw new HttpError(404, "Servicio no encontrado");
    const dueDate = z.coerce.date().parse(req.query.dueDate);

    const payment = await prisma.servicePayment.findUnique({
      where: { serviceId_dueDate: { serviceId: service.id, dueDate } },
    });

    await prisma.servicePayment.deleteMany({
      where: { serviceId: service.id, dueDate },
    });

    // Si el egreso lo había creado la app al marcar el pago (source "SERVICE"), se borra
    // también: si no, quedaría un gasto fantasma que el usuario no puso y que le
    // descuadra el balance. Un movimiento que cargó el usuario a mano NO se toca.
    if (payment?.movementId) {
      await prisma.movement.deleteMany({
        where: { id: payment.movementId, userId: req.userId!, source: "SERVICE" },
      });
    }

    res.status(204).end();
  })
);

// ─────────────────────────── helpers ───────────────────────────

function iso(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

/** Evita que un servicio apunte a una cuenta o categoría de otro usuario. */
async function assertRefsBelongToUser(
  userId: string,
  categoryId?: string | null,
  accountId?: string | null
) {
  if (categoryId) {
    const c = await prisma.category.findFirst({ where: { id: categoryId, userId } });
    if (!c) throw new HttpError(400, "Categoría inválida");
  }
  if (accountId) {
    const a = await prisma.account.findFirst({ where: { id: accountId, userId } });
    if (!a) throw new HttpError(400, "Cuenta inválida");
  }
}
