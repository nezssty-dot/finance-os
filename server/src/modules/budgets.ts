import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { ah } from "../utils/asyncHandler";
import { HttpError } from "../middleware/error";

export const budgetsRouter = Router();
budgetsRouter.use(requireAuth);

const createSchema = z.object({
  categoryId: z.string(),
  limit: z.coerce.number().positive(),
  period: z.enum(["MONTHLY"]).default("MONTHLY"),
});
const updateSchema = createSchema.partial();

// Budgets are only useful if they tell you where you'll LAND, not just where you
// are. So each one is projected to month-end from the pace so far.
budgetsRouter.get("/", ah(async (req, res) => {
  const userId = req.userId!;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();

  const [budgets, spend] = await Promise.all([
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
  ]);

  const spentBy: Record<string, number> = {};
  for (const row of spend as any[]) {
    if (row.categoryId) spentBy[row.categoryId] = Number(row._sum.amount ?? 0);
  }

  const rows = budgets.map((b: any) => {
    const limit = Number(b.limit);
    const spent = spentBy[b.categoryId] ?? 0;
    const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
    // Straight-line pace: what today's rate adds up to by the last day of the month.
    const projected = dayOfMonth > 0 ? Math.round((spent / dayOfMonth) * daysInMonth) : 0;

    const status =
      spent > limit ? "over" : projected > limit ? "at_risk" : pct >= 80 ? "warning" : "ok";

    const alert =
      status === "over"
        ? `Te pasaste ${Math.round(spent - limit).toLocaleString("es-AR")} en ${b.category.name}.`
        : status === "at_risk"
          ? `A este ritmo cerrás el mes en ${projected.toLocaleString("es-AR")} y el límite es ${limit.toLocaleString("es-AR")}.`
          : status === "warning"
            ? `Ya usaste el ${pct}% del presupuesto de ${b.category.name}.`
            : null;

    return {
      id: b.id,
      categoryId: b.categoryId,
      category: { name: b.category.name, color: b.category.color },
      limit, spent, projected, pct,
      remaining: Math.max(limit - spent, 0),
      status, alert,
    };
  });

  res.json(rows);
}));

budgetsRouter.post("/", ah(async (req, res) => {
  const data = createSchema.parse(req.body);
  const category = await prisma.category.findFirst({
    where: { id: data.categoryId, userId: req.userId },
  });
  if (!category) throw new HttpError(404, "Categoría no encontrada");
  const row = await prisma.budget.create({ data: { ...data, userId: req.userId! } });
  res.status(201).json(row);
}));

budgetsRouter.patch("/:id", ah(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const found = await prisma.budget.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!found) throw new HttpError(404, "Presupuesto no encontrado");
  res.json(await prisma.budget.update({ where: { id: req.params.id }, data }));
}));

budgetsRouter.delete("/:id", ah(async (req, res) => {
  const found = await prisma.budget.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!found) throw new HttpError(404, "Presupuesto no encontrado");
  await prisma.budget.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));
