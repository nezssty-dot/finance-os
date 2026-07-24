import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { accountBalances } from "../lib/finance";
import { requireAuth } from "../middleware/auth";
import { ah } from "../utils/asyncHandler";
import { HttpError } from "../middleware/error";
import { config } from "../config";
import { verifyOAuthState } from "../lib/jwt";
import { IntegrationManager, recentLogs, ProviderError } from "../integrations";
import { analyze, commitImport } from "../integrations/import";
import { suggestCategories } from "./classification";

export const integrationsRouter = Router();

/** Traduce un error de proveedor al código HTTP que le corresponde. */
function toHttp(err: unknown): never {
  if (err instanceof ProviderError) {
    const status =
      err.kind === "RECONNECT" ? 409
      : err.kind === "NOT_ENABLED" ? 403
      : err.kind === "RATE_LIMIT" || err.kind === "PROVIDER_DOWN" ? 503
      : err.kind === "NETWORK" ? 502
      : 500;
    throw new HttpError(status, err.message);
  }
  throw err;
}

/** El catálogo: qué proveedores existen, qué traen y qué advertencia mostrar. */
integrationsRouter.get("/catalog", requireAuth, ah(async (_req, res) => {
  res.json(IntegrationManager.catalog());
}));

integrationsRouter.get("/", requireAuth, ah(async (req, res) => {
  const integrations = await IntegrationManager.list(req.userId!);

  // Conciliación: lo que el proveedor dice que tenés contra lo que derivamos de los
  // movimientos. Si no coinciden, falta importar algo — y un total silenciosamente
  // equivocado es lo peor que puede hacer una app de finanzas.
  const accounts = await accountBalances(req.userId!);
  const reconciliation = integrations
    .filter((i) => i.reportedBalance !== null && i.reportedBalance !== undefined)
    .map((i) => {
      const acc = accounts.find((a) => a.provider === i.provider.toLowerCase());
      if (!acc) return null;
      const diff = acc.balance - i.reportedBalance!;
      return {
        provider: i.provider,
        reported: i.reportedBalance!,
        derived: acc.balance,
        diff,
        matches: Math.abs(diff) < 1, // redondeos de los dos lados; menos de un peso es ruido
        at: i.balanceAt,
      };
    })
    .filter(Boolean);

  res.json({ integrations, reconciliation });
}));

/**
 * POST /api/integrations/sync-all
 * Sincroniza TODAS las cuentas conectadas de una, y devuelve un resumen por proveedor.
 *
 * Es lo que dispara el "Sincronizando..." al abrir la app. Se hace acá, en un endpoint que
 * el front llama al montar, y NO atado al arranque de Electron a propósito: una sync lenta
 * o colgada no puede impedir que la app abra. Si un proveedor falla, los demás siguen — su
 * error queda en su propia línea del resumen, no tumba la tanda entera.
 *
 * Cada IntegrationManager.sync() ya es idempotente y deduplica: sincronizar de más nunca
 * duplica un movimiento. Por eso es seguro llamarlo en cada apertura.
 */
integrationsRouter.post("/sync-all", requireAuth, ah(async (req, res) => {
  const integrations = await IntegrationManager.list(req.userId!);
  // Solo las que están realmente conectadas. Una CONNECTED o EXPIRED se intenta; una que
  // nunca se conectó no.
  const active = integrations.filter((i) => i.status === "CONNECTED" || i.status === "EXPIRED");

  const results = [];
  for (const integ of active) {
    const label = integ.meta?.label ?? integ.provider;
    try {
      const outcome = await IntegrationManager.sync(req.userId!, integ.provider);
      const changed = outcome.imported + outcome.updated;
      results.push({
        provider: integ.provider,
        label,
        ok: true,
        imported: outcome.imported,
        updated: outcome.updated,
        holdings: outcome.holdings,
        // Texto listo para mostrar, en el mismo tono del mockup que pediste.
        summary:
          changed > 0
            ? `${changed} ${changed === 1 ? "movimiento nuevo" : "movimientos nuevos"}`
            : outcome.holdings > 0
              ? `${outcome.holdings} tenencias actualizadas`
              : "Sin cambios",
        warnings: outcome.warnings,
      });
    } catch (err) {
      // El error de un proveedor no frena a los demás. Queda en su línea.
      results.push({
        provider: integ.provider,
        label,
        ok: false,
        summary: "No se pudo sincronizar",
        error: (err as Error).message,
      });
    }
  }

  res.json({ synced: results.length, results });
}));

// ─── Historial ───

integrationsRouter.get("/logs", requireAuth, ah(async (req, res) => {
  res.json(await recentLogs(req.userId!, Number(req.query.limit ?? 30)));
}));

// ─── Cartera ───

integrationsRouter.get("/holdings", requireAuth, ah(async (req, res) => {
  const holdings = await prisma.holding.findMany({
    where: { userId: req.userId },
    orderBy: { totalValue: "desc" },
  });

  const total = holdings.reduce((s, h) => s + h.totalValue, 0);
  const gain = holdings.reduce((s, h) => s + h.gainAmount, 0);
  const invested = total - gain;

  const byKind: Record<string, number> = {};
  for (const h of holdings) byKind[h.kind] = (byKind[h.kind] ?? 0) + h.totalValue;

  res.json({
    holdings,
    totals: {
      value: total,
      gain,
      invested,
      gainPct: invested > 0 ? Math.round((gain / invested) * 100) : 0,
    },
    byKind,
  });
}));

// ─── Importador de extractos ───
//
// Ningún banco argentino expone una API pública para que una persona lea su propia
// cuenta: Argentina no tiene Open Banking. Las APIs que existen ("Open Galicia", el
// ApiBank de BIND) son para EMPRESAS. Escribir un "conector Banco Galicia" sería
// inventar una API que no existe, o scrapear el home banking.
//
// Todos los bancos SÍ dejan exportar el extracto. Así que esto no es un plan B: es
// LA integración bancaria, y funciona con cualquier banco, incluidos los que todavía
// no existen.

/** Previsualizar: el usuario ve exactamente qué se va a importar ANTES de escribir nada. */
integrationsRouter.post("/import/preview", requireAuth, ah(async (req, res) => {
  const { text, mapping } = z.object({
    text: z.string().min(1).max(5_000_000),
    mapping: z.any().optional(),
  }).parse(req.body);

  const preview = analyze(text, mapping);
  // Solo las primeras 50 para la vista previa: mandar 5000 filas al navegador para
  // que muestre 10 es desperdiciar el ancho de banda del usuario. Por lo mismo, la
  // categoría se sugiere solo para estas 50 — no para las que nunca se van a ver.
  const shown = preview.rows.slice(0, 50);

  // Categoría sugerida: reglas del usuario (ClassificationRule), NO IA. Es la misma
  // sugerencia que hoy se calculaba recién al importar (ver commitImport) — acá se
  // adelanta a la vista previa para que el usuario la vea ANTES de guardar, como
  // todo lo demás en esta pantalla.
  const categoryIds = await suggestCategories(req.userId!, shown.map((r) => r.description));
  const uniqueIds = [...new Set(categoryIds.filter((id): id is string => !!id))];

  type Cat = { id: string; name: string; color: string };
  const categories: Cat[] = uniqueIds.length
    ? await prisma.category.findMany({
        where: { userId: req.userId!, id: { in: uniqueIds } },
        select: { id: true, name: true, color: true },
      })
    : [];
  const categoryById = new Map<string, Cat>(categories.map((c) => [c.id, c]));

  const rows = shown.map((row, i) => {
    const id = categoryIds[i];
    return { ...row, category: id ? categoryById.get(id) ?? null : null };
  });

  res.json({
    mapping: preview.mapping,
    rows,
    total: preview.rows.length,
    rejected: preview.rejected.slice(0, 20),
    rejectedTotal: preview.rejected.length,
    totalIncome: preview.totalIncome,
    totalExpense: preview.totalExpense,
    // Qué entendió el detector: columnas reconocidas y, si algo no cierra, por qué.
    // Es lo que evita el "no se reconoció nada" sin explicación.
    diagnostics: preview.diagnostics,
  });
}));

integrationsRouter.post("/import/commit", requireAuth, ah(async (req, res) => {
  const { text, accountId, mapping } = z.object({
    text: z.string().min(1).max(5_000_000),
    accountId: z.string().min(1),
    mapping: z.any().optional(),
  }).parse(req.body);

  const account = await prisma.account.findFirst({ where: { id: accountId, userId: req.userId } });
  if (!account) throw new HttpError(404, "Cuenta no encontrada");

  res.json(await commitImport(req.userId!, accountId, text, mapping));
}));

// ─── Conectar ───

integrationsRouter.get("/:provider/connect", requireAuth, ah(async (req, res) => {
  try {
    // Antes de nada: si es Mercado Pago, verificar que esté configurado y decir
    // EXACTAMENTE qué falta. El mensaje genérico "no está configurado" no le servía a
    // nadie — con esto, el usuario sabe qué variable de entorno poner.
    if (req.params.provider === "MERCADO_PAGO") {
      const missing: string[] = [];
      if (!config.mp.clientId) missing.push("MP_CLIENT_ID");
      if (!config.mp.clientSecret) missing.push("MP_CLIENT_SECRET");
      if (missing.length) {
        throw new HttpError(
          503,
          `Mercado Pago no está configurado: falta ${missing.join(" y ")} en las variables de entorno del servidor. ` +
            `Creá una aplicación en Mercado Pago Developers (https://www.mercadopago.com.ar/developers), ` +
            `y cargá esas credenciales. La URL de redirección (Redirect URI) que tenés que registrar en la app es: ${config.mp.redirectUri}`
        );
      }
    }

    const url = IntegrationManager.authUrl(req.userId!, req.params.provider);
    if (!url)
      throw new HttpError(400, "Este proveedor no usa OAuth: conectalo con usuario y contraseña.");
    res.json({ url });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    toHttp(e);
  }
}));

/**
 * Conexión con usuario y contraseña (IOL).
 *
 * La contraseña llega, se cambia por tokens, y muere acá. No se guarda, no se loguea,
 * no se devuelve. Es lo único que hace este endpoint aceptable.
 */
integrationsRouter.post("/:provider/connect", requireAuth, ah(async (req, res) => {
  const { username, password } = z
    .object({ username: z.string().min(1), password: z.string().min(1) })
    .parse(req.body);

  try {
    await IntegrationManager.connect(req.userId!, req.params.provider, {
      kind: "PASSWORD_GRANT",
      username,
      password,
    });
    res.json({ ok: true });
  } catch (e) {
    toHttp(e);
  }
}));

// OAuth callback (Mercado Pago)
integrationsRouter.get("/mercadopago/callback", ah(async (req, res) => {
  const { code, state } = req.query as Record<string, string>;
  if (!code || !state) throw new HttpError(400, "Callback inválido");

  let userId: string;
  try {
    userId = verifyOAuthState(state).sub;
  } catch {
    throw new HttpError(400, "State inválido o vencido");
  }

  try {
    await IntegrationManager.connect(userId, "MERCADO_PAGO", { kind: "OAUTH2", code, state });
  } catch (e) {
    const msg = e instanceof ProviderError ? e.message : "No se pudo conectar";
    return res.redirect(`${config.webOrigin}/integraciones?error=${encodeURIComponent(msg)}`);
  }

  res.redirect(`${config.webOrigin}/integraciones?connected=MERCADO_PAGO`);
}));

// ─── Operar ───

integrationsRouter.post("/:provider/sync", requireAuth, ah(async (req, res) => {
  try {
    res.json(await IntegrationManager.sync(req.userId!, req.params.provider));
  } catch (e) {
    toHttp(e);
  }
}));

integrationsRouter.get("/:provider/health", requireAuth, ah(async (req, res) => {
  res.json(await IntegrationManager.health(req.userId!, req.params.provider));
}));

integrationsRouter.patch("/:provider/schedule", requireAuth, ah(async (req, res) => {
  const { minutes } = z.object({ minutes: z.number().int() }).parse(req.body);
  try {
    await IntegrationManager.setSchedule(req.userId!, req.params.provider, minutes);
    res.json({ ok: true });
  } catch (e) {
    toHttp(e);
  }
}));

integrationsRouter.patch("/:provider", requireAuth, ah(async (req, res) => {
  const { importFrom } = z.object({ importFrom: z.coerce.date() }).parse(req.body);
  const row = await prisma.integration.update({
    where: { userId_provider: { userId: req.userId!, provider: req.params.provider } },
    data: { importFrom },
    select: { importFrom: true },
  });
  res.json(row);
}));

integrationsRouter.delete("/:provider", requireAuth, ah(async (req, res) => {
  try {
    await IntegrationManager.disconnect(req.userId!, req.params.provider);
    res.json({ ok: true });
  } catch (e) {
    toHttp(e);
  }
}));

