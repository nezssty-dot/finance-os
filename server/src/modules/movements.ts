import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { ah } from "../utils/asyncHandler";
import { HttpError } from "../middleware/error";
import { suggestCategory, learn } from "./classification";

export const movementsRouter = Router();
movementsRouter.use(requireAuth);

const TYPES = [
  "INCOME", "EXPENSE", "TRANSFER", "INTERNAL",
  "INVESTMENT", "DEBT_PAYMENT", "COLLECTION",
] as const;

const createSchema = z.object({
  type: z.enum(TYPES),
  amount: z.coerce.number().positive(),
  currency: z.string().default("ARS"),
  description: z.string().min(1).max(160),
  counterpart: z.string().max(120).optional(),
  date: z.coerce.date(),
  accountId: z.string().optional(),
  transferAccountId: z.string().optional(),
  categoryId: z.string().optional(),
  // Presupuesto tipo "proyecto" al que se asigna este movimiento (ej. "Viaje a Buenos
  // Aires"), sea cual sea su categoría. `null` explícito = desasignar.
  budgetId: z.string().nullable().optional(),
  // Meta de ahorro (Goal) a la que se asigna este movimiento — mismo patrón que budgetId.
  goalId: z.string().nullable().optional(),
});
const updateSchema = createSchema.partial();

const SORTABLE = ["date", "amount", "description", "createdAt"] as const;

// GET /api/movements?q=&type=&categoryId=&accountId=&year=&month=&from=&to=
//                   &sort=date&order=desc&page=1&pageSize=50
//
// Returns { items, total, page, pageSize, pages }. Paginated because a synced
// account reaches thousands of rows fast and the UI must not choke on them.
movementsRouter.get("/", ah(async (req, res) => {
  const q = req.query as Record<string, string>;
  const where: Prisma.MovementWhereInput = { userId: req.userId };

  if (q.type) where.type = q.type;
  if (q.categoryId) where.categoryId = q.categoryId === "none" ? null : q.categoryId;
  if (q.accountId) where.accountId = q.accountId;
  if (q.source) where.source = q.source;
  if (q.budgetId) where.budgetId = q.budgetId === "none" ? null : q.budgetId;
  if (q.goalId) where.goalId = q.goalId === "none" ? null : q.goalId;

  if (q.q) {
    // SQLite has no case-insensitive `mode`, so we match on both the raw text and
    // its lowercase form — good enough for a personal ledger and index-friendly.
    const term = q.q.trim();
    where.OR = [
      { description: { contains: term } },
      { description: { contains: term.toLowerCase() } },
      { counterpart: { contains: term } },
      { counterpart: { contains: term.toLowerCase() } },
    ];
  }

  if (q.year) {
    const y = Number(q.year);
    const m = q.month !== undefined && q.month !== "" ? Number(q.month) : undefined;
    where.date = m !== undefined
      ? { gte: new Date(y, m, 1), lt: new Date(y, m + 1, 1) }
      : { gte: new Date(y, 0, 1), lt: new Date(y + 1, 0, 1) };
  } else if (q.from || q.to) {
    where.date = {};
    if (q.from) where.date.gte = new Date(q.from);
    if (q.to) where.date.lte = new Date(q.to);
  }

  const sort = (SORTABLE as readonly string[]).includes(q.sort) ? q.sort : "date";
  const order = q.order === "asc" ? "asc" : "desc";
  const page = Math.max(Number(q.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(q.pageSize) || 50, 1), 200);

  const [total, items] = await Promise.all([
    prisma.movement.count({ where }),
    prisma.movement.findMany({
      where,
      orderBy: { [sort]: order },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { category: true, account: true, transferAccount: true, budget: true, goal: true },
    }),
  ]);

  res.json({ items, total, page, pageSize, pages: Math.ceil(total / pageSize) || 1 });
}));

async function assertOwnsAccounts(userId: string, ids: (string | undefined)[]) {
  const wanted = ids.filter(Boolean) as string[];
  if (!wanted.length) return;
  const count = await prisma.account.count({ where: { id: { in: wanted }, userId } });
  if (count !== wanted.length) throw new HttpError(404, "Cuenta inválida");
}

// Solo los presupuestos tipo PROJECT aceptan asignación manual de movimientos — los
// CATEGORY calculan su gastado solo (por categoría + mes, ver budgets.ts), así que un
// budgetId ahí no haría nada y solo confundiría.
async function assertProjectBudget(userId: string, id: string | null | undefined) {
  if (!id) return;
  const budget = await prisma.budget.findFirst({ where: { id, userId, type: "PROJECT" } });
  if (!budget) throw new HttpError(404, "Presupuesto de proyecto inválido");
}

async function assertGoal(userId: string, id: string | null | undefined) {
  if (!id) return;
  const goal = await prisma.goal.findFirst({ where: { id, userId } });
  if (!goal) throw new HttpError(404, "Meta de ahorro inválida");
}

movementsRouter.post("/", ah(async (req, res) => {
  const data = createSchema.parse(req.body);
  await assertOwnsAccounts(req.userId!, [data.accountId, data.transferAccountId]);
  await assertProjectBudget(req.userId!, data.budgetId);
  await assertGoal(req.userId!, data.goalId);

  if (data.type === "TRANSFER" && !data.transferAccountId)
    throw new HttpError(400, "Una transferencia necesita cuenta de destino");

  // No category? Ask the classifier what it has learned from past corrections.
  const categoryId =
    data.categoryId ?? (await suggestCategory(req.userId!, data.counterpart || data.description));

  // La moneda sigue a la cuenta: un movimiento en una cuenta en dólares es en dólares,
  // aunque el form mande el default ARS. Sin esto, el saldo de la cuenta (que es USD)
  // se mostraría bien pero el movimiento diría ARS, y no cerrarían entre sí.
  let currency = data.currency;
  if (data.accountId) {
    const acc = await prisma.account.findFirst({
      where: { id: data.accountId, userId: req.userId },
      select: { currency: true },
    });
    if (acc) currency = acc.currency;
  }

  const row = await prisma.movement.create({
    data: { ...data, currency, categoryId, userId: req.userId! },
    include: { category: true, account: true, budget: true, goal: true },
  });

  // An explicit category is the user teaching us. Remember it.
  if (data.categoryId)
    await learn(req.userId!, data.counterpart || data.description, data.categoryId);

  res.status(201).json(row);
}));

movementsRouter.patch("/:id", ah(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const found = await prisma.movement.findFirst({
    where: { id: req.params.id, userId: req.userId },
  });
  if (!found) throw new HttpError(404, "Movimiento no encontrado");
  await assertOwnsAccounts(req.userId!, [data.accountId, data.transferAccountId]);
  if (data.budgetId !== undefined) await assertProjectBudget(req.userId!, data.budgetId);
  if (data.goalId !== undefined) await assertGoal(req.userId!, data.goalId);

  const row = await prisma.movement.update({
    where: { id: req.params.id },
    data,
    include: { category: true, account: true, budget: true, goal: true },
  });

  // Re-categorising is the strongest signal we get: the user is correcting us.
  if (data.categoryId)
    await learn(
      req.userId!,
      (data.counterpart ?? found.counterpart) || (data.description ?? found.description),
      data.categoryId
    );

  res.json(row);
}));

movementsRouter.delete("/:id", ah(async (req, res) => {
  const found = await prisma.movement.findFirst({
    where: { id: req.params.id, userId: req.userId },
  });
  if (!found) throw new HttpError(404, "Movimiento no encontrado");
  await prisma.movement.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));
