import { prisma } from "../../lib/prisma";
import { parseQuotes, pickQuote, rateOf, isStale, type FxKind, type FxQuote } from "../../lib/fx";

/**
 * Trae y guarda la cotización del dólar.
 *
 * ─── NO ES UNA INTEGRACIÓN CON LOGIN ───
 *
 * A diferencia de IOL o Mercado Pago, acá no hay usuario, contraseña, OAuth ni token: el
 * dólar es un precio PÚBLICO. Se consulta una fuente abierta y se guarda. Por eso no está
 * en providers/ ni aparece en la pantalla de Integraciones como algo "a conectar".
 *
 * ─── FUENTES CON RESPALDO ───
 *
 * Se prueban en orden. Si la primera no responde o cambia el formato, se pasa a la
 * siguiente. Agregar o cambiar una fuente es tocar SOLO este array — la lógica de parseo,
 * elección y valuación vive en lib/fx.ts (pura y testeada).
 */
const SOURCES: { name: string; url: string }[] = [
  { name: "dolarapi", url: "https://dolarapi.com/v1/dolares" },
  { name: "criptoya", url: "https://criptoya.com/api/dolar" },
];

/** Medianoche de hoy: la clave del día para no duplicar filas. */
function today(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export interface RefreshResult {
  ok: boolean;
  saved: number;
  source?: string;
  error?: string;
}

/**
 * Consulta la fuente y guarda las cotizaciones del día. Nunca tira: si todas las fuentes
 * fallan (sin internet, API caída), devuelve ok:false y la app sigue andando con la
 * última cotización guardada — o sin ninguna, mostrando los montos en su moneda.
 */
export async function refreshRates(now = new Date()): Promise<RefreshResult> {
  const errors: string[] = [];

  for (const src of SOURCES) {
    try {
      const resp = await fetch(src.url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) {
        errors.push(`${src.name}: HTTP ${resp.status}`);
        continue;
      }

      const quotes = parseQuotes(await resp.json(), src.name);
      if (!quotes.length) {
        errors.push(`${src.name}: respuesta sin cotizaciones reconocibles`);
        continue;
      }

      const date = today(now);
      let saved = 0;
      for (const q of quotes) {
        await prisma.fxRate.upsert({
          where: { kind_date: { kind: q.kind, date } },
          update: { buy: q.buy, sell: q.sell, source: q.source, fetchedAt: now },
          create: { kind: q.kind, date, buy: q.buy, sell: q.sell, source: q.source, fetchedAt: now },
        });
        saved++;
      }

      console.log(`[fx] ${src.name}: ${saved} cotizaciones guardadas (${quotes.map((q) => q.kind).join(", ")})`);
      return { ok: true, saved, source: src.name };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error desconocido";
      errors.push(`${src.name}: ${msg}`);
    }
  }

  const error = errors.join(" · ");
  console.log(`[fx] no se pudo actualizar la cotización — ${error}`);
  return { ok: false, saved: 0, error };
}

/** Las cotizaciones más recientes guardadas, una por tipo. */
export async function latestQuotes(): Promise<FxQuote[]> {
  const rows = await prisma.fxRate.findMany({ orderBy: { date: "desc" }, take: 20 });
  const seen = new Set<string>();
  const out: FxQuote[] = [];
  for (const r of rows) {
    if (seen.has(r.kind)) continue;
    seen.add(r.kind);
    out.push({
      kind: r.kind as FxKind,
      buy: r.buy === null ? null : Number(r.buy),
      sell: r.sell === null ? null : Number(r.sell),
      date: r.date,
      source: r.source ?? "",
    });
  }
  return out;
}

/**
 * La cotización a usar hoy, refrescando si quedó vieja. Es lo que llama el resto de la app
 * cuando necesita valuar: devuelve el precio o null (y nunca inventa uno).
 */
export async function currentRate(now = new Date()): Promise<{
  rate: number | null;
  quote: FxQuote | null;
  stale: boolean;
}> {
  let quotes = await latestQuotes();
  let quote = pickQuote(quotes);

  if (isStale(quote?.date ?? null, now)) {
    await refreshRates(now);
    quotes = await latestQuotes();
    quote = pickQuote(quotes);
  }

  return {
    rate: rateOf(quote),
    quote,
    stale: isStale(quote?.date ?? null, now),
  };
}

/** Historial para el gráfico: una fila por día del tipo pedido. */
export async function rateHistory(kind: FxKind = "MEP", days = 90) {
  const from = new Date();
  from.setDate(from.getDate() - days);
  const rows = await prisma.fxRate.findMany({
    where: { kind, date: { gte: from } },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => ({
    date: r.date,
    buy: r.buy === null ? null : Number(r.buy),
    sell: r.sell === null ? null : Number(r.sell),
  }));
}
