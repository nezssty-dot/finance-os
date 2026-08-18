/**
 * Tests del procesamiento de movimientos en la UI.
 *
 * Blindan el bug real que rompía la pantalla de Meses ("Algo se rompió en esta pantalla"):
 * la respuesta de /movements no siempre es un array, y las fechas no siempre son string.
 * Estas funciones puras tienen que tolerar todo eso sin tirar una excepción.
 *
 * Se corre con: npm test  (desde client/)
 */

import { toMovementArray, sortByDateDesc, sumInOut } from "../src/lib/movements.ts";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  \u2713 ${name}`); }
  catch (e) { failures.push(name); console.log(`  \u2717 ${name}\n      ${(e as Error).message}`); }
}
function eq(a: unknown, b: unknown, what: string) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${what}: esperaba ${sb}, obtuve ${sa}`);
}

console.log("\n\u2500\u2500\u2500 toMovementArray: normaliza cualquier respuesta \u2500\u2500\u2500\n");

test("un array plano pasa tal cual", () => {
  eq(toMovementArray([{ id: "1" }, { id: "2" }]).length, 2, "largo");
});

test("un objeto { items } devuelve los items (el caso que romp\u00eda)", () => {
  eq(toMovementArray({ items: [{ id: "1" }] }).length, 1, "largo");
});

test("null / undefined devuelven array vac\u00edo, NO rompen", () => {
  eq(toMovementArray(null).length, 0, "null");
  eq(toMovementArray(undefined).length, 0, "undefined");
});

test("un objeto sin items devuelve array vac\u00edo", () => {
  eq(toMovementArray({ breakdown: {} }).length, 0, "sin items");
});

test("un string suelto no rompe", () => {
  eq(toMovementArray("cualquier cosa").length, 0, "string");
});

console.log("\n\u2500\u2500\u2500 sortByDateDesc: ordena sin romper ni mutar \u2500\u2500\u2500\n");

test("ordena por fecha descendente", () => {
  const r = sortByDateDesc([{ date: "2026-01-01" }, { date: "2026-03-01" }, { date: "2026-02-01" }]);
  eq(r.map((m) => m.date), ["2026-03-01", "2026-02-01", "2026-01-01"], "orden");
});

test("NO muta el array original", () => {
  const orig = [{ date: "2026-01-01" }, { date: "2026-03-01" }];
  sortByDateDesc(orig);
  eq(orig[0].date, "2026-01-01", "el original queda intacto");
});

test("una fecha null no rompe (era la causa del crash)", () => {
  const r = sortByDateDesc([{ date: null }, { date: "2026-03-01" }, { date: undefined }]);
  eq(r.length, 3, "no tira excepci\u00f3n y devuelve todo");
});

test("un movimiento con date tipo Date no rompe", () => {
  const r = sortByDateDesc([{ date: new Date("2026-05-01") as unknown }, { date: "2026-01-01" }]);
  eq(r.length, 2, "tolera Date");
});

test("lista vac\u00eda no rompe", () => {
  eq(sortByDateDesc([]).length, 0, "vac\u00edo");
});

console.log("\n\u2500\u2500\u2500 sumInOut: suma robusta \u2500\u2500\u2500\n");

test("suma ingresos y egresos por separado", () => {
  const r = sumInOut([
    { type: "INCOME", amount: 100 },
    { type: "EXPENSE", amount: 30 },
    { type: "INCOME", amount: 50 },
  ]);
  eq(r.income, 150, "ingresos");
  eq(r.expense, 30, "egresos");
  eq(r.balance, 120, "balance");
});

test("montos no v\u00e1lidos cuentan como 0, no rompen", () => {
  const r = sumInOut([{ type: "INCOME", amount: "abc" }, { type: "INCOME", amount: 100 }]);
  eq(r.income, 100, "ignora el inv\u00e1lido");
});

test("montos como string num\u00e9rico se convierten", () => {
  const r = sumInOut([{ type: "EXPENSE", amount: "250" }]);
  eq(r.expense, 250, "convierte string");
});

console.log(
  failures.length ? `\n\u274c ${failures.length} fallaron, ${passed} pasaron\n` : `\n\u2705 Procesamiento de movimientos: ${passed} tests pasaron\n`
);
if (failures.length) process.exit(1);
