import { Router } from "express";
import { prisma } from "../lib/prisma";
import { patrimonio } from "../lib/finance";
import { requireAuth } from "../middleware/auth";
import { ah } from "../utils/asyncHandler";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

const MONTHS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function range(year: number, period: string, index: number) {
  if (period === "month") return { from: new Date(year, index, 1), to: new Date(year, index + 1, 1), label: `${MONTHS[index]} ${year}` };
  if (period === "quarter") return { from: new Date(year, index * 3, 1), to: new Date(year, index * 3 + 3, 1), label: `Q${index + 1} ${year}` };
  return { from: new Date(year, 0, 1), to: new Date(year + 1, 0, 1), label: `Año ${year}` };
}

// One endpoint feeds every report format — PDF, Excel and CSV all render the same
// numbers, so they can never disagree with each other.
reportsRouter.get("/summary", ah(async (req, res) => {
  const userId = req.userId!;
  const year = Number(req.query.year ?? new Date().getFullYear());
  const period = (req.query.period as string) || "month";
  const index = Number(req.query.index ?? new Date().getMonth());
  const { from, to, label } = range(year, period, index);

  const [movements, wealth] = await Promise.all([
    prisma.movement.findMany({
      where: { userId, date: { gte: from, lt: to } },
      orderBy: { date: "asc" },
      include: { category: true, account: true },
    }),
    patrimonio(userId),
  ]);

  let income = 0, expense = 0;
  const byCategory: Record<string, { name: string; color: string; amount: number }> = {};

  for (const m of movements) {
    const amount = Number(m.amount);
    if (m.type === "INCOME") income += amount;
    else if (m.type === "EXPENSE") {
      expense += amount;
      const key = m.categoryId ?? "none";
      byCategory[key] ??= {
        name: m.category?.name ?? "Sin categoría",
        color: m.category?.color ?? "#71717A",
        amount: 0,
      };
      byCategory[key].amount += amount;
    }
  }

  res.json({
    label, period, year, index,
    from: from.toISOString(), to: to.toISOString(),
    totals: {
      income, expense,
      balance: income - expense,
      spentPct: income > 0 ? Math.round((expense / income) * 100) : expense > 0 ? 100 : 0,
    },
    categories: Object.values(byCategory).sort((a, b) => b.amount - a.amount),
    patrimonio: {
      neto: wealth.neto, disponible: wealth.disponible,
      invertido: wealth.invertido, deudas: wealth.deudas, porCobrar: wealth.porCobrar,
    },
    movements: movements.map((m: any) => ({
      id: m.id, date: m.date, type: m.type,
      description: m.description, counterpart: m.counterpart,
      amount: Number(m.amount), currency: m.currency,
      category: m.category?.name ?? "",
      account: m.account?.name ?? "",
    })),
  });
}));

// Excel opens CSV natively, so this one file covers both "give me a spreadsheet"
// and "give me raw data". Semicolon-separated + BOM so Excel in es-AR gets the
// columns right instead of dumping everything into column A.
reportsRouter.get("/movements.csv", ah(async (req, res) => {
  const userId = req.userId!;
  const year = Number(req.query.year ?? new Date().getFullYear());
  const period = (req.query.period as string) || "year";
  const index = Number(req.query.index ?? 0);
  const { from, to, label } = range(year, period, index);

  const movements = await prisma.movement.findMany({
    where: { userId, date: { gte: from, lt: to } },
    orderBy: { date: "asc" },
    include: { category: true, account: true },
  });

  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const header = ["Fecha", "Tipo", "Descripción", "Contraparte", "Categoría", "Cuenta", "Moneda", "Monto"];
  const lines = [header.join(";")];

  for (const m of movements as any[]) {
    lines.push([
      new Date(m.date).toLocaleDateString("es-AR"),
      m.type,
      esc(m.description),
      esc(m.counterpart),
      esc(m.category?.name),
      esc(m.account?.name),
      m.currency,
      // es-AR decimal comma, so the number lands as a number in Excel
      Number(m.amount).toFixed(2).replace(".", ","),
    ].join(";"));
  }

  const filename = `finance-os-${label.toLowerCase().replace(/\s+/g, "-")}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send("\uFEFF" + lines.join("\r\n")); // BOM: makes Excel read UTF-8 accents
}));
