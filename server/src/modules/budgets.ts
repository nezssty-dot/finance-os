import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { ah } from "../utils/asyncHandler";
import { HttpError } from "../middleware/error";

export const budgetsRouter = Router();
budgetsRouter.use(requireAuth);

// CATEGORY: el original — un límite mensual atado a una sola categoría.
// PROJECT: sin categoría fija — junta los movimientos que se le asignaron a mano (de
// cualquier categoría), sin recorte por mes. Sirve para algo como "Viaje a Buenos
// Aires": transporte + comida + lo que sea, todo bajo un mismo total.
const baseSchema = z.object({
  type: z.enum(["CATEGORY", "PROJECT"]).default("CATEGORY"),
  categoryId: z.string().optional(),
  name: z.string().min(1).max(80).optional(),
  limit: z.coerce.number().positive(),
  period: z.enum(["MONTHLY"]).default("MONTHLY"),
});
const createSchema = baseSchema.refine(
  (d) => (d.type === "CATEGORY" ? !!d.categoryId : !!d.name),
  { message: "Un presupuesto por categoría necesita categoría; uno de proyecto necesita nombre" }
);
const updateSchema = baseSchema.partial();

// Budgets are only useful if they tell you where you'll LAND, not just where you
// are. So each CATEGORY one is projected to month-end from the pace so far. Los PROJECT
// no proyectan: un viaje no tiene un "ritmo mensual" que extrapolar.
budgetsRouter.get("/", ah(async (req, res) => {
  const userId = req.userId!;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();

  const [budgets, categorySpend, projectSpend] = await Promise.all([
    prisma.budget.findMany({
      where: { userId },
      include: { category: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.movement.groupBy({
      by: ["categoryId"],
      where: { userId, type: "EXPENSE", date: { gte: monthStart, lt: monthEnd } },
      _sum: { amount: true },
    }),
    prisma.movement.groupBy({
      by: ["budgetId"],
      where: { userId, type: "EXPENSE", budgetId: { not: null } },
      _sum: { amount: true },
    }),
  ]);

  const spentByCategory: Record<string, number> = {};
  for (const row of categorySpend as any[]) {
    if (row.categoryId) spentByCategory[row.categoryId] = Number(row._sum.amount ?? 0);
  }
  const spentByProject: Record<string, number> = {};
  for (const row of projectSpend as any[]) {
    if (row.budgetId) spentByProject[row.budgetId] = Number(row._sum.amount ?? 0);
  }

  const rows = budgets.map((b: any) => {
    const limit = Number(b.limit);
    const isProject = b.type === "PROJECT";
    const label = isProject ? b.name : b.category?.name;
    const spent = isProject ? (spentByProject[b.id] ?? 0) : (spentByCategory[b.categoryId] ?? 0);
    const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
    // Straight-line pace: what today's rate adds up to by the last day of the month.
    const projected = isProject
      ? spent
      : dayOfMonth > 0 ? Math.round((spent / dayOfMonth) * daysInMonth) : 0;

    const status =
      spent > limit ? "over" : projected > limit ? "at_risk" : pct >= 80 ? "warning" : "ok";

    const alert =
      status === "over"
        ? `Te pasaste ${Math.round(spent - limit).toLocaleString("es-AR")} en ${label}.`
        : status === "at_risk"
          ? `A este ritmo cerrás el mes en ${projected.toLocaleString("es-AR")} y el límite es ${limit.toLocaleString("es-AR")}.`
          : status === "warning"
            ? `Ya usaste el ${pct}% del presupuesto de ${label}.`
            : null;

    return {
      id: b.id,
      type: b.type,
      categoryId: b.categoryId,
      category: b.category ? { name: b.category.name, color: b.category.color } : null,
      name: b.name,
      label,
      limit, spent, projected, pct,
      remaining: Math.max(limit - spent, 0),
      status, alert,
    };
  });

  res.json(rows);
}));

budgetsRouter.post("/", ah(async (req, res) => {
  const data = createSchema.parse(req.body);
  if (data.type === "CATEGORY") {
    const category = await prisma.category.findFirst({
      where: { id: data.categoryId, userId: req.userId },
    });
    if (!category) throw new HttpError(404, "Categoría no encontrada");
  }
  const row = await prisma.budget.create({
    data: { ...data, categoryId: data.type === "PROJECT" ? null : data.categoryId, userId: req.userId! },
  });
  res.status(201).json(row);
}));

budgetsRouter.patch("/:id", ah(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const found = await prisma.budget.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!found) throw new HttpError(404, "Presupuesto no encontrado");
  if (data.categoryId) {
    const category = await prisma.category.findFirst({
      where: { id: data.categoryId, userId: req.userId },
    });
    if (!category) throw new HttpError(404, "Categoría no encontrada");
  }
  res.json(await prisma.budget.update({ where: { id: req.params.id }, data }));
}));

budgetsRouter.delete("/:id", ah(async (req, res) => {
  const found = await prisma.budget.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!found) throw new HttpError(404, "Presupuesto no encontrado");
  // Sin FK a nivel SQLite en Movement.budgetId (ver schema.sql) — la limpieza es a
  // mano, y va ANTES del borrado para que nunca quede un movimiento apuntando a un
  // presupuesto que ya no existe.
  await prisma.movement.updateMany({ where: { userId: req.userId, budgetId: found.id }, data: { budgetId: null } });
  await prisma.budget.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));
