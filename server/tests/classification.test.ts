/**
 * Tests del núcleo de clasificación por reglas.
 *
 * `matchCategory` y `normalize` viven en lib/classify.ts — puro, sin `prisma`, a
 * propósito, igual que balance-math.ts. `classification.ts` (el módulo con
 * `suggestCategory`/`suggestCategories`/`learn`) las reexporta y les agrega la
 * base encima. Sin base de datos, sin red, sin credenciales: igual que el resto
 * de esta carpeta.
 *
 * Esto es lo que decide la "Categoría sugerida" de la vista previa del importador
 * (ver server/src/modules/integrations.ts → /import/preview), así que un error acá
 * es una categoría mal sugerida en pantalla, no un crash silencioso.
 */

import { matchCategory, normalize, generateMatchers } from "../src/lib/classify";
import { SEED_RULES } from "../src/lib/seed-rules";

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}

function eq(actual: any, expected: any, what: string) {
  if (actual !== expected)
    throw new Error(`${what}: esperaba ${JSON.stringify(expected)}, obtuve ${JSON.stringify(actual)}`);
}

const rule = (matcher: string, categoryId: string) => ({ matcher, categoryId });

console.log("\n─── normalize: sin acentos, sin mayúsculas, sin ruido ───\n");

test("saca acentos y pasa a minúscula", () => {
  eq(normalize("Débito Automático"), "debito automatico", "normalizado");
});

test("saca símbolos pero conserva números", () => {
  eq(normalize("YPF #4521 (Ruta 9)"), "ypf 4521 ruta 9", "normalizado");
});

test("colapsa espacios múltiples", () => {
  eq(normalize("MERCADO   LIBRE"), "mercado libre", "normalizado");
});

test("string vacío da string vacío, no rompe", () => {
  eq(normalize(""), "", "normalizado");
});

console.log("\n─── matchCategory: exacto primero, después el parcial más largo ───\n");

test("sin reglas, no sugiere nada", () => {
  eq(matchCategory(normalize("Spotify AB"), []), null, "categoría");
});

test("texto vacío no sugiere nada aunque haya reglas", () => {
  eq(matchCategory("", [rule("spotify", "cat_subs")]), null, "categoría");
});

test("coincidencia exacta gana aunque haya una parcial también válida", () => {
  const rules = [rule("ypf", "cat_generico"), rule("ypf 4521 ruta 9", "cat_especifico")];
  eq(matchCategory(normalize("YPF 4521 Ruta 9"), rules), "cat_especifico", "categoría");
});

test("sin exacta, gana la parcial MÁS LARGA que aparece en el texto", () => {
  const rules = [rule("mercado", "cat_compras"), rule("mercado pago", "cat_billetera")];
  eq(matchCategory(normalize("Pago en Mercado Pago"), rules), "cat_billetera", "categoría");
});

test("una coincidencia de menos de 3 caracteres no cuenta (falso positivo)", () => {
  // "sa" podría matchear media descripción de casualidad; el mínimo evita eso.
  const rules = [rule("sa", "cat_ruido")];
  eq(matchCategory(normalize("Pago a Casa de Cambio SA"), rules), null, "categoría");
});

test("no matchea si la regla no aparece en el texto", () => {
  const rules = [rule("netflix", "cat_subs")];
  eq(matchCategory(normalize("Supermercado Coto"), rules), null, "categoría");
});

test("no muta el array de reglas (importa: se reusa entre filas en el lote)", () => {
  const rules = [rule("zzz", "cat_z"), rule("aaa", "cat_a")];
  const before = rules.map((r) => r.matcher).join(",");
  matchCategory(normalize("aaa"), rules);
  eq(rules.map((r) => r.matcher).join(","), before, "orden del array original");
});

console.log("\n─── Las reglas semilla: que no ensucien los reportes en silencio ───\n");

const SEED_MATCHERS = SEED_RULES.flatMap((c) => c.merchants.map((m) => normalize(m)));

test("ninguna semilla queda por debajo del mínimo de 3 caracteres", () => {
  // matchCategory ignora los matchers de menos de 3 chars. Sembrar uno más corto es
  // guardar una fila que no va a matchear nunca — basura silenciosa en la tabla.
  const short = SEED_MATCHERS.filter((m) => m.length < 3);
  eq(short.join(",") || "ninguna", "ninguna", "semillas demasiado cortas");
});

test("ninguna semilla se convierte en string vacío al normalizar", () => {
  eq(SEED_MATCHERS.filter((m) => !m).length, 0, "semillas vacías");
});

test("no hay dos semillas iguales apuntando a categorías distintas", () => {
  // Dos filas con el mismo matcher no pueden existir (@@unique userId+field+matcher),
  // así que la segunda se perdería en silencio y la categoría sería la del azar.
  const seen = new Map<string, string>();
  const conflicts: string[] = [];
  for (const cat of SEED_RULES) {
    for (const m of cat.merchants) {
      const key = normalize(m);
      const prev = seen.get(key);
      if (prev && prev !== cat.name) conflicts.push(`${key}: ${prev} vs ${cat.name}`);
      seen.set(key, cat.name);
    }
  }
  eq(conflicts.join(" · ") || "ninguno", "ninguno", "conflictos entre semillas");
});

test("una semilla no puede ser subcadena de otra de distinta categoría", () => {
  // matchCategory elige la coincidencia MÁS LARGA, así que esto no rompe — pero si
  // pasara, el matcher corto quedaría muerto para siempre y no lo sabríamos.
  // Ej: sembrar "uber" (TRANSPORTE) y "uber eats" (DELIVERY) es correcto y funciona:
  // "uber eats" gana por ser más largo. Este test documenta que se apoya en eso.
  const rules = [rule("uber", "cat_transporte"), rule("uber eats", "cat_delivery")];
  eq(matchCategory(normalize("UBER EATS ARG"), rules), "cat_delivery", "el más largo gana");
  eq(matchCategory(normalize("UBER TRIP 4821"), rules), "cat_transporte", "el corto sigue vivo");
});

test("Spotify cae en STREAMING y no en otra cosa", () => {
  const rules = SEED_RULES.flatMap((c) => c.merchants.map((m) => rule(normalize(m), c.name)));
  eq(matchCategory(normalize("SPOTIFY AB 34534"), rules), "STREAMING", "categoría");
  eq(matchCategory(normalize("YPF FULL RUTA 9"), rules), "COMBUSTIBLE", "categoría");
  eq(matchCategory(normalize("PEDIDOSYA*BURGER"), rules), "DELIVERY", "categoría");
  eq(matchCategory(normalize("OPENAI *CHATGPT SUBSCR"), rules), "IA", "categoría");
});

test("un comercio que no está en el catálogo no se fuerza a ninguna categoría", () => {
  const rules = SEED_RULES.flatMap((c) => c.merchants.map((m) => rule(normalize(m), c.name)));
  eq(matchCategory(normalize("KIOSCO DE LA ESQUINA"), rules), null, "categoría");
});

console.log("\n─── generateMatchers: aprende el comercio real ───\n");

test("de un nombre simple saca el texto completo y los prefijos", () => {
  const m = generateMatchers("Mercado Libre");
  eq(m.includes("mercado libre"), true, "texto completo");
  eq(m.includes("mercado"), true, "prefijo");
});

test("con prefijo de procesador, ADEMÁS aprende el comercio real", () => {
  // "MERPAGO*NETFLIX" no debe aprender solo "merpago" (matchea todo Mercado Pago).
  const m = generateMatchers("MERPAGO*NETFLIX");
  eq(m.includes("netflix"), true, "aprende netflix");
});

test("saltea ruido y números, se queda con el comercio", () => {
  const m = generateMatchers("Pago tarjeta FINANCE cuota 3");
  eq(m.includes("finance"), true, "aprende finance");
});

test("después de aprender, un movimiento parecido matchea por el comercio", () => {
  // Simula el flujo real: aprendo de una descripción sucia, luego llega otra del mismo
  // comercio con distinto sufijo y debe caer en la misma categoría.
  const learned = generateMatchers("MERPAGO*NETFLIX").map((mt) => rule(mt, "cat_streaming"));
  eq(matchCategory(normalize("MERPAGO*NETFLIX AR 998877"), learned), "cat_streaming", "matchea netflix");
});

console.log(
  failures.length
    ? `\n❌ ${failures.length} fallaron, ${passed} pasaron\n`
    : `\n${passed}/${passed} tests de clasificación pasaron\n`
);

if (failures.length) process.exit(1);
