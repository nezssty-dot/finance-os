import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { ah } from "../utils/asyncHandler";
import { currentRate, latestQuotes, rateHistory, refreshRates } from "../integrations/fx/service";
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

  const [current, all, history] = await Promise.all([
    currentRate(),
    latestQuotes(),
    rateHistory(kind, days),
  ]);

  res.json({
    rate: current.rate,
    quote: current.quote,
    stale: current.stale,
    quotes: all,
    history,
  });
}));

/** Refresco manual, por si el usuario quiere forzarlo. */
fxRouter.post("/refresh", ah(async (_req, res) => {
  const result = await refreshRates();
  res.json(result);
}));
