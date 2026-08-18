import dotenv from "dotenv";
dotenv.config();

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var: ${name}`);
  return v;
}

const isProd = process.env.NODE_ENV === "production";

// FIX S6: Fail hard if production secrets are defaults
const accessSecret = req("JWT_ACCESS_SECRET", "dev-access");
const refreshSecret = req("JWT_REFRESH_SECRET", "dev-refresh");
const stateSecret = req("JWT_STATE_SECRET", "dev-state");
if (isProd) {
  const DANGEROUS = ["dev-access", "dev-refresh", "dev-state"];
  if ([accessSecret, refreshSecret, stateSecret].some((s) => DANGEROUS.includes(s))) {
    throw new Error(
      "FATAL: JWT secrets must be changed from defaults in production. " +
        "Set JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, JWT_STATE_SECRET to secure random strings."
    );
  }
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  jwt: {
    accessSecret,
    refreshSecret,
    stateSecret,
    accessTtl: process.env.ACCESS_TOKEN_TTL ?? "15m",
    refreshTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
  },
  mp: {
    clientId: process.env.MP_CLIENT_ID ?? "",
    clientSecret: process.env.MP_CLIENT_SECRET ?? "",
    redirectUri:
      process.env.MP_REDIRECT_URI ??
      "http://localhost:4000/api/integrations/mercadopago/callback",
    authUrl: "https://auth.mercadopago.com.ar/authorization",
    tokenUrl: "https://api.mercadopago.com/oauth/token",
    apiBase: "https://api.mercadopago.com",
  },
  // The desktop app serves over http://127.0.0.1, where `secure` cookies are
  // never sent by the browser. Electron sets COOKIE_SECURE=false explicitly.
  cookieSecure: process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === "true"
    : isProd,
  isProd,
};
