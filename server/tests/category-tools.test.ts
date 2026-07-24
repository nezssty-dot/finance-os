/**
 * Tests de las herramientas de categorías. Determinístico, sin base ni red.
 */

import { normalizeName, nameRoot, findDuplicates, validateMerge } from "../src/lib/category-tools";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e: any) { failures.push(name); console.log(`  ✗ ${name}\n      ${e.message}`); }
}
function eq(a: any, b: any, what: string) {
  if (a !== b) throw new Error(`${what}: esperaba ${JSON.stringify(b)}, obtuve ${JSON.stringify(a)}`);
}

console.log("\n─── Normalización ───\n");

test("saca acentos, mayúsculas y espacios de más", () => {
  eq(normalizeName("  Alimentación  "), "alimentacion", "normalizado");
});

test("la raíz ignora el plural simple", () => {
  eq(nameRoot("COMIDA"), nameRoot("Comidas"), "comida = comidas");
  eq(nameRoot("SERVICIO"), nameRoot("Servicios"), "servicio = servicios");
});

test("no destroza nombres cortos con el plural", () => {
  // "gas" no debe convertirse en "ga"
  eq(nameRoot("GAS"), "gas", "gas queda gas");
});

console.log("\n─── Detección de duplicados ───\n");

test("agrupa la misma categoría escrita distinto", () => {
  const g = findDuplicates([
    { id: "1", name: "COMIDA", count: 40 },
    { id: "2", name: "Comidas", count: 3 },
    { id: "3", name: "TRANSPORTE", count: 10 },
  ]);
  eq(g.length, 1, "un solo grupo duplicado");
  eq(g[0].keep.id, "1", "conserva la más usada");
  eq(g[0].merge.length, 1, "una para fusionar");
  eq(g[0].merge[0].id, "2", "la menos usada se fusiona");
});

test("sin duplicados no devuelve nada (no molesta al usuario)", () => {
  const g = findDuplicates([
    { id: "1", name: "COMIDA" },
    { id: "2", name: "TRANSPORTE" },
  ]);
  eq(g.length, 0, "sin grupos");
});

test("categorías distintas NO se agrupan por parecerse un poco", () => {
  const g = findDuplicates([
    { id: "1", name: "SALUD" },
    { id: "2", name: "SALIDAS" },
  ]);
  eq(g.length, 0, "salud y salidas son cosas distintas");
});

test("lista vacía no rompe", () => {
  eq(findDuplicates([]).length, 0, "sin grupos");
});

console.log("\n─── Validación de fusión ───\n");

const cats = [
  { id: "a", name: "COMIDA" },
  { id: "b", name: "COMIDAS" },
];

test("una fusión válida pasa", () => {
  eq(validateMerge("b", "a", cats).ok, true, "válida");
});

test("no se puede fusionar una categoría consigo misma", () => {
  const r = validateMerge("a", "a", cats);
  eq(r.ok, false, "rechazada");
  eq(r.error?.includes("consigo misma"), true, "mensaje claro");
});

test("una categoría inexistente se rechaza con mensaje claro", () => {
  eq(validateMerge("zzz", "a", cats).error?.includes("origen"), true, "origen inexistente");
  eq(validateMerge("a", "zzz", cats).error?.includes("destino"), true, "destino inexistente");
});

test("sin ids se rechaza", () => {
  eq(validateMerge("", "a", cats).ok, false, "rechazada");
});

console.log(
  failures.length ? `\n❌ ${failures.length} fallaron, ${passed} pasaron\n` : `\n✅ Herramientas de categorías: ${passed} tests pasaron\n`
);
if (failures.length) process.exit(1);
