import { Router } from "express";
import { prisma } from "../lib/prisma";
import { patrimonio } from "../lib/finance";
import { activitySummary } from "../lib/activity";
import { requireAuth } from "../middleware/auth";
import { ah } from "../utils/asyncHandler";
import { computeHealth } from "../lib/health";
import { recommendations } from "../lib/recommendations";
import { outstanding } from "../lib/balance-math";
import { committedByCurrency, monthBounds, type ServiceLike, type Frequency } from "../lib/services-math";
import { currentRate } from "../integrations/fx/service";
import { commitmentSummary } from "../lib/commitments";

export const analysisRouter = Router();
analysisRouter.use(requireAuth);

const ARS = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);

type Sum = { inc: number; exp: number };

// ─── Dashboard summary (real data, no mocks) ───
analysisRouter.get(
  "/dashboard",
  ah(async (req, res) => {
    const year = Number(req.query.year ?? new Date().getFullYear());
    const userId = req.userId!;

    // Monthly totals
    const movements = await prisma.movement.findMany({
      where: { userId, date: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) }, type: { in: ["INCOME", "EXPENSE"] } },
      include: { category: true },
    });

    const byMonth: Record<number, Sum> = {};
    const catTotals: Record<string, { name: string; color: string; amount: number }> = {};
    for (const m of movements) {
      const mo = new Date(m.date).getMonth();
      byMonth[mo] ??= { inc: 0, exp: 0 };
      const amt = Number(m.amount);
      if (m.type === "INCOME") byMonth[mo].inc += amt;
      else {
        byMonth[mo].exp += amt;
        if (m.category) {
          catTotals[m.categoryId!] ??= { name: m.category.name, color: m.category.color, amount: 0 };
          catTotals[m.categoryId!].amount += amt;
        }
      }
    }

    // Net worth comes from the single finance engine — never recomputed by hand.
    const wealth = await patrimonio(userId);
    const goals = await prisma.goal.findMany({ where: { userId } });


    // Monthly series for charts
    const months = [];
    let cumSaving = 0;
    for (let mo = 0; mo < 12; mo++) {
      const s = byMonth[mo] ?? { inc: 0, exp: 0 };
      cumSaving += s.inc - s.exp;
      months.push({ month: mo, income: s.inc, expense: s.exp, balance: s.inc - s.exp, cumulative: cumSaving });
    }

    // Category breakdown (top 10)
    const categories = Object.values(catTotals).sort((a, b) => b.amount - a.amount).slice(0, 10);

    // Recent movements (last 8)
    const recent = await prisma.movement.findMany({
      where: { userId },
      orderBy: { date: "desc" },
      take: 8,
      include: { category: true, account: true },
    });

    // Actividad viva (hoy / semana / mes). Usa la fecha REAL —no el año que se está
    // viendo— porque "hoy ganaste" siempre es hoy. Solo el mes actual: es lo que las
    // ventanas necesitan, y evita traer todo el historial.
    const now = new Date();
    const activityFrom = new Date(now.getFullYear(), now.getMonth(), 1);
    const activityRows = await prisma.movement.findMany({
      where: { userId, type: { in: ["INCOME", "EXPENSE"] }, date: { gte: activityFrom } },
      select: { date: true, type: true, amount: true },
    });
    const activity = activitySummary(
      activityRows.map((m) => ({ date: m.date, type: m.type, amount: Number(m.amount) })),
      now
    );

    res.json({
      year,
      patrimonio: wealth,
      months,
      categories,
      goals: goals.map((g) => ({ ...g, target: Number(g.target), saved: Number(g.saved) })),
      recent,
      activity,
      accounts: wealth.accounts,
    });
  })
);

// ─── Insights engine (rule-based, no AI API needed) ───
analysisRouter.get(
  "/insights",
  ah(async (req, res) => {
    const year = Number(req.query.year ?? new Date().getFullYear());
    const userId = req.userId!;

    const [movements, prevMovements, wealth, budgets, debts, goals] = await Promise.all([
      prisma.movement.findMany({
        where: {
          userId,
          date: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) },
          type: { in: ["INCOME", "EXPENSE"] },
        },
        include: { category: true },
      }),
      prisma.movement.findMany({
        where: {
          userId,
          date: { gte: new Date(year - 1, 0, 1), lt: new Date(year, 0, 1) },
          type: { in: ["INCOME", "EXPENSE"] },
        },
        select: { type: true, amount: true },
      }),
      patrimonio(userId),
      prisma.budget.findMany({ where: { userId }, include: { category: true } }),
      prisma.debt.findMany({ where: { userId, settled: false } }),
      prisma.goal.findMany({ where: { userId } }),
    ]);

    const MN = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

    const byMonth: Record<number, Sum> = {};
    const catByMonth: Record<number, Record<string, number>> = {};
    const catColor: Record<string, string> = {};

    for (const m of movements) {
      const mo = new Date(m.date).getMonth();
      byMonth[mo] ??= { inc: 0, exp: 0 };
      const amt = Number(m.amount);
      if (m.type === "INCOME") byMonth[mo].inc += amt;
      else {
        byMonth[mo].exp += amt;
        const cat = m.category?.name ?? "Sin categoría";
        catColor[cat] = m.category?.color ?? "#71717A";
        catByMonth[mo] ??= {};
        catByMonth[mo][cat] = (catByMonth[mo][cat] ?? 0) + amt;
      }
    }

    const active = Object.keys(byMonth).map(Number).sort((a, b) => a - b);

    // ── Series for the charts ──
    let cum = 0;
    const savings = active.map((mo) => {
      const bal = byMonth[mo].inc - byMonth[mo].exp;
      cum += bal;
      return {
        month: mo,
        name: MN[mo],
        income: byMonth[mo].inc,
        expense: byMonth[mo].exp,
        balance: bal,
        cumulative: cum,
      };
    });

    const totalSaved = cum;
    const avgSaving = active.length ? totalSaved / active.length : 0;

    // ── Categories that grew the most (last month vs the one before) ──
    const growth: { name: string; color: string; current: number; previous: number; pct: number }[] = [];
    if (active.length >= 2) {
      const cur = active[active.length - 1], prev = active[active.length - 2];
      const cc = catByMonth[cur] ?? {}, pc = catByMonth[prev] ?? {};
      for (const name of new Set([...Object.keys(cc), ...Object.keys(pc)])) {
        const c = cc[name] ?? 0, p = pc[name] ?? 0;
        if (p === 0 && c === 0) continue;
        growth.push({
          name,
          color: catColor[name] ?? "#71717A",
          current: c,
          previous: p,
          // No previous spend means it is new, not infinitely worse. 100% keeps the
          // sort honest instead of letting a brand-new category dominate the list.
          pct: p > 0 ? Math.round(((c - p) / p) * 100) : c > 0 ? 100 : -100,
        });
      }
      growth.sort((a, b) => b.pct - a.pct);
    }

    // ── Year over year ──
    let prevIncome = 0, prevExpense = 0;
    for (const m of prevMovements) {
      if (m.type === "INCOME") prevIncome += Number(m.amount);
      else prevExpense += Number(m.amount);
    }
    const income = active.reduce((s, mo) => s + byMonth[mo].inc, 0);
    const expense = active.reduce((s, mo) => s + byMonth[mo].exp, 0);

    const yearComparison = prevIncome > 0 || prevExpense > 0
      ? {
          previousYear: year - 1,
          income: { current: income, previous: prevIncome, pct: prevIncome > 0 ? Math.round(((income - prevIncome) / prevIncome) * 100) : null },
          expense: { current: expense, previous: prevExpense, pct: prevExpense > 0 ? Math.round(((expense - prevExpense) / prevExpense) * 100) : null },
          saving: { current: income - expense, previous: prevIncome - prevExpense },
        }
      : null;

    // ── The rules ──
    // Every line below is derived from the user's own numbers. No model, no API, no
    // invented advice — if the data doesn't support a statement, it isn't shown.
    type Insight = { kind: string; severity: "alert" | "warning" | "info" | "good"; text: string; data?: any };
    const insights: Insight[] = [];

    // Budgets already blown, or on track to be.
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();

    if (budgets.length && year === now.getFullYear()) {
      const spent: Record<string, number> = {};
      for (const m of movements) {
        if (m.type !== "EXPENSE" || !m.categoryId) continue;
        if (new Date(m.date) < monthStart) continue;
        spent[m.categoryId] = (spent[m.categoryId] ?? 0) + Number(m.amount);
      }
      for (const b of budgets) {
        const used = spent[b.categoryId] ?? 0;
        const limit = Number(b.limit);
        const projected = dayOfMonth > 0 ? (used / dayOfMonth) * daysInMonth : 0;
        if (used > limit) {
          insights.push({
            kind: "budget",
            severity: "alert",
            text: `Te pasaste ${ARS(used - limit)} del presupuesto de ${b.category.name}.`,
            data: { category: b.category.name, used, limit },
          });
        } else if (projected > limit) {
          insights.push({
            kind: "budget",
            severity: "warning",
            text: `A este ritmo cerrás el mes con ${ARS(projected)} en ${b.category.name}, y el límite es ${ARS(limit)}.`,
            data: { category: b.category.name, projected, limit },
          });
        }
      }
    }

    // Debts past their due date.
    const overdue = debts.filter((d) => d.dueDate && new Date(d.dueDate) < now);
    for (const d of overdue.slice(0, 3)) {
      const left = Number(d.amount) - Number(d.paid);
      insights.push({
        kind: "debt",
        severity: "alert",
        text: d.kind === "OWE"
          ? `La deuda con ${d.name} está vencida: quedan ${ARS(left)}.`
          : `${d.name} te debe ${ARS(left)} y ya pasó el vencimiento.`,
        data: { name: d.name, left, kind: d.kind },
      });
    }

    // Goals that won't make their deadline at the current saving rate.
    for (const g of goals) {
      if (!g.deadline) continue;
      const remaining = Number(g.target) - Number(g.saved);
      if (remaining <= 0) continue;
      if (avgSaving <= 0) continue;
      const monthsNeeded = Math.ceil(remaining / avgSaving);
      const eta = new Date(new Date().setMonth(new Date().getMonth() + monthsNeeded));
      if (eta > new Date(g.deadline)) {
        const monthsLeft = Math.max(
          Math.round((new Date(g.deadline).getTime() - now.getTime()) / (30 * 864e5)),
          1
        );
        insights.push({
          kind: "goal",
          severity: "warning",
          text: `Para llegar a "${g.name}" a tiempo necesitás ahorrar ${ARS(remaining / monthsLeft)} por mes. Hoy ahorrás ${ARS(avgSaving)}.`,
          data: { goal: g.name, needed: remaining / monthsLeft, actual: avgSaving },
        });
      }
    }

    // Month over month.
    if (active.length >= 2) {
      const cur = active[active.length - 1], prev = active[active.length - 2];
      if (byMonth[prev].exp > 0) {
        const pct = Math.round(((byMonth[cur].exp - byMonth[prev].exp) / byMonth[prev].exp) * 100);
        if (Math.abs(pct) >= 5)
          insights.push({
            kind: "month_comparison",
            severity: pct > 20 ? "warning" : pct < 0 ? "good" : "info",
            text: `En ${MN[cur]} gastaste un ${Math.abs(pct)}% ${pct >= 0 ? "más" : "menos"} que en ${MN[prev]}.`,
            data: { current: byMonth[cur].exp, previous: byMonth[prev].exp, pct },
          });
      }

      for (const g of growth.filter((x) => Math.abs(x.pct) >= 15 && x.previous > 0).slice(0, 2)) {
        // Un cambio de 752.746% (mes previo casi cero) es correcto pero ilegible y asusta
        // sin informar. Arriba de 300% se cambia por un texto que sí se entiende: lo que
        // importa ahí no es el número exacto, es que el gasto se disparó desde casi nada.
        const text = Math.abs(g.pct) > 300
          ? `${g.name} pasó de ${ARS(g.previous)} en ${MN[prev]} a ${ARS(g.current)} este mes.`
          : `${g.name} ${g.pct >= 0 ? "aumentó" : "bajó"} un ${Math.abs(g.pct)}% respecto a ${MN[prev]}.`;
        insights.push({
          kind: "category_change",
          severity: g.pct >= 40 ? "warning" : "info",
          text,
          data: g,
        });
      }
    }

    // Year over year.
    if (yearComparison?.expense.pct !== null && yearComparison?.expense.pct !== undefined) {
      const pct = yearComparison.expense.pct;
      if (Math.abs(pct) >= 10)
        insights.push({
          kind: "year_comparison",
          severity: pct > 25 ? "warning" : pct < 0 ? "good" : "info",
          text: `Contra ${year - 1}, tus gastos ${pct >= 0 ? "subieron" : "bajaron"} un ${Math.abs(pct)}%.`,
          data: yearComparison.expense,
        });
    }

    // Savings rate — the number that actually decides whether you get ahead.
    if (income > 0) {
      const rate = Math.round(((income - expense) / income) * 100);
      insights.push({
        kind: "savings_rate",
        severity: rate < 0 ? "alert" : rate < 10 ? "warning" : rate >= 20 ? "good" : "info",
        text: rate < 0
          ? `Estás gastando más de lo que entra: ${Math.abs(rate)}% por encima de tus ingresos.`
          : `Estás ahorrando el ${rate}% de lo que entra.${rate < 10 ? " Por debajo del 10% cuesta mucho construir colchón." : ""}`,
        data: { rate, income, expense },
      });
    }

    // Projection to year end.
    if (active.length >= 3) {
      const remaining = 11 - active[active.length - 1];
      const projected = totalSaved + avgSaving * remaining;
      insights.push({
        kind: "projection",
        severity: "info",
        text: `Llevás ${ARS(totalSaved)} ahorrados en ${year}. Al ritmo actual cerrás el año en ${ARS(projected)}.`,
        data: { current: totalSaved, projected, avgMonthly: avgSaving, remaining },
      });
    }

    // One category eating everything.
    const lastMonth = active[active.length - 1];
    if (lastMonth !== undefined && catByMonth[lastMonth]) {
      const sorted = Object.entries(catByMonth[lastMonth]).sort((a, b) => b[1] - a[1]);
      if (sorted.length) {
        const total = sorted.reduce((s, [, v]) => s + v, 0);
        const [name, amt] = sorted[0];
        const share = Math.round((amt / total) * 100);
        if (share >= 35)
          insights.push({
            kind: "category_dominance",
            severity: share >= 50 ? "warning" : "info",
            text: `${name} se lleva el ${share}% de tus gastos de ${MN[lastMonth]} (${ARS(amt)}).`,
            data: { category: name, share, amount: amt },
          });
      }
    }

    // Income falling off a cliff.
    if (active.length >= 3) {
      const incomes = active.map((mo) => byMonth[mo].inc);
      const avg = incomes.reduce((s, v) => s + v, 0) / incomes.length;
      const last = incomes[incomes.length - 1];
      if (avg > 0 && last < avg * 0.7)
        insights.push({
          kind: "income_warning",
          severity: "warning",
          text: `Tus ingresos de ${MN[lastMonth]} están un ${Math.round(((avg - last) / avg) * 100)}% por debajo de tu promedio.`,
          data: { last, avg },
        });
    }

    // ─── Insights de servicios ───
    // Usan el historial real de pagos (ServicePayment), no estimaciones. El aumento se
    // detecta comparando lo que costó el último pago contra el anterior del mismo
    // servicio — por eso ServicePayment guarda el monto de CADA pago, no solo el actual.
    const services = await prisma.service.findMany({
      where: { userId, active: true },
      include: { payments: { orderBy: { dueDate: "desc" }, take: 2 } },
    });

    if (services.length > 0) {
      // Cuánto se destina por mes a servicios mensuales en ARS.
      const monthlyARS = services
        .filter((s) => s.frequency === "MONTHLY" && s.currency === "ARS")
        .reduce((sum, s) => sum + Number(s.amount), 0);
      if (monthlyARS > 0) {
        insights.push({
          kind: "services_total",
          severity: "info",
          text: `Tenés ${services.length} servicio${services.length === 1 ? "" : "s"} activo${services.length === 1 ? "" : "s"}: ${ARS(monthlyARS)} por mes en los mensuales.`,
          data: { count: services.length, monthlyARS },
        });
      }

      // Aumentos: último pago más caro que el anterior, en el mismo servicio.
      for (const s of services) {
        if (s.payments.length < 2) continue;
        const [last, prev] = s.payments;
        const lastAmt = Number(last.amount);
        const prevAmt = Number(prev.amount);
        if (prevAmt > 0 && lastAmt > prevAmt) {
          const pctUp = Math.round(((lastAmt - prevAmt) / prevAmt) * 100);
          if (pctUp >= 5) {
            insights.push({
              kind: "service_increase",
              severity: "warning",
              text: `${s.name} aumentó un ${pctUp}%: pasó de ${ARS(prevAmt)} a ${ARS(lastAmt)}.`,
              data: { serviceId: s.id, pctUp },
            });
          }
        }
      }
    }

    // Best and worst month.
    if (active.length >= 3) {
      let best = active[0], worst = active[0];
      for (const mo of active) {
        const bal = byMonth[mo].inc - byMonth[mo].exp;
        if (bal > byMonth[best].inc - byMonth[best].exp) best = mo;
        if (bal < byMonth[worst].inc - byMonth[worst].exp) worst = mo;
      }
      insights.push({
        kind: "best_worst",
        severity: "info",
        text: `Tu mejor mes fue ${MN[best]} (${ARS(byMonth[best].inc - byMonth[best].exp)} de ahorro) y el más ajustado ${MN[worst]}.`,
        data: { best, worst },
      });
    }

    // Alerts first: what needs action beats what is merely interesting.
    const rank = { alert: 0, warning: 1, good: 2, info: 3 } as const;
    insights.sort((a, b) => rank[a.severity] - rank[b.severity]);

    // ── Recomendaciones accionables ──
    // Snapshot del mes en curso (si se mira el año actual) o del último mes con datos.
    const nowMonth = year === new Date().getFullYear() ? new Date().getMonth() : (active.at(-1) ?? 0);
    const curCats = catByMonth[nowMonth] ?? {};
    const categoriesThisMonth = Object.entries(curCats).map(([name, amount]) => ({ name, amount }));
    // Promedio por categoría sobre los meses en que aparece (para detectar excesos puntuales).
    const catSums: Record<string, { total: number; months: number }> = {};
    for (const mo of active) {
      for (const [name, amt] of Object.entries(catByMonth[mo] ?? {})) {
        catSums[name] ??= { total: 0, months: 0 };
        catSums[name].total += amt;
        catSums[name].months += 1;
      }
    }
    const categoryAverages: Record<string, number> = {};
    for (const [name, { total, months }] of Object.entries(catSums)) {
      categoryAverages[name] = months > 0 ? total / months : 0;
    }
    const remainingMonths = year === new Date().getFullYear() ? 12 - (new Date().getMonth() + 1) : 0;
    const projectedYearEndSavings = totalSaved + Math.round(avgSaving) * remainingMonths;

    const recos = recommendations({
      monthIncome: byMonth[nowMonth]?.inc ?? 0,
      monthExpense: byMonth[nowMonth]?.exp ?? 0,
      avgMonthlyIncome: active.length ? income / active.length : 0,
      avgMonthlyExpense: active.length ? expense / active.length : 0,
      categoriesThisMonth,
      categoryAverages,
      // Solo cuentas en ARS entran a la concentración, para no mezclar monedas.
      accounts: wealth.accounts
        .filter((a) => a.currency === "ARS")
        .map((a) => ({ name: a.name, balance: Number(a.balance) })),
      debts: debts.map((d) => ({
        name: d.name,
        outstanding: outstanding(Number(d.amount), Number(d.paid)),
      })),
      disponibleARS: wealth.disponible,
      invertidoARS: wealth.invertido,
      netWorthARS: wealth.neto,
      projectedYearEndSavings,
    });

    res.json({
      year,
      insights,
      recommendations: recos,
      savings: { series: savings, total: totalSaved, avgMonthly: Math.round(avgSaving) },
      patrimonio: {
        neto: wealth.neto,
        disponible: wealth.disponible,
        invertido: wealth.invertido,
        deudas: wealth.deudas,
        porCobrar: wealth.porCobrar,
        breakdown: wealth.breakdown,
      },
      categories: { growth: growth.slice(0, 8) },
      yearComparison,
      totals: { income, expense, balance: income - expense },
    });
  })
);

/**
 * GET /api/analysis/health
 * La Salud Financiera: un puntaje 0-100 con sus factores explicables. El cálculo vive en
 * lib/health.ts (puro y testeado); acá solo se juntan los ingredientes del MES ACTUAL —
 * la salud se mide sobre lo que está pasando ahora, no sobre el promedio del año.
 *
 * Todo en ARS: la salud se mide en la moneda del día a día. Los movimientos en otras
 * monedas no entran a este puntaje (mezclarlos daría un número sin sentido); si algún día
 * hay uso fuerte de USD, tendrá su propia lectura.
 */
analysisRouter.get(
  "/health",
  ah(async (req, res) => {
    const userId = req.userId!;
    const now = new Date();
    const { start, end } = monthBounds(now.getFullYear(), now.getMonth());

    const [movements, debts, services, fx] = await Promise.all([
      prisma.movement.findMany({
        where: {
          userId,
          // Ya NO se filtra por moneda. Antes solo se miraban los ARS, así que un
          // servicio pagado en dólares quedaba INVISIBLE en los totales del mes: la
          // plata salía en la vida real y el balance no se enteraba. Ahora entran todas
          // las monedas y se convierten con la cotización del día (más abajo).
          date: { gte: start, lte: end },
          type: { in: ["INCOME", "EXPENSE"] },
        },
        include: { category: true },
      }),
      prisma.debt.findMany({ where: { userId, settled: false, kind: "OWE" } }),
      prisma.service.findMany({ where: { userId, active: true } }),
      currentRate(),
    ]);

    const rate = fx.rate;

    /**
     * Lleva un monto a pesos. Si ya es ARS lo devuelve tal cual; si es otra moneda usa la
     * cotización del día. Sin cotización devuelve null y ese movimiento NO se suma:
     * preferimos un total que avisa que está incompleto antes que uno con dólares
     * contados como si fueran pesos.
     */
    const toARS = (amount: number, currency: string | null): number | null => {
      const cur = currency || "ARS";
      if (cur === "ARS") return amount;
      if (cur === "USD" && rate !== null && rate > 0) return amount * rate;
      return null;
    };

    let income = 0;
    let expense = 0;
    /** Movimientos que no se pudieron convertir: se informan para no mentir con el total. */
    let unconverted = 0;
    const categorySpend: Record<string, number> = {};
    for (const m of movements) {
      const amt = toARS(Number(m.amount), m.currency);
      if (amt === null) {
        // Sin cotización para esa moneda: no se suma, pero se cuenta para avisar.
        unconverted++;
        continue;
      }
      if (m.type === "INCOME") income += amt;
      else {
        expense += amt;
        const cat = m.category?.name ?? "Sin categoría";
        categorySpend[cat] = (categorySpend[cat] ?? 0) + amt;
      }
    }

    // Deuda pendiente (solo lo que falta pagar), en ARS.
    const debtOutstanding = debts.reduce(
      (s, d) => s + Math.max(Number(d.amount) - Number(d.paid), 0),
      0
    );

    // Servicios mensuales comprometidos este mes, en ARS.
    const likes = services.map((s) => ({
      amount: Number(s.amount),
      frequency: s.frequency as Frequency,
      interval: s.interval,
      dueDay: s.dueDay ?? null,
      startDate: new Date(s.startDate),
      endDate: s.endDate ? new Date(s.endDate) : null,
      active: s.active,
      currency: s.currency,
    })) as (ServiceLike & { currency: string })[];
    const committed = committedByCurrency(likes, start, end);

    // Compromisos con TODAS las monedas convertidas a pesos con la cotización del día, y
    // con los anuales separados de los mensuales. Antes solo se contaban los servicios en
    // ARS, así que las suscripciones en dólares (que suelen ser varias) no pesaban nada en
    // la salud financiera — justo las que más cuesta seguir.
    const commitments = commitmentSummary(
      services.map((s) => ({
        name: s.name,
        amount: Number(s.amount),
        currency: s.currency,
        frequency: s.frequency as Frequency,
        interval: s.interval,
        active: s.active,
      })),
      rate,
      "ARS"
    );

    // Para la salud del mes se usa lo que se paga TODOS los meses. Los anuales van aparte:
    // sumarlos prorrateados haría parecer que hace falta esa plata cada mes, y no es así.
    const monthlyServices = commitments.monthly.converted ?? committed.ARS ?? 0;
    const serviceCount = commitments.monthly.count + commitments.annual.count;

    const health = computeHealth({
      income,
      expense,
      debtOutstanding,
      monthlyServices,
      serviceCount,
      categorySpend,
    });

    res.json({
      ...health,
      month: now.getMonth(),
      totals: { income, expense, saving: income - expense },
      // Con qué cotización se convirtieron los montos en otras monedas, y si quedó algo
      // sin convertir. La pantalla lo muestra para que el usuario sepa que el total
      // incluye sus dólares y a qué precio — no un número que aparece de la nada.
      fx: {
        rate,
        kind: fx.quote?.kind ?? null,
        stale: fx.stale,
        unconverted,
      },
      // Compromisos separados: lo que hace falta TODOS los meses vs. lo anual.
      commitments: {
        monthly: commitments.monthly,
        annual: commitments.annual,
        annualPerMonth: commitments.annualPerMonth,
      },
    });
  })
);
