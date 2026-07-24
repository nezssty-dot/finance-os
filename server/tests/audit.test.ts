/**
 * Tests del motor de auditoría financiera. Determinístico, sin base ni red.
 * Verifica que detecte lo que tiene que detectar y que los totales usen el mismo signo
 * que los saldos reales.
 */

import { auditMovements, reconcileTotals, type AuditMovement } from "../src/lib/audit";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  \u2713 ${name}`); }
  catch (e: any) { failures.push(name); console.log(`  \u2717 ${name}\n      ${e.message}`); }
}
function eq(a: any, b: any, what: string) {
  if (a !== b) throw new Error(`${what}: esperaba ${JSON.stringify(b)}, obtuve ${JSON.stringify(a)}`);
}
function has(report: any, kind: string): boolean {
  return report.findings.some((f: any) => f.kind === kind);
}

const mov = (o: Partial<AuditMovement>): AuditMovement => ({
  id: Math.random().toString(36).slice(2),
  date: "2026-07-10", amount: 1000, type: "EXPENSE", currency: "ARS",
  categoryId: "cat1", accountId: "acc1", description: "algo", ...o,
});

console.log("\n\u2500\u2500\u2500 Duplicados \u2500\u2500\u2500\n");

test("detecta dos movimientos idénticos como duplicado", () => {
  const r = auditMovements([
    mov({ id: "a", description: "Spotify", amount: 7000, date: "2026-07-05" }),
    mov({ id: "b", description: "Spotify", amount: 7000, date: "2026-07-05" }),
  ]);
  eq(has(r, "duplicate"), true, "hay hallazgo de duplicado");
  const f = r.findings.find((x) => x.kind === "duplicate")!;
  eq(f.movementIds.sort().join(","), "a,b", "señala ambos ids");
});

test("dos cafés distinto monto NO son duplicado", () => {
  const r = auditMovements([
    mov({ description: "Cafe", amount: 3000 }),
    mov({ description: "Cafe", amount: 3500 }),
  ]);
  eq(has(r, "duplicate"), false, "sin duplicado");
});

console.log("\n\u2500\u2500\u2500 Categoría \u2500\u2500\u2500\n");

test("marca un ingreso sin categoría", () => {
  const r = auditMovements([mov({ type: "INCOME", categoryId: null })]);
  eq(has(r, "uncategorized_income"), true, "ingreso sin categoría");
});

test("marca un gasto sin categoría", () => {
  const r = auditMovements([mov({ type: "EXPENSE", categoryId: null })]);
  eq(has(r, "uncategorized_expense"), true, "gasto sin categoría");
});

console.log("\n\u2500\u2500\u2500 Fechas \u2500\u2500\u2500\n");

test("marca una fecha inválida", () => {
  const r = auditMovements([mov({ date: null })]);
  eq(has(r, "invalid_date"), true, "fecha inválida");
});

test("marca un movimiento fuera del mes esperado", () => {
  const r = auditMovements(
    [mov({ date: "2026-06-30" })],
    { window: { from: "2026-07-01", to: "2026-07-31" } }
  );
  eq(has(r, "invalid_date"), true, "fuera de rango");
});

test("dentro del rango NO se marca", () => {
  const r = auditMovements(
    [mov({ date: "2026-07-15" })],
    { window: { from: "2026-07-01", to: "2026-07-31" } }
  );
  eq(has(r, "invalid_date"), false, "en rango");
});

console.log("\n\u2500\u2500\u2500 Montos y totales \u2500\u2500\u2500\n");

test("marca un monto inválido", () => {
  const r = auditMovements([mov({ amount: "abc" }), mov({ amount: -50 })]);
  eq(has(r, "invalid_amount"), true, "monto inválido");
  eq(r.findings.find((f) => f.kind === "invalid_amount")!.movementIds.length, 2, "los dos");
});

test("los totales usan el signo correcto (ingreso suma, gasto resta)", () => {
  const r = auditMovements([
    mov({ type: "INCOME", amount: 100000, categoryId: "c" }),
    mov({ type: "EXPENSE", amount: 30000, categoryId: "c" }),
  ]);
  eq(r.totalsByCurrency["ARS"].income, 100000, "ingresos");
  eq(r.totalsByCurrency["ARS"].expense, 30000, "egresos");
  eq(r.totalsByCurrency["ARS"].net, 70000, "neto");
});

test("no mezcla monedas en los totales", () => {
  const r = auditMovements([
    mov({ type: "INCOME", amount: 1000, currency: "ARS", categoryId: "c" }),
    mov({ type: "INCOME", amount: 50, currency: "USD", categoryId: "c" }),
  ]);
  eq(r.totalsByCurrency["ARS"].income, 1000, "pesos");
  eq(r.totalsByCurrency["USD"].income, 50, "dólares aparte");
});

console.log("\n\u2500\u2500\u2500 ok / cantidad \u2500\u2500\u2500\n");

test("una tanda limpia da ok:true", () => {
  const r = auditMovements([
    mov({ type: "INCOME", amount: 5000, categoryId: "c", date: "2026-07-01" }),
    mov({ type: "EXPENSE", amount: 2000, categoryId: "c", date: "2026-07-02" }),
  ]);
  eq(r.ok, true, "sin warnings");
  eq(r.analyzed, 2, "contó los dos");
});

test("una tanda con duplicado da ok:false", () => {
  const r = auditMovements([
    mov({ id: "a", description: "x", amount: 100, categoryId: "c" }),
    mov({ id: "b", description: "x", amount: 100, categoryId: "c" }),
  ]);
  eq(r.ok, false, "hay warning");
});

test("lista vacía no rompe", () => {
  const r = auditMovements([]);
  eq(r.analyzed, 0, "cero");
  eq(r.ok, true, "sin problemas");
});

console.log("\n\u2500\u2500\u2500 reconcileTotals \u2500\u2500\u2500\n");

test("detecta la diferencia con la importación original", () => {
  const diffs = reconcileTotals({ ARS: 500000 }, { ARS: 503500 });
  eq(diffs.length, 1, "una diferencia");
  eq(diffs[0].diff, -3500, "faltan 3.500");
});

test("si cuadra (dentro de tolerancia) no reporta nada", () => {
  const diffs = reconcileTotals({ ARS: 500000 }, { ARS: 500000.5 });
  eq(diffs.length, 0, "sin diferencia");
});

console.log(
  failures.length ? `\n\u274c ${failures.length} fallaron, ${passed} pasaron\n` : `\n\u2705 Auditoría financiera: ${passed} tests pasaron\n`
);
if (failures.length) process.exit(1);
