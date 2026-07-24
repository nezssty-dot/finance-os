/**
 * Invertir Online.
 *
 * ─── Todo lo de acá sale de la documentación oficial. Nada inventado. ───
 *
 *   POST https://api.invertironline.com/token
 *        Content-Type: application/x-www-form-urlencoded
 *        grant_type=password&username=...&password=...
 *        → bearer token (VÁLIDO 15 MINUTOS) + refresh_token
 *
 *   POST /token  grant_type=refresh_token&refresh_token=...
 *   GET  /api/v2/estadocuenta
 *   GET  /api/v2/portafolio/{pais}
 *   GET  /api/v2/operaciones?fechaDesde=&fechaHasta=&estado=
 *
 * ─── DOS COSAS QUE HAY QUE ENTENDER ANTES DE USAR ESTO ───
 *
 * 1. IOL NO TIENE OAUTH. Usa usuario y contraseña. Por eso la contraseña se pide una
 *    sola vez, se cambia por tokens, y NUNCA se guarda. Solo persisten los tokens,
 *    cifrados con AES-256-GCM.
 *
 * 2. EL TOKEN DE IOL PUEDE OPERAR. La misma credencial que lee tu cartera puede
 *    comprar y vender. Finance OS es de SOLO LECTURA — no hay una sola llamada a
 *    /operar/Comprar ni /operar/Vender en este archivo ni en ningún otro, y no la
 *    va a haber. Pero el usuario tiene que saber qué está entregando, así que la UI
 *    se lo dice antes de conectar.
 *
 * 3. La API hay que ACTIVARLA a mano: pedirla por mensaje desde el sitio de IOL y
 *    aceptar los términos en Mi Cuenta > Personalización > APIs. Sin eso, /token
 *    responde error y no hay forma de saltearlo desde acá.
 */

import type {
  Provider,
  ProviderMeta,
  Credentials,
  Tokens,
  FetchResult,
  HealthReport,
} from "../../types";
import { ProviderError } from "../../types";
import { mapPortfolio, mapAccountStatus } from "./mapping";

const BASE = process.env.IOL_API_BASE ?? "https://api.invertironline.com";

/** El bearer dura 15 minutos. Lo renovamos antes, para no correr una carrera. */
const REFRESH_MARGIN_MS = 2 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  ".expires"?: string;
  token_type?: string;
}

function toTokens(data: TokenResponse, previous?: Tokens): Tokens {
  const expiresAt = data[".expires"]
    ? new Date(data[".expires"])
    : data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : new Date(Date.now() + 15 * 60 * 1000); // el default documentado

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? previous?.refreshToken ?? null,
    expiresAt,
    scope: null,
    externalUser: previous?.externalUser ?? null,
  };
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  let resp: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    resp = await fetch(`${BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch {
    throw new ProviderError("No se pudo contactar a IOL. Revisá tu conexión.", "NETWORK", "IOL");
  }

  if (resp.status === 400 || resp.status === 401) {
    // IOL devuelve 400 tanto para credenciales mal como para API no habilitada.
    // No podemos distinguirlas con certeza, así que decimos las dos posibilidades
    // en vez de mandar al usuario a cambiar una contraseña que estaba bien.
    throw new ProviderError(
      "IOL rechazó las credenciales. Verificá usuario y contraseña, y que tengas el servicio de API habilitado (Mi Cuenta > Personalización > APIs).",
      "RECONNECT",
      "IOL"
    );
  }
  if (resp.status === 429)
    throw new ProviderError("IOL está limitando las consultas. Probá en unos minutos.", "RATE_LIMIT", "IOL");
  if (resp.status >= 500)
    throw new ProviderError("IOL está teniendo problemas. Probá más tarde.", "PROVIDER_DOWN", "IOL");
  if (!resp.ok) throw new ProviderError(`IOL respondió ${resp.status}.`, "UNKNOWN", "IOL");

  return (await resp.json()) as TokenResponse;
}

/** Toda llamada a la API de IOL pasa por acá: reintentos con backoff. */
async function api(path: string, tokens: Tokens, attempt = 0): Promise<any> {
  const MAX = 3;

  let resp: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    resp = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch {
    if (attempt >= MAX)
      throw new ProviderError("No se pudo contactar a IOL. Revisá tu conexión.", "NETWORK", "IOL");
    await sleep(2 ** attempt * 600);
    return api(path, tokens, attempt + 1);
  }

  if (resp.ok) return resp.json();

  if (resp.status === 401)
    // El manager renueva y reintenta. Acá solo lo señalamos.
    throw new ProviderError("El token de IOL venció.", "RECONNECT", "IOL");

  if (resp.status === 403)
    throw new ProviderError(
      "Tu cuenta de IOL no tiene la API habilitada. Pedila desde el sitio (Mi Cuenta > Personalización > APIs).",
      "NOT_ENABLED",
      "IOL"
    );

  if (resp.status === 429 || resp.status >= 500) {
    if (attempt >= MAX)
      throw new ProviderError(
        resp.status === 429
          ? "IOL está limitando las consultas. Probá en unos minutos."
          : "IOL está teniendo problemas. Probá más tarde.",
        resp.status === 429 ? "RATE_LIMIT" : "PROVIDER_DOWN",
        "IOL"
      );
    await sleep(2 ** attempt * 800);
    return api(path, tokens, attempt + 1);
  }

  throw new ProviderError(`IOL respondió ${resp.status}.`, "UNKNOWN", "IOL");
}

export class IolProvider implements Provider {
  readonly meta: ProviderMeta = {
    id: "IOL",
    label: "Invertir Online",
    auth: "PASSWORD_GRANT",
    capabilities: {
      // La API expone /operaciones, pero son órdenes de bolsa (compra/venta de
      // títulos), no movimientos de caja. Meterlas como ingresos y gastos rompería
      // el patrimonio: comprar una acción no es un gasto, es cambiar plata por otro
      // activo. La cartera ya refleja eso, así que los movimientos van en false.
      movements: false,
      holdings: true,
      balance: true,
      maxHistoryDays: null,
    },
    warning:
      "IOL no ofrece OAuth: hay que ingresar tu usuario y contraseña. Se usan una sola vez para obtener un token y NO se guardan. Importante: el token que entrega IOL permite operar (comprar y vender). Finance OS es de solo lectura y nunca va a operar — pero el permiso que estás dando es amplio.",
  };

  authUrl(): string | null {
    return null; // no hay a dónde redirigir: IOL no tiene OAuth
  }

  async connect(creds: Credentials): Promise<Tokens> {
    if (creds.kind !== "PASSWORD_GRANT")
      throw new ProviderError("IOL necesita usuario y contraseña.", "RECONNECT", "IOL");

    const body = new URLSearchParams({
      grant_type: "password",
      username: creds.username,
      password: creds.password,
    });

    const data = await tokenRequest(body);
    // A partir de acá la contraseña deja de existir para nosotros. No se guarda, no
    // se loguea, no vuelve a usarse.
    return { ...toTokens(data), externalUser: creds.username };
  }

  async refresh(tokens: Tokens): Promise<Tokens> {
    if (!tokens.refreshToken)
      throw new ProviderError("Se perdió la sesión de IOL. Volvé a conectar.", "RECONNECT", "IOL");

    const data = await tokenRequest(
      new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refreshToken })
    );
    return toTokens(data, tokens);
  }

  async disconnect(): Promise<void> {
    // IOL no documenta un endpoint de revocación. Borramos los tokens de nuestro
    // lado, que es todo lo que podemos hacer honestamente.
  }

  /** ¿Hay que renovar antes de usarlo? El manager lo consulta. */
  static needsRefresh(tokens: Tokens): boolean {
    if (!tokens.expiresAt) return false;
    return tokens.expiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS;
  }

  async fetch(tokens: Tokens): Promise<FetchResult> {
    const warnings: string[] = [];

    const [portfolio, account] = await Promise.all([
      api("/api/v2/portafolio/argentina", tokens),
      api("/api/v2/estadocuenta", tokens),
    ]);

    const holdings = mapPortfolio(portfolio);
    const { balance, warnings: balanceWarnings } = mapAccountStatus(account);
    warnings.push(...balanceWarnings);

    // IOL tiene un portafolio separado para Estados Unidos. Lo intentamos, pero si
    // la cuenta no lo tiene habilitado no es un error: es que no lo usa.
    try {
      const usa = await api("/api/v2/portafolio/estados_Unidos", tokens);
      const usHoldings = mapPortfolio(usa);
      if (usHoldings.length) holdings.push(...usHoldings);
    } catch {
      // sin cartera en Estados Unidos, o sin permiso. No es un fallo de la sync.
    }

    if (!holdings.length)
      warnings.push("IOL no devolvió posiciones. Si tenés cartera, revisá que la API esté habilitada en tu cuenta.");

    return { movements: [], holdings, balance, warnings };
  }

  async health(tokens: Tokens): Promise<HealthReport> {
    try {
      await api("/api/v2/estadocuenta", tokens);
      return {
        ok: true,
        message: "Conectada a IOL.",
        checkedAt: new Date(),
        expiresAt: tokens.expiresAt,
      };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof ProviderError ? e.message : "No se pudo verificar la conexión con IOL.",
        checkedAt: new Date(),
        expiresAt: tokens.expiresAt,
      };
    }
  }
}
