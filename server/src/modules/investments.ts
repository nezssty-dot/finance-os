import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { ah } from "../utils/asyncHandler";
import { HttpError } from "../middleware/error";
import { groupByAssetType } from "../lib/portfolio-breakdown";

export const investmentsRouter = Router();
investmentsRouter.use(requireAuth);

const KINDS = ["PESOS", "USD", "USDT", "BTC", "ETH", "STOCK", "FUND", "FIXED_TERM"] as const;

const createSchema = z.object({
  name: z.string().min(1).max(80),
  kind: z.enum(KINDS),
  capital: z.coerce.number().positive(),
  currentValue: z.coerce.number().min(0),
  quantity: z.coerce.number().optional(),
  currency: z.string().default("ARS"),
});
const updateSchema = createSchema.partial();

const shape = (i: any) => {
  const capital = Number(i.capital);
  const value = Number(i.currentValue);
  return {
    id: i.id, name: i.name, kind: i.kind, currency: i.currency,
    quantity: i.quantity === null ? null : Number(i.quantity),
    capital, currentValue: value,
    gain: value - capital,
    pct: capital > 0 ? Math.round(((value - capital) / capital) * 1000) / 10 : 0,
    // Unit cost / current unit price — the hook for a future quotes API to write into.
    unitCost: i.quantity ? capital / Number(i.quantity) : null,
    unitValue: i.quantity ? value / Number(i.quantity) : null,
    createdAt: i.createdAt, updatedAt: i.updatedAt,
  };
};

investmentsRouter.get("/", ah(async (req, res) => {
  // Inversiones muestra DOS fuentes juntas: las cargadas a mano (Investment) y las
  // tenencias sincronizadas de brokers (Holding, de IOL). Antes solo leía Investment, así
  // que las posiciones de IOL —aunque se sincronizaban bien— no aparecían acá.
  const [manual, holdings] = await Promise.all([
    prisma.investment.findMany({ where: { userId: req.userId }, orderBy: { createdAt: "desc" } }),
    prisma.holding.findMany({
      where: { userId: req.userId, closed: false },
      orderBy: { totalValue: "desc" },
    }),
  ]);

  const holdingShaped = holdings.map((h) => {
    const capital = Number(h.avgPrice) * Number(h.quantity);
    const value = Number(h.totalValue);
    return {
      id: h.id,
      ticker: h.ticker,
      name: h.name,
      kind: h.kind,
      currency: h.currency,
      quantity: Number(h.quantity),
      capital,
      currentValue: value,
      gain: Number(h.gainAmount),
      pct: Number(h.gainPct),
      unitCost: Number(h.avgPrice),
      unitValue: Number(h.currentPrice),
      source: "IOL" as const, // el front puede marcarlas como sincronizadas (solo lectura)
      updatedAt: h.updatedAt,
    };
  });

  const items = [...manual.map((i) => ({ ...shape(i), source: "MANUAL" as const })), ...holdingShaped];

  // Desglose por tipo de activo (Acciones, CEDEARs, Bonos, Renta fija, Crypto…) con
  // porcentajes, para que Inversiones no sea solo una tabla. Lógica pura y testeada.
  const breakdown = groupByAssetType(items);

  res.json({ items, breakdown });
}));

investmentsRouter.post("/", ah(async (req, res) => {
  const data = createSchema.parse(req.body);
  const row = await prisma.investment.create({ data: { ...data, userId: req.userId! } });
  res.status(201).json(shape(row));
}));

investmentsRouter.patch("/:id", ah(async (req, res) => {
  const data = updateSchema.parse(req.body);
  const found = await prisma.investment.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!found) throw new HttpError(404, "Inversión no encontrada");
  res.json(shape(await prisma.investment.update({ where: { id: req.params.id }, data })));
}));

investmentsRouter.delete("/:id", ah(async (req, res) => {
  const found = await prisma.investment.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!found) throw new HttpError(404, "Inversión no encontrada");
  await prisma.investment.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

// Sell (fully or partially): the proceeds land back in an account as income, and the
// position shrinks. Net worth is unchanged by the act of selling — only by the gain
// that was already reflected in currentValue.
investmentsRouter.post("/:id/sell", ah(async (req, res) => {
  const { amount, accountId, date } = z.object({
    amount: z.coerce.number().positive(),
    accountId: z.string().optional(),
    date: z.coerce.date().default(() => new Date()),
  }).parse(req.body);

  const inv = await prisma.investment.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!inv) throw new HttpError(404, "Inversión no encontrada");

  const value = Number(inv.currentValue);
  if (amount > value + 0.01) throw new HttpError(400, `No podés vender más de ${value.toFixed(2)}`);

  const remainingValue = value - amount;
  // Cost basis shrinks proportionally, so the % return on what's left stays honest.
  const remainingCapital = value > 0 ? Number(inv.capital) * (remainingValue / value) : 0;

  await prisma.$transaction([
    prisma.movement.create({
      data: {
        userId: req.userId!, type: "INCOME", amount,
        description: `Venta de ${inv.name}`, counterpart: inv.name,
        date, accountId: accountId ?? null, source: "MANUAL",
      },
    }),
    remainingValue <= 0.01
      ? prisma.investment.delete({ where: { id: inv.id } })
      : prisma.investment.update({
          where: { id: inv.id },
          data: { currentValue: remainingValue, capital: remainingCapital },
        }),
  ]);

  res.json({ sold: amount, closed: remainingValue <= 0.01 });
}));
