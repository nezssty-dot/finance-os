import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { ah } from "../utils/asyncHandler";
import { currentRate, latestQuotes, rateHistory, refreshRates, refreshExtraRatesIfStale } from "../integrations/fx/service";
import { prisma } from "../lib/prisma";
import type { FxKind } from "../lib/fx";

export const fxRouter = Router();
fxRouter.use(requireAuth);

/**
 * Cotización actual + todas las disponibles + historial para el gráfico.
 *
 * Si no hay cotización (sin internet la primera vez), devuelve rate:null en vez de un
 * número inventado, y la pantalla muestra los montos en su moneda original.
 */
fxRouter.get("/", ah(async (req, res) => {
  const kind = (String(req.query.kind ?? "MEP").toUpperCase() as FxKind) || "MEP";
  const days = Math.min(Number(req.query.days) || 90, 365);

  await refreshExtraRatesIfStale();

  const [current, all, history] = await Promise.all([
    currentRate(),
    latestQuotes(),
    rateHistory(kind, days),
  ]);

  // % contra el día anterior guardado, por tipo — nunca inventado: si no hay una fila
  // previa para ese tipo, va sin cambio (null) en vez de mostrar un 0% que parece dato.
  const withChange = await Promise.all(
    all.map(async (q) => {
      const prev = await prisma.fxRate.findFirst({
        where: { kind: q.kind, date: { lt: q.date } },
        orderBy: { date: "desc" },
      });
      const prevRate = prev ? Number(prev.sell ?? prev.buy ?? 0) || null : null;
      const curRate = q.sell ?? q.buy;
      const changePct =
        prevRate && curRate ? Math.round(((curRate - prevRate) / prevRate) * 1000) / 10 : null;
      return { ...q, changePct };
    })
  );

  res.json({
    rate: current.rate,
    quote: current.quote,
    stale: current.stale,
    quotes: withChange,
    history,
  });
}));

/** Refresco manual, por si el usuario quiere forzarlo. */
fxRouter.post("/refresh", ah(async (_req, res) => {
  const result = await refreshRates();
  res.json(result);
}));
