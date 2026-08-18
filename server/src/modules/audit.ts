import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { ah } from "../utils/asyncHandler";
import { auditMovements } from "../lib/audit";

export const auditRouter = Router();
auditRouter.use(requireAuth);

/**
 * Audita los movimientos de un mes. NO modifica nada: devuelve el reporte con los hallazgos
 * (duplicados, sin categoría, fechas raras) y los totales por moneda calculados con el
 * mismo signo que los saldos reales. Es la herramienta para que el usuario pueda confiar
 * en los balances.
 *
 * GET /api/audit?year=2026&month=6   (month es 0-based, como en el resto de la app)
 */
auditRouter.get("/", ah(async (req, res) => {
  const userId = req.userId!;
  const year = Number(req.query.year ?? new Date().getFullYear());
  const month = Number(req.query.month ?? new Date().getMonth()); // 0-based

  // Rango del mes en "YYYY-MM-DD" para marcar movimientos fuera de lugar.
  const from = new Date(year, month, 1);
  const to = new Date(year, month + 1, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  const fromStr = `${year}-${pad(month + 1)}-01`;
  const toStr = `${year}-${pad(month + 1)}-${pad(to.getDate())}`;

  const rows = await prisma.movement.findMany({
    where: { userId, date: { gte: from, lte: new Date(year, month + 1, 0, 23, 59, 59) } },
    select: {
      id: true, date: true, description: true, amount: true, type: true,
      currency: true, categoryId: true, accountId: true,
    },
    orderBy: { date: "asc" },
  });

  const report = auditMovements(
    rows.map((r) => ({
      id: r.id,
      date: r.date instanceof Date ? r.date.toISOString() : r.date,
      description: r.description,
      amount: Number(r.amount),
      type: r.type,
      currency: r.currency ?? "ARS",
      categoryId: r.categoryId,
      accountId: r.accountId,
    })),
    { window: { from: fromStr, to: toStr } }
  );

  res.json(report);
}));
