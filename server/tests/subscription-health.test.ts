/**
 * Tests de la salud de suscripciones. Determinístico, sin base ni red.
 */

import { subscriptionHealth, type ServiceStatus } from "../src/lib/subscription-health";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  \u2713 ${name}`); }
  catch (e: any) { failures.push(name); console.log(`  \u2717 ${name}\n      ${e.message}`); }
}
function eq(a: any, b: any, what: string) {
  if (a !== b) throw new Error(`${what}: esperaba ${JSON.stringify(b)}, obtuve ${JSON.stringify(a)}`);
}

const base = (o: Partial<ServiceStatus>): ServiceStatus => ({
  amount: 0, frequency: "MONTHLY", interval: 1, dueDay: 15,
  startDate: new Date(2026, 0, 15), endDate: null, active: true, ...o,
});

const HOY = new Date(2026, 6, 10); // 10 de julio

console.log("\n\u2500\u2500\u2500 Conteo pagadas / pendientes \u2500\u2500\u2500\n");

test("separa pagadas de pendientes", () => {
  const h = subscriptionHealth([
    base({ name: "Spotify", amount: 7000, paidThisPeriod: true }),
    base({ name: "Gym", amount: 64000, paidThisPeriod: false }),
    base({ name: "Claude", amount: 20000, currency: "USD", paidThisPeriod: false }),
  ], null, HOY);
  eq(h.paid, 1, "pagadas");
  eq(h.pending, 2, "pendientes");
  eq(h.total, 3, "total");
});

test("un servicio inactivo no cuenta", () => {
  const h = subscriptionHealth([
    base({ name: "Viejo", amount: 5000, active: false }),
    base({ name: "Spotify", amount: 7000, paidThisPeriod: true }),
  ], null, HOY);
  eq(h.total, 1, "solo el activo");
});

console.log("\n\u2500\u2500\u2500 Gasto mensual por moneda (no se mezclan) \u2500\u2500\u2500\n");

test("suma el gasto mensual sin mezclar ARS y USD", () => {
  const h = subscriptionHealth([
    base({ amount: 7000, currency: "ARS" }),
    base({ amount: 64000, currency: "ARS" }),
    base({ amount: 20, currency: "USD" }),
  ], null, HOY);
  eq(h.monthlyByCurrency["ARS"], 71000, "pesos");
  eq(h.monthlyByCurrency["USD"], 20, "dólares aparte");
});

test("un anual pesa 1/12 en el gasto mensual", () => {
  const h = subscriptionHealth([
    base({ amount: 120000, frequency: "YEARLY", currency: "ARS" }),
  ], null, HOY);
  eq(h.monthlyByCurrency["ARS"], 10000, "120k al año = 10k al mes");
});

console.log("\n\u2500\u2500\u2500 Próximo vencimiento \u2500\u2500\u2500\n");

test("elige el próximo a vencer entre los pendientes", () => {
  const h = subscriptionHealth([
    base({ name: "Fin de mes", amount: 5000, dueDay: 28, paidThisPeriod: false }),
    base({ name: "Pronto", amount: 3000, dueDay: 12, paidThisPeriod: false }),
  ], null, HOY);
  eq(h.nextDue?.name, "Pronto", "el más cercano");
  eq(h.nextDue?.inDays, 2, "faltan 2 días (10 → 12 jul)");
});

test("un servicio ya pagado no aparece como próximo vencimiento", () => {
  const h = subscriptionHealth([
    base({ name: "Pagado", amount: 3000, dueDay: 12, paidThisPeriod: true }),
  ], null, HOY);
  eq(h.nextDue, null, "no hay próximo porque ya pagó");
});

console.log("\n\u2500\u2500\u2500 % sobre ingresos (la idea clave) \u2500\u2500\u2500\n");

test("calcula qué % del ingreso se va en suscripciones", () => {
  // 185.000 en suscripciones sobre 1.000.000 de ingreso = 18.5%
  const h = subscriptionHealth([base({ amount: 185000, currency: "ARS" })], 1_000_000, HOY);
  eq(h.shareOfIncome, 18.5, "porcentaje");
});

test("sin ingreso conocido, el % es null (no se inventa)", () => {
  const h = subscriptionHealth([base({ amount: 50000 })], null, HOY);
  eq(h.shareOfIncome, null, "null");
  const h2 = subscriptionHealth([base({ amount: 50000 })], 0, HOY);
  eq(h2.shareOfIncome, null, "ingreso 0 tampoco divide");
});

test("lista vacía no rompe", () => {
  const h = subscriptionHealth([], 100000, HOY);
  eq(h.total, 0, "cero");
  eq(h.nextDue, null, "sin próximo");
  eq(h.shareOfIncome, 0, "0% de gasto");
});


console.log("\n\u2500\u2500\u2500 Conversión USD \u2192 pesos con la cotización del día \u2500\u2500\u2500\n");

test("convierte las suscripciones en dólares a pesos", () => {
  // 20 USD a 1200 = 24.000 pesos, más 7.000 en pesos = 31.000
  const h = subscriptionHealth([
    base({ amount: 7000, currency: "ARS" }),
    base({ amount: 20, currency: "USD" }),
  ], null, HOY, { currency: "ARS", rate: 1200 });
  eq(h.monthlyConverted?.total, 31000, "total en pesos");
  eq(h.monthlyConverted?.complete, true, "todo convertido");
});

test("el costo anual es 12 veces el mensual convertido", () => {
  const h = subscriptionHealth([
    base({ amount: 20, currency: "USD" }),
  ], null, HOY, { currency: "ARS", rate: 1200 });
  eq(h.yearlyConverted, 24000 * 12, "anual");
});

test("SIN cotización no inventa un total (queda null)", () => {
  const h = subscriptionHealth([
    base({ amount: 7000, currency: "ARS" }),
    base({ amount: 20, currency: "USD" }),
  ], null, HOY, { currency: "ARS", rate: null });
  eq(h.monthlyConverted, null, "no inventa");
  eq(h.monthlyByCurrency["USD"], 20, "pero muestra los dólares aparte");
});

test("si todo está en la moneda destino, no necesita cotización", () => {
  const h = subscriptionHealth([
    base({ amount: 7000, currency: "ARS" }),
  ], null, HOY, { currency: "ARS", rate: null });
  eq(h.monthlyConverted?.total, 7000, "convierte igual");
});

test("el % de ingresos incluye las suscripciones en dólares", () => {
  // 20 USD a 1200 = 24.000. Sobre 240.000 de ingreso = 10%
  const h = subscriptionHealth([
    base({ amount: 20, currency: "USD" }),
  ], 240000, HOY, { currency: "ARS", rate: 1200 });
  eq(h.shareOfIncome, 10, "10% del ingreso");
});

test("puede convertir a dólares en vez de a pesos", () => {
  // 1.200.000 pesos a 1200 = 1000 USD
  const h = subscriptionHealth([
    base({ amount: 1200000, currency: "ARS" }),
  ], null, HOY, { currency: "USD", rate: 1200 });
  eq(h.monthlyConverted?.total, 1000, "en dólares");
});

console.log(
  failures.length ? `\n\u274c ${failures.length} fallaron, ${passed} pasaron\n` : `\n\u2705 Salud de suscripciones: ${passed} tests pasaron\n`
);
if (failures.length) process.exit(1);
