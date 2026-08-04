/**
 * Tests del helper de tema. Puros: solo la lógica de resolver/alternar, sin DOM.
 */
import { resolveTheme, toggleTheme } from "../src/lib/theme.ts";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  \u2713 ${name}`); }
  catch (e) { failures.push(name); console.log(`  \u2717 ${name}\n      ${(e as Error).message}`); }
}
function eq(a: unknown, b: unknown, what: string) {
  if (a !== b) throw new Error(`${what}: esperaba ${JSON.stringify(b)}, obtuve ${JSON.stringify(a)}`);
}

console.log("\n\u2500\u2500\u2500 Tema \u2500\u2500\u2500\n");

test("'light' se resuelve a light", () => eq(resolveTheme("light"), "light", "tema"));
test("'dark' se resuelve a dark", () => eq(resolveTheme("dark"), "dark", "tema"));
test("null cae en el default oscuro", () => eq(resolveTheme(null), "dark", "default"));
test("un valor basura cae en oscuro", () => eq(resolveTheme("azul"), "dark", "default"));
test("toggle de dark da light", () => eq(toggleTheme("dark"), "light", "toggle"));
test("toggle de light da dark", () => eq(toggleTheme("light"), "dark", "toggle"));

console.log(
  failures.length ? `\n\u274c ${failures.length} fallaron\n` : `\n\u2705 Tema: ${passed} tests pasaron\n`
);
if (failures.length) process.exit(1);
