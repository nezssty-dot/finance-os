import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import path from "path";
import { config } from "./config";
import { errorHandler, notFound } from "./middleware/error";
import { apiLimiter } from "./middleware/rateLimiter";

import { authRouter } from "./modules/auth";
import { usersRouter } from "./modules/users";
import { accountsRouter } from "./modules/accounts";
import { categoriesRouter } from "./modules/categories";
import { movementsRouter } from "./modules/movements";
import { investmentsRouter } from "./modules/investments";
import { goalsRouter } from "./modules/goals";
import { debtsRouter } from "./modules/debts";
import { budgetsRouter } from "./modules/budgets";
import { analysisRouter } from "./modules/analysis";
import { fxRouter } from "./modules/fx";
import { auditRouter } from "./modules/audit";
import { integrationsRouter } from "./modules/integrations";
import { timelineRouter } from "./modules/timeline";
import { patrimonioRouter } from "./modules/patrimonio";
import { forecastRouter } from "./modules/forecast";
import { reportsRouter } from "./modules/reports";
import { servicesRouter } from "./modules/services";

export interface AppOptions {
  /**
   * When set, the built React app in this directory is served by Express and
   * every non-/api route falls back to index.html (SPA routing).
   * Used by the packaged desktop app, where renderer and API share one origin.
   */
  staticDir?: string;
}

export function createApp(options: AppOptions = {}) {
  const app = express();

  // In desktop mode the renderer is served from this same origin over
  // http://127.0.0.1, so the default CSP would block the bundled assets/fonts.
  app.use(
    helmet({
      contentSecurityPolicy: options.staticDir ? false : undefined,
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(cors({ origin: config.webOrigin, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use(morgan("dev"));
  app.use("/api", apiLimiter);

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/accounts", accountsRouter);
  app.use("/api/categories", categoriesRouter);
  app.use("/api/movements", movementsRouter);
  app.use("/api/investments", investmentsRouter);
  app.use("/api/goals", goalsRouter);
  app.use("/api/debts", debtsRouter);
  app.use("/api/budgets", budgetsRouter);
  app.use("/api/analysis", analysisRouter);
  app.use("/api/fx", fxRouter);
  app.use("/api/audit", auditRouter);
  app.use("/api/integrations", integrationsRouter);
  app.use("/api/timeline", timelineRouter);
  app.use("/api/patrimonio", patrimonioRouter);
  app.use("/api/forecast", forecastRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/services", servicesRouter);

  // Static renderer + SPA fallback. Must be registered BEFORE notFound,
  // otherwise the 404 handler would swallow every page request.
  if (options.staticDir) {
    const dir = options.staticDir;
    app.use(express.static(dir));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(dir, "index.html"));
    });
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
