/**
 * Tests de los compromisos recurrentes. Determinístico, sin base ni red.
 * Lo crítico: que los anuales NO se mezclen con los mensuales y que nunca se invente
 * una cotización.
 */

import { commitmentSummary, type CommitmentService } from "../src/lib/commitments";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  \u2713 ${name}`); }
  catch (e: any) { failures.push(name); console.log(`  \u2717 ${name}\n      ${e.message}`); }
}
function eq(a: any, b: any, what: string) {
  if (a !== b) throw new Error(`${what}: esperaba ${JSON.stringify(b)}, obtuve ${JSON.stringify(a)}`);
}

const s = (o: Partial<CommitmentService>): CommitmentService => ({
  amount: 0, frequency: "MONTHLY", interval: 1, currency: "ARS", active: true, ...o,
});

const RATE = 1500; // 1 USD = 1500 ARS

console.log("\n\u2500\u2500\u2500 Mensuales y anuales SEPARADOS \u2500\u2500\u2500\n");

test("un anual NO se suma a los mensuales", () => {
  const r = commitmentSummary([
    s({ name: "Gym", amount: 64000, frequency: "MONTHLY" }),
    s({ name: "Pro Tools", amount: 300, currency: "USD", frequency: "YEARLY" }),
  ], RATE, "ARS");
  eq(r.monthly.count, 1, "solo el mensual");
  eq(r.annual.count, 1, "solo el anual");
  eq(r.monthly.byCurrency["ARS"], 64000, "el mensual queda limpio");
});

test("el anual guarda el monto COMPLETO, no dividido", () => {
  const r = commitmentSummary([
    s({ amount: 300, currency: "USD", frequency: "YEARLY" }),
  ], RATE, "USD");
  eq(r.annual.byCurrency["USD"], 300, "los 300 enteros");
});

test("annualPerMonth da el equivalente mensual para ahorrarlo de a poco", () => {
  const r = commitmentSummary([
    s({ amount: 1200, currency: "ARS", frequency: "YEARLY" }),
  ], RATE, "ARS");
  eq(r.annual.converted, 1200, "anual completo");
  eq(r.annualPerMonth, 100, "1200 / 12");
});

test("un semanal se normaliza a mensual", () => {
  const r = commitmentSummary([
    s({ amount: 1000, frequency: "WEEKLY" }),
  ], RATE, "ARS");
  // 1000 * 52 / 12 = 4333.33
  eq(Math.round(r.monthly.converted!), 4333, "semanal a mensual");
});

test("un trimestral (interval 3) divide por 3", () => {
  const r = commitmentSummary([
    s({ amount: 30000, frequency: "MONTHLY", interval: 3 }),
  ], RATE, "ARS");
  eq(r.monthly.converted, 10000, "30000 / 3");
});

console.log("\n\u2500\u2500\u2500 Conversión de monedas \u2500\u2500\u2500\n");

test("convierte USD a pesos con la cotización del día", () => {
  const r = commitmentSummary([
    s({ amount: 20, currency: "USD", frequency: "MONTHLY" }),
  ], RATE, "ARS");
  eq(r.monthly.converted, 30000, "20 x 1500");
  eq(r.monthly.byCurrency["USD"], 20, "conserva el original");
});

test("convierte pesos a USD si esa es la moneda elegida", () => {
  const r = commitmentSummary([
    s({ amount: 150000, currency: "ARS", frequency: "MONTHLY" }),
  ], RATE, "USD");
  eq(r.monthly.converted, 100, "150000 / 1500");
});

test("suma pesos y dólares en un solo total convertido", () => {
  const r = commitmentSummary([
    s({ amount: 64000, currency: "ARS" }),
    s({ amount: 20, currency: "USD" }),
  ], RATE, "ARS");
  eq(r.monthly.converted, 64000 + 30000, "total en pesos");
  eq(r.monthly.complete, true, "todo convertido");
});

console.log("\n\u2500\u2500\u2500 Sin cotización NO se inventa \u2500\u2500\u2500\n");

test("sin cotización, lo que no se puede convertir marca incompleto", () => {
  const r = commitmentSummary([
    s({ amount: 64000, currency: "ARS" }),
    s({ amount: 20, currency: "USD" }),
  ], null, "ARS");
  eq(r.monthly.complete, false, "marcado incompleto");
  eq(r.monthly.byCurrency["USD"], 20, "el original sigue visible");
  eq(r.monthly.converted, 64000, "solo lo que se pudo");
});

test("una moneda sin cotización propia (EUR) no se adivina", () => {
  const r = commitmentSummary([s({ amount: 50, currency: "EUR" })], RATE, "ARS");
  eq(r.monthly.complete, false, "incompleto");
  eq(r.monthly.byCurrency["EUR"], 50, "queda visible en su moneda");
});

console.log("\n\u2500\u2500\u2500 Robustez \u2500\u2500\u2500\n");

test("un servicio inactivo no cuenta", () => {
  const r = commitmentSummary([s({ amount: 5000, active: false })], RATE, "ARS");
  eq(r.monthly.count, 0, "no cuenta");
});

test("monto en cero se ignora", () => {
  const r = commitmentSummary([s({ amount: 0 })], RATE, "ARS");
  eq(r.monthly.count, 0, "ignorado");
});

test("lista vacía no rompe", () => {
  const r = commitmentSummary([], RATE, "ARS");
  eq(r.monthly.converted, 0, "cero");
  eq(r.annual.converted, 0, "cero");
});

console.log(
  failures.length ? `\n\u274c ${failures.length} fallaron, ${passed} pasaron\n` : `\n\u2705 Compromisos recurrentes: ${passed} tests pasaron\n`
);
if (failures.length) process.exit(1);
