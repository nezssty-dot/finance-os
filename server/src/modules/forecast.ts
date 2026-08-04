import { Router } from "express";
import { prisma } from "../lib/prisma";
import { patrimonio } from "../lib/finance";
import { requireAuth } from "../middleware/auth";
import { ah } from "../utils/asyncHandler";
import { committedInRange, monthBounds, type ServiceLike, type Frequency } from "../lib/services-math";

export const forecastRouter = Router();
forecastRouter.use(requireAuth);

// GET /api/forecast?year=2026
// Projects income, expense, savings, and patrimonio for remaining months
// based on the user's actual historical data (weighted moving average).
forecastRouter.get(
  "/",
  ah(async (req, res) => {
    const userId = req.userId!;
    const year = Number(req.query.year ?? new Date().getFullYear());

    const movements = await prisma.movement.findMany({
      where: {
        userId,
        date: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) },
        type: { in: ["INCOME", "EXPENSE"] },
      },
      select: { date: true, type: true, amount: true },
    });

    // Build monthly actuals
    const byMonth: Record<number, { inc: number; exp: number }> = {};
    for (const m of movements) {
      const mo = new Date(m.date).getMonth();
      byMonth[mo] ??= { inc: 0, exp: 0 };
      const amt = Number(m.amount);
      if (m.type === "INCOME") byMonth[mo].inc += amt;
      else byMonth[mo].exp += amt;
    }

    const activeMonths = Object.keys(byMonth).map(Number).sort((a, b) => a - b);
    if (activeMonths.length < 2) {
      return res.json({ year, message: "Se necesitan al menos 2 meses de datos para proyectar.", forecast: [] });
    }

    // Weighted moving average (recent months weigh more)
    const incomes = activeMonths.map(mo => byMonth[mo].inc);
    const expenses = activeMonths.map(mo => byMonth[mo].exp);

    function weightedAvg(values: number[]): number {
      let sum = 0, wSum = 0;
      values.forEach((v, i) => {
        const w = i + 1; // More recent = higher weight
        sum += v * w;
        wSum += w;
      });
      return sum / wSum;
    }

    const avgInc = weightedAvg(incomes);
    const avgExp = weightedAvg(expenses);
    const avgSaving = avgInc - avgExp;

    // ─── Servicios como gasto CONOCIDO ───
    // El forecast adivina el gasto por promedio. Pero los servicios (Spotify, alquiler,
    // Monotributo) no hay que adivinarlos: son montos y fechas que ya conocemos. Para
    // cada mes proyectado calculamos cuánto se compromete en servicios y lo usamos como
    // PISO del gasto: si el promedio histórico ya los supera, no se suman dos veces; si
    // el promedio se quedó corto, el gasto conocido manda. Solo ARS por ahora — mezclar
    // monedas en una sola línea de proyección no tendría sentido.
    const activeServices = await prisma.service.findMany({
      where: { userId, active: true, currency: "ARS" },
    });
    const serviceLikes: ServiceLike[] = activeServices.map((s) => ({
      amount: Number(s.amount),
      frequency: s.frequency as Frequency,
      interval: s.interval,
      dueDay: s.dueDay ?? null,
      startDate: new Date(s.startDate),
      endDate: s.endDate ? new Date(s.endDate) : null,
      active: s.active,
    }));
    const committedInMonth = (mo: number): number => {
      const { start, end } = monthBounds(year, mo);
      return serviceLikes.reduce((sum, s) => sum + committedInRange(s, start, end), 0);
    };

    // Current cumulative (actual)
    let actualCum = 0;
    activeMonths.forEach(mo => {
      actualCum += byMonth[mo].inc - byMonth[mo].exp;
    });

    // Build forecast for all 12 months
    const forecast = [];
    let runningCum = 0;
    for (let mo = 0; mo < 12; mo++) {
      const actual = byMonth[mo];
      if (actual) {
        runningCum += actual.inc - actual.exp;
        forecast.push({
          month: mo,
          type: "actual" as const,
          income: actual.inc,
          expense: actual.exp,
          saving: actual.inc - actual.exp,
          cumulative: runningCum,
        });
      } else if (mo > activeMonths[activeMonths.length - 1]) {
        // Gasto proyectado = el mayor entre el promedio histórico y lo ya comprometido
        // en servicios ese mes. Así el forecast nunca proyecta menos gasto del que ya
        // sabemos que hay sí o sí.
        const committed = committedInMonth(mo);
        const projectedExp = Math.max(avgExp, committed);
        const projectedSaving = avgInc - projectedExp;
        runningCum += projectedSaving;
        forecast.push({
          month: mo,
          type: "projected" as const,
          income: Math.round(avgInc),
          expense: Math.round(projectedExp),
          committed: Math.round(committed), // cuánto de ese gasto es servicios conocidos
          saving: Math.round(projectedSaving),
          cumulative: Math.round(runningCum),
        });
      }
    }

    // Year-end projection
    const yearEndSaving = forecast[forecast.length - 1]?.cumulative ?? actualCum;

    // Same engine as everywhere else, so the projection starts from a true number.
    const currentPatrimonio = (await patrimonio(userId)).neto;

    const remaining = 11 - activeMonths[activeMonths.length - 1];
    const patrimonioProjected = currentPatrimonio + avgSaving * remaining;

    res.json({
      year,
      averages: {
        income: Math.round(avgInc),
        expense: Math.round(avgExp),
        saving: Math.round(avgSaving),
      },
      forecast,
      projections: {
        yearEndSaving: Math.round(yearEndSaving),
        currentPatrimonio: Math.round(currentPatrimonio),
        projectedPatrimonio: Math.round(patrimonioProjected),
        remainingMonths: remaining,
      },
    });
  })
);
