import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { patrimonio } from "../lib/finance";
import { currentRate } from "../integrations/fx/service";
import { totalIn } from "../lib/fx";
import { requireAuth } from "../middleware/auth";
import { ah } from "../utils/asyncHandler";

export const patrimonioRouter = Router();
patrimonioRouter.use(requireAuth);

// Always computed from live data — there is no stored net worth to go stale.
patrimonioRouter.get("/current", ah(async (req, res) => {
  const wealth = await patrimonio(req.userId!);

  // Valuación en dólares. Si no hay cotización (sin internet la primera vez), `rate` es
  // null y NO se inventa ninguna: se manda usd:null y la pantalla muestra solo pesos.
  const { rate, quote, stale } = await currentRate();
  const totals: Record<string, number> = {};
  for (const [c, v] of Object.entries(wealth.disponibleByCurrency ?? {})) totals[c] = (totals[c] ?? 0) + v;
  for (const [c, v] of Object.entries(wealth.invertidoByCurrency ?? {})) totals[c] = (totals[c] ?? 0) + v;

  const inUsd = totalIn(totals, "USD", rate);
  const inArs = totalIn(totals, "ARS", rate);

  res.json({
    ...wealth,
    fx: {
      rate,
      kind: quote?.kind ?? null,
      date: quote?.date ?? null,
      stale,
      // `complete:false` significa que quedó plata sin convertir (una moneda sin
      // cotización): la pantalla lo avisa en vez de mostrar un total que parece entero.
      totalUSD: rate === null ? null : inUsd.total,
      totalARS: rate === null ? null : inArs.total,
      complete: inUsd.converted && inArs.converted,
    },
  });
}));

// Net worth over time. Transfers are excluded on purpose: moving your own money
// between your own accounts is not income and not an expense.
patrimonioRouter.get("/history", ah(async (req, res) => {
  const period = (req.query.period as string) || "month";
  const year = req.query.year ? Number(req.query.year) : undefined;

  const where: Prisma.MovementWhereInput = { userId: req.userId, type: { in: ["INCOME", "EXPENSE"] } };
  if (year) where.date = { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) };

  const movements = await prisma.movement.findMany({
    where, orderBy: { date: "asc" },
    select: { date: true, type: true, amount: true },
  });

  const buckets: Record<string, { inc: number; exp: number }> = {};
  for (const m of movements) {
    const d = new Date(m.date);
    let key: string;
    if (period === "day") key = d.toISOString().slice(0, 10);
    else if (period === "week") {
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      key = monday.toISOString().slice(0, 10);
    } else if (period === "year") key = String(d.getFullYear());
    else key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

    buckets[key] ??= { inc: 0, exp: 0 };
    if (m.type === "INCOME") buckets[key].inc += Number(m.amount);
    else buckets[key].exp += Number(m.amount);
  }

  let cumulative = 0;
  const history = Object.keys(buckets).sort().map((key) => {
    const b = buckets[key];
    cumulative += b.inc - b.exp;
    return { period: key, income: b.inc, expense: b.exp, balance: b.inc - b.exp, cumulative };
  });

  res.json({ period, history });
}));
