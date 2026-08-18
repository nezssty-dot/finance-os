import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { ah } from "../utils/asyncHandler";
import { dueDatesBetween, type Frequency } from "../lib/services-math";

export const timelineRouter = Router();
timelineRouter.use(requireAuth);

// GET /api/timeline?limit=50&cursor=<id>&year=2026
// Returns a chronological feed of all financial events.
timelineRouter.get(
  "/",
  ah(async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 50), 100);
    const year = req.query.year ? Number(req.query.year) : undefined;
    const cursor = req.query.cursor as string | undefined;

    const where: Prisma.MovementWhereInput = { userId: req.userId };
    if (year) {
      where.date = { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) };
    }

    const movements = await prisma.movement.findMany({
      where,
      orderBy: { date: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { category: true, account: true },
    });

    const hasMore = movements.length > limit;
    const items = movements.slice(0, limit);
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    // Enrich each item with a human-friendly event description
    const events = items.map((m) => {
      const TYPE_LABELS: Record<string, string> = {
        INCOME: "Ingreso recibido",
        EXPENSE: "Gasto realizado",
        TRANSFER: "Transferencia",
        INTERNAL: "Movimiento interno",
        INVESTMENT: "Inversión",
        DEBT_PAYMENT: "Pago de deuda",
        COLLECTION: "Cobro",
      };
      return {
        id: m.id,
        date: m.date,
        type: m.type,
        label: TYPE_LABELS[m.type] || m.type,
        description: m.description,
        counterpart: m.counterpart,
        amount: Number(m.amount),
        currency: m.currency,
        category: m.category ? { name: m.category.name, color: m.category.color } : null,
        account: m.account ? { name: m.account.name, type: m.account.type } : null,
        source: m.source,
      };
    });

    res.json({ events, nextCursor, hasMore });
  })
);

/**
 * GET /api/timeline/upcoming?days=30
 * Los eventos FUTUROS: vencimientos de servicios de acá a N días. El feed principal
 * (arriba) es el pasado, paginado; esto es lo que viene, y va en su propio endpoint
 * porque proyectar hacia adelante y paginar hacia atrás son dos cosas distintas —
 * mezclarlas en una sola lista con cursor sería enredado y frágil.
 *
 * Hoy son solo servicios. A medida que haya más fuentes de eventos futuros (cobros
 * esperados, vencimientos de deuda), se suman acá con el mismo formato.
 */
timelineRouter.get(
  "/upcoming",
  ah(async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days ?? 30), 1), 180);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const until = new Date(today.getTime() + days * 86_400_000);

    const services = await prisma.service.findMany({
      where: { userId: req.userId, active: true },
      include: { category: true, account: true },
    });

    const payments = await prisma.servicePayment.findMany({
      where: { userId: req.userId, dueDate: { gte: today, lte: until }, paidAt: { not: null } },
    });
    const paidKey = new Set(
      payments.map((p) => `${p.serviceId}|${new Date(p.dueDate).toISOString().slice(0, 10)}`)
    );

    const events: any[] = [];
    for (const s of services) {
      const like = {
        amount: Number(s.amount),
        frequency: s.frequency as Frequency,
        interval: s.interval,
        dueDay: s.dueDay ?? null,
        startDate: new Date(s.startDate),
        endDate: s.endDate ? new Date(s.endDate) : null,
        active: s.active,
      };
      for (const due of dueDatesBetween(like, today, until)) {
        const key = `${s.id}|${due.toISOString().slice(0, 10)}`;
        events.push({
          id: key,
          date: due.toISOString(),
          type: "SERVICE_DUE",
          label: "Vence servicio",
          description: s.name,
          amount: Number(s.amount),
          currency: s.currency,
          paid: paidKey.has(key),
          autoDebit: s.autoDebit,
          category: s.category ? { name: s.category.name, color: s.category.color } : null,
          account: s.account ? { name: s.account.name } : null,
        });
      }
    }
    events.sort((a, b) => a.date.localeCompare(b.date));
    res.json({ events });
  })
);
