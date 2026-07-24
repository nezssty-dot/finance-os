/**
 * Pure text matching for category suggestions. No database, no imports, no side effects.
 *
 * Separado de server/src/modules/classification.ts (que sí toca `prisma`) por el
 * mismo motivo que balance-math.ts está separado de donde se usa con datos reales:
 * para poder testear la lógica que importa sin levantar una base, y para poder
 * correrla contra el MISMO set de reglas muchas veces sin volver a golpear la
 * tabla — que es exactamente lo que necesita sugerir categoría para las 50 filas
 * de una vista previa de importación.
 */

/** Matcher mínimo que necesita el core: no le hace falta la fila de Prisma entera. */
export type Rule = { matcher: string; categoryId: string };

// Normalize text: lowercase, remove accents & special chars, collapse whitespace.
export function normalize(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * El núcleo puro de la sugerencia: dado un texto ya normalizado y un set de reglas
 * (ya traído de la base), decide la categoría.
 *
 * Prioridad: coincidencia exacta > coincidencia parcial más larga que aparezca en
 * el texto, con al menos 3 caracteres para evitar falsos positivos ("de", "sa").
 */
export function matchCategory(norm: string, rules: Rule[]): string | null {
  if (!norm || !rules.length) return null;

  const exact = rules.find((r) => r.matcher === norm);
  if (exact) return exact.categoryId;

  // Copia antes de ordenar: en el uso por lote, `rules` es el mismo array para
  // todas las filas, y no hay motivo para mutar algo compartido.
  const sorted = [...rules].sort((a, b) => b.matcher.length - a.matcher.length);
  for (const rule of sorted) {
    if (norm.includes(rule.matcher) && rule.matcher.length >= 3) {
      return rule.categoryId;
    }
  }

  return null;
}

// Ruido que NO sirve como nombre de comercio: prefijos de procesadores de pago y
// palabras genéricas. Sin esto, "MERPAGO*NETFLIX" aprendería "merpago" (que matchea TODOS
// los pagos de Mercado Pago) en vez de "netflix".
const MATCHER_NOISE = new Set([
  "merpago", "mercadopago", "mp", "pago", "pagofacil", "debin", "compra", "debito",
  "credito", "tarjeta", "transferencia", "transf", "cuota", "cuotas", "abono", "ars",
  "usd", "pesos", "cap", "arg", "argentina", "sa", "srl", "sas", "www", "com",
]);

// Generate matchers from text: the full normalized string + progressive prefixes + the
// most significant merchant token.
// "juan perez"      → ["juan perez", "juan"]
// "mercado libre"   → ["mercado libre", "mercado"]
// "MERPAGO*NETFLIX" → ["merpago netflix", "merpago", "netflix"]  ← aprende el comercio real
// This gives priority to full matches while still catching the actual merchant even when a
// payment-processor prefix comes first.
export function generateMatchers(text: string): string[] {
  const norm = normalize(text);
  if (!norm) return [];
  const words = norm.split(" ").filter(Boolean);
  const matchers: string[] = [];
  // Full text first (highest priority when matching)
  matchers.push(norm);
  // Then progressively shorter prefixes (2 words, 1 word)
  for (let i = words.length - 1; i >= 1; i--) {
    const partial = words.slice(0, i).join(" ");
    if (partial !== norm && !matchers.includes(partial)) matchers.push(partial);
  }
  // Además: el token significativo más largo (el nombre del comercio), aunque NO sea
  // prefijo. Ignora ruido de procesadores y números. Cubre el caso "MERPAGO*NETFLIX".
  const significant = words
    .filter((w) => w.length >= 3 && !MATCHER_NOISE.has(w) && !/^\d+$/.test(w))
    .sort((a, b) => b.length - a.length)[0];
  if (significant && !matchers.includes(significant)) matchers.push(significant);

  return matchers;
}
