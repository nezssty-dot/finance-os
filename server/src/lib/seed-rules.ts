/**
 * Reglas de clasificación semilla. PURO: sin imports, sin IO, sin base.
 *
 * ─── EL PROBLEMA QUE RESUELVE ───
 *
 * `ClassificationRule` arranca VACÍA. El clasificador existe, aprende y funciona —
 * pero no sabe nada hasta que el usuario categoriza algo a mano. En una instalación
 * nueva, importás 300 movimientos y los 300 salen sin categoría.
 *
 * Esto le da un punto de partida: comercios que en Argentina se llaman siempre igual
 * en el extracto, mapeados a la categoría obvia.
 *
 * ─── LA SEMILLA NUNCA LE GANA AL USUARIO ───
 *
 * Se insertan con `field: "counterpart"`, el MISMO que usa `learn()`. Eso no es un
 * detalle: `@@unique([userId, field, matcher])` hace que cuando el usuario corrija una
 * categoría, su `learn()` haga UPDATE sobre la fila de la semilla en vez de crear una
 * segunda. La corrección la pisa, para siempre, y no quedan dos reglas peleando por el
 * mismo texto.
 *
 * ─── POR QUÉ NO HAY REGLA PARA "TRANSFERENCIA" ───
 *
 * Gabi la pidió, y es una trampa. El importador de extractos crea todo como INCOME o
 * EXPENSE según el signo (nunca TRANSFER: no tiene forma de saber que la otra punta es
 * una cuenta tuya). Una regla "transferencia → TRANSFERENCIAS" no arregla eso: le pone
 * una etiqueta linda a un movimiento que sigue contando como gasto. Los reportes
 * quedarían inflados igual, pero ahora con una categoría que hace parecer que está bien.
 *
 * El tipo TRANSFER lo maneja el ledger, no el clasificador. Ver NOTAS-SPRINT.md.
 *
 * ─── CUIDADO CON LOS MATCHERS CORTOS ───
 *
 * El matching es por `includes()` con un mínimo de 3 caracteres. Eso deja pasar cosas
 * como "dia" (supermercado Día), que matchea "DIARIO", "GUARDIA" y "MEDIA"; o "vea",
 * que matchea "NIVEA". Están deliberadamente afuera: una categoría equivocada ensucia
 * los reportes EN SILENCIO, y es peor que no categorizar nada.
 */

export interface SeedCategory {
  /** En MAYÚSCULA: es como `modules/categories.ts` guarda todos los nombres. */
  name: string;
  color: string;
  /** Se normalizan al insertarlos (minúscula, sin acentos), igual que en `learn()`. */
  merchants: string[];
}

export const SEED_RULES: SeedCategory[] = [
  {
    name: "STREAMING",
    color: "#A24E63",
    merchants: [
      "spotify", "netflix", "disney plus", "hbo", "youtube premium", "prime video",
      "apple tv", "paramount", "crunchyroll", "twitch", "mubi", "flow",
    ],
  },
  {
    name: "IA",
    color: "#C7A93C",
    merchants: ["openai", "chatgpt", "anthropic", "claude", "midjourney", "perplexity", "cursor"],
  },
  {
    name: "TECNOLOGIA",
    color: "#5B7FB1",
    merchants: [
      "apple.com", "adobe", "microsoft", "google", "icloud", "dropbox", "github",
      "notion", "figma", "canva", "namecheap", "godaddy", "hostinger", "cloudflare",
      "vercel", "netlify", "shopify",
    ],
  },
  {
    name: "COMBUSTIBLE",
    color: "#8C7A3E",
    merchants: ["ypf", "shell", "axion", "puma energia", "refinor"],
  },
  {
    name: "DELIVERY",
    color: "#9E6B4C",
    merchants: ["pedidosya", "pedidos ya", "rappi", "uber eats"],
  },
  {
    name: "TRANSPORTE",
    color: "#5B7FB1",
    merchants: ["uber", "cabify", "didi", "sube", "aerolineas", "flybondi", "jetsmart"],
  },
  {
    name: "SUPERMERCADO",
    color: "#7E8A4A",
    merchants: ["coto", "carrefour", "jumbo", "disco", "chango mas", "walmart", "makro"],
  },
  {
    name: "COMPRAS",
    color: "#6A6A70",
    merchants: [
      "mercado libre", "mercadolibre", "amazon", "aliexpress", "shein",
      "falabella", "fravega", "garbarino", "musimundo",
    ],
  },
  {
    name: "COMIDA",
    color: "#9E6B4C",
    merchants: ["starbucks", "mcdonalds", "burger king", "mostaza", "subway", "havanna"],
  },
  {
    name: "SALUD",
    color: "#7E8A4A",
    merchants: [
      "farmacity", "farmacia", "osde", "swiss medical", "galeno", "medife",
      "sanatorio", "omint",
    ],
  },
  {
    name: "SERVICIOS",
    color: "#A24E63",
    merchants: [
      "edenor", "edesur", "metrogas", "aysa", "camuzzi", "naturgy", "telecom",
      "personal", "movistar", "claro", "fibertel", "directv", "monotributo",
      "arba", "afip", "rentas",
    ],
  },
  {
    name: "PRODUCCION",
    color: "#C7A93C",
    merchants: [
      "distrokid", "amuse", "splice", "native instruments", "ableton", "waves",
      "izotope", "landr", "soundcloud", "bandcamp", "beatport", "loopcloud",
    ],
  },
  {
    name: "INGRESOS",
    color: "#5bbf7a",
    merchants: ["sueldo", "haberes", "honorarios", "acreditacion de haberes"],
  },
];

/** Cuántas reglas trae el catálogo. Para poder afirmarlo sin recorrerlo a mano. */
export const SEED_RULE_COUNT = SEED_RULES.reduce((n, c) => n + c.merchants.length, 0);
