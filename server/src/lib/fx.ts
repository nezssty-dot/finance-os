/**
 * Cotización del dólar. PURO: sin base, sin red.
 *
 * ─── POR QUÉ ESTO NO ES UNA "INTEGRACIÓN" ───
 *
 * El dólar MEP no es una cuenta: es un PRECIO público. No hay usuario, ni contraseña, ni
 * OAuth, ni token que renovar. Se consulta una fuente pública y se guarda. Por eso vive
 * acá y no en integrations/ junto a IOL o Mercado Pago.
 *
 * ─── LA REGLA QUE NO SE NEGOCIA ───
 *
 * Si no hay cotización, NO se inventa uno. `convert` devuelve null y la pantalla muestra
 * el monto en su moneda original. Un patrimonio calculado con un dólar inventado es peor
 * que un patrimonio que no se muestra: el usuario confía en el número y toma decisiones
 * con él.
 */

/** Los tipos de dólar que interesan. "MEP" es el que usa el mercado para valuar. */
export type FxKind = "MEP" | "OFICIAL" | "BLUE" | "CCL" | "CRIPTO";

export interface FxQuote {
  kind: FxKind;
  /** Precio de compra (lo que te pagan por vender un dólar). Puede faltar. */
  buy: number | null;
  /** Precio de venta (lo que pagás por comprar un dólar). Es el que se usa para valuar. */
  sell: number | null;
  /** Cuándo se actualizó en la fuente. */
  date: Date;
  source: string;
}

// En dolarapi (y en casi todas las fuentes locales) el MEP se llama "bolsa". Se aceptan
// los dos nombres para que un cambio de nomenclatura en la fuente no rompa el parseo.
const CASA_TO_KIND: Record<string, FxKind> = {
  bolsa: "MEP",
  mep: "MEP",
  oficial: "OFICIAL",
  blue: "BLUE",
  contadoconliqui: "CCL",
  ccl: "CCL",
  cripto: "CRIPTO",
};

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Convierte la respuesta de la fuente pública en cotizaciones. Tolerante: acepta un array
 * o un objeto suelto, ignora entradas rotas y nunca tira — una fuente que cambia el
 * formato no puede tumbar la app, solo dejarla sin cotización nueva.
 */
export function parseQuotes(payload: unknown, source = "dolarapi"): FxQuote[] {
  const list = Array.isArray(payload) ? payload : [payload];
  const out: FxQuote[] = [];

  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;

    const casa = String(r.casa ?? r.nombre ?? "").toLowerCase().replace(/\s+/g, "");
    const kind = CASA_TO_KIND[casa];
    if (!kind) continue;

    const sell = num(r.venta ?? r.sell);
    const buy = num(r.compra ?? r.buy);
    // Sin precio no hay cotización. No se guarda un cero que después alguien multiplique.
    if (sell === null && buy === null) continue;

    const rawDate = r.fechaActualizacion ?? r.fecha ?? r.date;
    const date = rawDate ? new Date(String(rawDate)) : new Date();

    out.push({
      kind,
      buy,
      sell,
      date: Number.isNaN(date.getTime()) ? new Date() : date,
      source,
    });
  }
  return out;
}

/**
 * Elige la cotización a usar, con cascada de respaldo: primero la preferida (MEP), y si no
 * está, la siguiente disponible. Devuelve null si no hay ninguna — y ahí la app muestra
 * los montos en su moneda, sin convertir.
 */
export function pickQuote(
  quotes: FxQuote[],
  preference: FxKind[] = ["MEP", "CCL", "OFICIAL", "BLUE"]
): FxQuote | null {
  for (const kind of preference) {
    const found = quotes.find((q) => q.kind === kind && (q.sell !== null || q.buy !== null));
    if (found) return found;
  }
  return null;
}

/** El precio con el que se valúa: la venta; si falta, la compra. */
export function rateOf(quote: FxQuote | null): number | null {
  if (!quote) return null;
  return quote.sell ?? quote.buy ?? null;
}

/**
 * ¿La cotización quedó vieja? Se considera del día: si es de otro día calendario, hay que
 * refrescarla. Así se actualiza una vez por día sin golpear la fuente en cada apertura.
 */
export function isStale(fetchedAt: Date | string | null, now: Date = new Date()): boolean {
  if (!fetchedAt) return true;
  const d = new Date(fetchedAt);
  if (Number.isNaN(d.getTime())) return true;
  return (
    d.getFullYear() !== now.getFullYear() ||
    d.getMonth() !== now.getMonth() ||
    d.getDate() !== now.getDate()
  );
}

/**
 * Convierte un monto entre ARS y USD. Devuelve null si no hay cotización: NUNCA inventa
 * un tipo de cambio. Si las monedas son iguales, devuelve el monto tal cual.
 */
export function convert(
  amount: number,
  from: string,
  to: string,
  rate: number | null
): number | null {
  if (from === to) return amount;
  if (rate === null || !Number.isFinite(rate) || rate <= 0) return null;

  if (from === "ARS" && to === "USD") return Math.round((amount / rate) * 100) / 100;
  if (from === "USD" && to === "ARS") return Math.round(amount * rate * 100) / 100;
  // Cualquier otro par (EUR, etc.) necesitaría su propia cotización: no se adivina.
  return null;
}

/**
 * Valúa un patrimonio repartido en varias monedas en UNA sola moneda.
 *
 * Devuelve también `converted`: si es false, hubo montos que no se pudieron convertir (no
 * había cotización para esa moneda) y el total está incompleto. La pantalla tiene que
 * decirlo en vez de mostrar un número que parece completo y no lo es.
 */
export function totalIn(
  byCurrency: Record<string, number>,
  target: string,
  rate: number | null
): { total: number; converted: boolean } {
  let total = 0;
  let converted = true;

  for (const [currency, amount] of Object.entries(byCurrency)) {
    if (!amount) continue;
    const v = convert(amount, currency, target, rate);
    if (v === null) {
      converted = false;
      continue;
    }
    total += v;
  }
  return { total: Math.round(total * 100) / 100, converted };
}
