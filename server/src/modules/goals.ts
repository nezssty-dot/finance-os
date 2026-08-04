import { Router } from "express";
import { z } from "zod";
import { Goal } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { ah } from "../utils/asyncHandler";
import { HttpError } from "../middleware/error";

export const goalsRouter = Router();
goalsRouter.use(requireAuth);

const createSchema = z.object({
  name: z.string().min(1).max(80),
  target: z.coerce.number().positive(),
  saved: z.coerce.number().min(0).default(0),
  deadline: z.coerce.date().optional(),
});
const updateSchema = createSchema.partial();

// How much this user actually saves in an average month, from their real data.
// Used to answer "when will I get there?" instead of making the user guess.
async function avgMonthlySaving(userId: string): Promise<number> {
  const movements = await prisma.movement.findMany({
    where: { userId, type: { in: ["INCOME", "EXPENSE"] } },
    select: { date: true, type: true, amount: true },
  });
  if (!movements.length) return 0;

  const byMonth: Record<string, number> = {};
  for (const m of movements) {
    const d = new Date(m.date);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    byMonth[key] = (byMonth[key] ?? 0) + (m.type === "INCOME" ? 1 : -1) * Number(m.amount);
  }
  const months = Object.values(byMonth);
  return months.reduce((s, v) => s + v, 0) / months.length;
}

const shape = (g: Goal, avg: number) => {
  const target = Number(g.target);
  const saved = Number(g.saved);
  const remaining = Math.max(target - saved, 0);
  const pct = target > 0 ? Math.min(Math.round((saved / target) * 100), 100) : 0;

  // Only meaningful if they're actually saving; otherwise the ETA is infinite and
  // we'd rather show nothing than a fake date.
  const etaMonths = remaining > 0 && avg > 0 ? Math.ceil(remaining / avg) : null;
  const etaDate = etaMonths
    ? new Date(new Date().setMonth(new Date().getMonth() + etaMonths)).toISOString()
    : null;

  let onTrack: boolean | null = null;
  if (g.deadline && etaDate) onTrack = new Date(etaDate) <= new Date(g.deadline);

  return {
    id: g.id, name: g.name, deadline: g.deadline,
    target, saved, remaining, pct, etaMonths, etaDate, onTrack,
    done: saved >= target,
  };
};

goalsRouter.get("/", ah(async (req, res) => {
  const [rows, avg] = await Promise.all([
    prisma.goal.findMany({ where: { userId: req.userId }, orderBy: { createdAt: "asc" } }),
    avgMonthlySaving(req.userId!),
  ]);
  res.json({ avgMonthlySaving: Math.round(avg), goals: rows.map((g) => shape(g, avg)) });
}));

goalsRouter.post("/", ah(async (req, res) => {
  const data = createSchema.parse(req.body);
  const row = await prisma.goal.create({ data: { ...data, userId: req.userId! } });
  res.status(201).json(shape(row, await avgMonthlySaving(req.userId!)));
}));

goalsRouter.patch("/:id", ah(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const found = await prisma.goal.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!found) throw new HttpError(404, "Objetivo no encontrado");
  const row = await prisma.goal.update({ where: { id: req.params.id }, data });
  res.json(shape(row, await avgMonthlySaving(req.userId!)));
}));

goalsRouter.delete("/:id", ah(async (req, res) => {
  const found = await prisma.goal.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!found) throw new HttpError(404, "Objetivo no encontrado");
  await prisma.goal.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

// Put money aside toward a goal. This does NOT create a movement: earmarking money
// you already have doesn't change your net worth, it just labels it.
goalsRouter.post("/:id/contribute", ah(async (req, res) => {
  const { amount } = z.object({ amount: z.coerce.number() }).parse(req.body);
  const goal = await prisma.goal.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!goal) throw new HttpError(404, "Objetivo no encontrado");
  const saved = Math.max(Number(goal.saved) + amount, 0);
  const row = await prisma.goal.update({ where: { id: goal.id }, data: { saved } });
  res.json(shape(row, await avgMonthlySaving(req.userId!)));
}));
