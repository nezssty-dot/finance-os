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
      include: { category: true, account: true, transferAccount: true },
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

movementsRouter.post("/", ah(async (req, res) => {
  const data = createSchema.parse(req.body);
  await assertOwnsAccounts(req.userId!, [data.accountId, data.transferAccountId]);

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
    include: { category: true, account: true },
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

  const row = await prisma.movement.update({
    where: { id: req.params.id },
    data,
    include: { category: true, account: true },
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
