/**
 * Mercado Pago.
 *
 * ─── Todo verificado contra la referencia oficial ───
 *   OAuth2: /authorization → code → /oauth/token
 *   GET /v1/payments/search   (sort, criteria, range, begin_date, end_date, limit, offset)
 *   GET /users/{id}/mercadopago_account/balance
 *
 * LÍMITE DURO: payments/search solo devuelve los últimos 12 MESES. Está declarado en
 * capabilities.maxHistoryDays para que la UI no le mienta al usuario diciéndole que
 * importó "todo".
 */

import type {
  Provider, ProviderMeta, Credentials, Tokens, FetchResult, HealthReport, RawMovement,
} from "../../types";
import { ProviderError } from "../../types";
import { config } from "../../../config";
import { signOAuthState } from "../../../lib/jwt";
import { mapPaymentAll } from "./mapping";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface MpTokenResponse {
  access_token: string;
  refresh_token: string;
  user_id: number;
  expires_in: number;
  scope?: string;
}

function toTokens(d: MpTokenResponse, previous?: Tokens): Tokens {
  return {
    accessToken: d.access_token,
    refreshToken: d.refresh_token ?? previous?.refreshToken ?? null,
    expiresAt: d.expires_in ? new Date(Date.now() + d.expires_in * 1000) : null,
    scope: d.scope ?? previous?.scope ?? null,
    externalUser: d.user_id ? String(d.user_id) : (previous?.externalUser ?? null),
  };
}

async function tokenRequest(body: Record<string, string>): Promise<MpTokenResponse> {
  let resp: Response;
  try {
    resp = await fetch(config.mp.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ProviderError("No se pudo contactar a Mercado Pago.", "NETWORK", "MERCADO_PAGO");
  }
  if (!resp.ok)
    throw new ProviderError(
      "Mercado Pago rechazó la conexión. Volvé a autorizar la cuenta.",
      "RECONNECT",
      "MERCADO_PAGO"
    );
  return (await resp.json()) as MpTokenResponse;
}

/**
 * Toda llamada a Mercado Pago pasa por acá.
 *
 * Reintenta con backoff exponencial lo que vale la pena reintentar: un 429 o un 500
 * es un mal minuto de Mercado Pago, no una razón para abandonar la sync a la mitad y
 * dejar el libro incompleto.
 */
async function api(url: string, tokens: Tokens, attempt = 0): Promise<any> {
  const MAX = 4;

  let resp: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    resp = await fetch(url, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch {
    if (attempt >= MAX)
      throw new ProviderError("No se pudo contactar a Mercado Pago. Revisá tu conexión.", "NETWORK", "MERCADO_PAGO");
    await sleep(2 ** attempt * 500);
    return api(url, tokens, attempt + 1);
  }

  if (resp.ok) return resp.json();

  if (resp.status === 401)
    throw new ProviderError("El permiso de Mercado Pago venció.", "RECONNECT", "MERCADO_PAGO");
  if (resp.status === 403)
    throw new ProviderError("Tu cuenta de Mercado Pago no autorizó estos permisos.", "RECONNECT", "MERCADO_PAGO");

  if (resp.status === 429 || resp.status >= 500) {
    if (attempt >= MAX)
      throw new ProviderError(
        resp.status === 429
          ? "Mercado Pago está limitando las consultas. Probá en unos minutos."
          : "Mercado Pago está teniendo problemas. Probá más tarde.",
        resp.status === 429 ? "RATE_LIMIT" : "PROVIDER_DOWN",
        "MERCADO_PAGO"
      );
    const retryAfter = Number(resp.headers.get("retry-after"));
    await sleep(retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 800);
    return api(url, tokens, attempt + 1);
  }

  throw new ProviderError(`Mercado Pago respondió ${resp.status}.`, "UNKNOWN", "MERCADO_PAGO");
}

export class MercadoPagoProvider implements Provider {
  readonly meta: ProviderMeta = {
    id: "MERCADO_PAGO",
    label: "Mercado Pago",
    auth: "OAUTH2",
    capabilities: {
      movements: true,
      holdings: false,
      balance: true,
      // La API no devuelve nada anterior a 12 meses. No es una elección nuestra.
      maxHistoryDays: 365,
    },
  };

  authUrl(userId: string): string {
    const params = new URLSearchParams({
      client_id: config.mp.clientId,
      response_type: "code",
      platform_id: "mp",
      redirect_uri: config.mp.redirectUri,
      state: signOAuthState(userId),
    });
    return `${config.mp.authUrl}?${params.toString()}`;
  }

  async connect(creds: Credentials): Promise<Tokens> {
    if (creds.kind !== "OAUTH2")
      throw new ProviderError("Mercado Pago se conecta por OAuth.", "RECONNECT", "MERCADO_PAGO");

    const d = await tokenRequest({
      grant_type: "authorization_code",
      client_id: config.mp.clientId,
      client_secret: config.mp.clientSecret,
      code: creds.code,
      redirect_uri: config.mp.redirectUri,
    });
    return toTokens(d);
  }

  async refresh(tokens: Tokens): Promise<Tokens> {
    if (!tokens.refreshToken)
      throw new ProviderError("Se perdió el permiso de Mercado Pago. Reconectá.", "RECONNECT", "MERCADO_PAGO");

    const d = await tokenRequest({
      grant_type: "refresh_token",
      client_id: config.mp.clientId,
      client_secret: config.mp.clientSecret,
      refresh_token: tokens.refreshToken,
    });
    return toTokens(d, tokens);
  }

  async disconnect(): Promise<void> {
    // Mercado Pago no documenta revocación desde la API. El usuario la revoca desde
    // su cuenta; nosotros borramos los tokens.
  }

  async fetch(tokens: Tokens, since: Date): Promise<FetchResult> {
    const warnings: string[] = [];
    const own = tokens.externalUser ?? "";

    // La API no da nada anterior a 12 meses. Si el usuario pidió más, se lo decimos
    // en vez de dejarlo creer que importó su historia completa.
    const floor = new Date(Date.now() - 365 * 864e5);
    let from = since;
    if (since < floor) {
      from = floor;
      warnings.push(
        "Mercado Pago solo permite consultar los últimos 12 meses. Los movimientos anteriores a esa fecha no se pueden importar desde su API."
      );
    }

    const movements: RawMovement[] = [];
    let offset = 0;
    const LIMIT = 100;

    while (true) {
      const url = new URL(`${config.mp.apiBase}/v1/payments/search`);
      url.searchParams.set("sort", "date_created");
      url.searchParams.set("criteria", "desc");
      url.searchParams.set("range", "date_created");
      url.searchParams.set("begin_date", from.toISOString());
      url.searchParams.set("end_date", new Date().toISOString());
      url.searchParams.set("limit", String(LIMIT));
      url.searchParams.set("offset", String(offset));

      const data = await api(url.toString(), tokens);
      const results: any[] = data?.results ?? [];

      // Un solo pago puede producir varios movimientos: el pago, su comisión y su
      // devolución parcial. Cada uno con su propio id derivado, así re-sincronizar
      // nunca duplica.
      for (const p of results) movements.push(...mapPaymentAll(p, own));

      if (results.length < LIMIT) break;
      offset += LIMIT;
      if (offset >= 5000) {
        warnings.push("Se alcanzó el límite de 5000 pagos por sincronización. Sincronizá de nuevo para traer el resto.");
        break;
      }
    }

    let balance = null;
    if (own) {
      try {
        const d = await api(`${config.mp.apiBase}/users/${own}/mercadopago_account/balance`, tokens);
        const available = Number(d?.available_balance ?? d?.total_balance ?? d?.balance ?? NaN);
        if (!Number.isNaN(available)) balance = { available, currency: "ARS" };
      } catch {
        // El saldo es un extra para conciliar. Nunca puede tirar abajo una sync.
        warnings.push("No se pudo leer el saldo que reporta Mercado Pago. Los movimientos sí se importaron.");
      }
    }

    return { movements, holdings: [], balance, warnings };
  }

  async health(tokens: Tokens): Promise<HealthReport> {
    try {
      const url = new URL(`${config.mp.apiBase}/v1/payments/search`);
      url.searchParams.set("limit", "1");
      await api(url.toString(), tokens);
      return { ok: true, message: "Conectada a Mercado Pago.", checkedAt: new Date(), expiresAt: tokens.expiresAt };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof ProviderError ? e.message : "No se pudo verificar la conexión.",
        checkedAt: new Date(),
        expiresAt: tokens.expiresAt,
      };
    }
  }
}
