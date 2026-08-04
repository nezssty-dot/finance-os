import { Router } from "express";
import { z } from "zod";
import { Debt } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { ah } from "../utils/asyncHandler";
import { HttpError } from "../middleware/error";

export const debtsRouter = Router();
debtsRouter.use(requireAuth);

const createSchema = z.object({
  name: z.string().min(1).max(80),          // the person or entity
  amount: z.coerce.number().positive(),
  kind: z.enum(["OWE", "OWED"]).default("OWE"),
  dueDate: z.coerce.date().optional(),
});
const updateSchema = createSchema.partial().extend({ settled: z.boolean().optional() });

const shape = (d: Debt) => {
  const outstanding = Math.max(Number(d.amount) - Number(d.paid), 0);
  return {
    id: d.id, name: d.name, kind: d.kind, dueDate: d.dueDate, settled: d.settled,
    amount: Number(d.amount), paid: Number(d.paid), outstanding,
    pct: Number(d.amount) > 0 ? Math.round((Number(d.paid) / Number(d.amount)) * 100) : 0,
    overdue: !d.settled && d.dueDate ? new Date(d.dueDate) < new Date() : false,
  };
};

debtsRouter.get("/", ah(async (req, res) => {
  const rows = await prisma.debt.findMany({
    where: { userId: req.userId },
    orderBy: [{ settled: "asc" }, { dueDate: "asc" }],
  });
  res.json(rows.map(shape));
}));

debtsRouter.post("/", ah(async (req, res) => {
  const data = createSchema.parse(req.body);
  const row = await prisma.debt.create({ data: { ...data, userId: req.userId! } });
  res.status(201).json(shape(row));
}));

debtsRouter.patch("/:id", ah(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const found = await prisma.debt.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!found) throw new HttpError(404, "Deuda no encontrada");
  const row = await prisma.debt.update({ where: { id: req.params.id }, data });
  res.json(shape(row));
}));

debtsRouter.delete("/:id", ah(async (req, res) => {
  const found = await prisma.debt.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!found) throw new HttpError(404, "Deuda no encontrada");
  await prisma.debt.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

// Register a payment — partial or full.
//
// Paying a debt does not make you poorer: the cash leaves the account and the
// debt shrinks by the same amount, so net worth is unchanged. That falls out for
// free here because the movement lowers the account balance while `paid` lowers
// the outstanding debt, and net worth counts both.
debtsRouter.post("/:id/pay", ah(async (req, res) => {
  const { amount, accountId, date } = z.object({
    amount: z.coerce.number().positive(),
    accountId: z.string().optional(),
    date: z.coerce.date().default(() => new Date()),
  }).parse(req.body);

  const debt = await prisma.debt.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!debt) throw new HttpError(404, "Deuda no encontrada");
  if (debt.settled) throw new HttpError(400, "Esa deuda ya está saldada");

  const outstanding = Number(debt.amount) - Number(debt.paid);
  if (amount > outstanding + 0.01)
    throw new HttpError(400, `El pago supera lo que queda (${outstanding.toFixed(2)})`);

  const paid = Number(debt.paid) + amount;
  const settled = paid >= Number(debt.amount) - 0.01;

  const [updated] = await prisma.$transaction([
    prisma.debt.update({ where: { id: debt.id }, data: { paid, settled } }),
    prisma.movement.create({
      data: {
        userId: req.userId!,
        // OWE  -> we pay out.  OWED -> they pay us back.
        type: debt.kind === "OWE" ? "DEBT_PAYMENT" : "COLLECTION",
        amount,
        description: debt.kind === "OWE" ? `Pago a ${debt.name}` : `Cobro de ${debt.name}`,
        counterpart: debt.name,
        date,
        accountId: accountId ?? null,
        source: "MANUAL",
      },
    }),
  ]);

  res.json(shape(updated));
}));
