/**
 * Tests de la salud financiera.
 *
 * El puntaje da consejos: si está mal calculado, le dice a alguien que su plata está bien
 * cuando no lo está. Así que se prueba (a) que casos claros dan el resultado esperado, y
 * (b) la invariante que sostiene todo: el score es EXACTAMENTE la suma de los puntos de
 * los factores. Sin eso, la lista de ✔/⚠ y el número podrían contar cosas distintas.
 *
 * Puro, sin base, sin red.
 */

import { computeHealth, type HealthInput } from "../src/lib/health";

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
function eq(a: any, b: any, what: string) {
  if (a !== b) throw new Error(`${what}: esperaba ${JSON.stringify(b)}, obtuve ${JSON.stringify(a)}`);
}
function between(x: number, lo: number, hi: number, what: string) {
  if (x < lo || x > hi) throw new Error(`${what}: ${x} no está entre ${lo} y ${hi}`);
}

function base(over: Partial<HealthInput> = {}): HealthInput {
  return {
    income: 1_000_000,
    expense: 700_000,
    debtOutstanding: 0,
    monthlyServices: 80_000,
    serviceCount: 5,
    categorySpend: {},
    ...over,
  };
}

console.log("\n─── La invariante que sostiene todo: score = suma de factores ───\n");

test("el score es exactamente la suma de los puntos de los factores", () => {
  for (const input of [
    base(),
    base({ income: 0, expense: 0 }),
    base({ debtOutstanding: 5_000_000 }),
    base({ expense: 1_200_000 }),
    base({ monthlyServices: 400_000 }),
    base({ categorySpend: { DELIVERY: 300_000 } }),
  ]) {
    const r = computeHealth(input);
    const sum = r.factors.reduce((s, f) => s + f.points, 0);
    eq(r.score, sum, "score vs suma de factores");
  }
});

test("el score siempre queda entre 0 y 100", () => {
  for (const input of [
    base(),
    base({ income: 0 }),
    base({ expense: 5_000_000, debtOutstanding: 9_000_000, monthlyServices: 800_000 }),
    base({ expense: 0 }),
  ]) {
    between(computeHealth(input).score, 0, 100, "score");
  }
});

test("cada factor nunca supera su máximo ni baja de cero", () => {
  const r = computeHealth(base({ categorySpend: { DELIVERY: 500_000 } }));
  for (const f of r.factors) between(f.points, 0, f.max, `factor "${f.label}"`);
});

console.log("\n─── Casos claros ───\n");

test("finanzas sanas dan un puntaje alto y rating bueno", () => {
  // Ahorra 30%, sin deudas, flujo positivo, servicios moderados, sin excesos.
  const r = computeHealth(base({ income: 1_000_000, expense: 700_000, debtOutstanding: 0, monthlyServices: 80_000 }));
  between(r.score, 80, 100, "score");
  eq(r.rating, "Excelente", "rating");
});

test("gastar más de lo que se ingresa hunde el puntaje", () => {
  const healthy = computeHealth(base({ income: 1_000_000, expense: 700_000 })).score;
  const r = computeHealth(base({ income: 500_000, expense: 800_000, debtOutstanding: 0 }));
  // Lo que importa: cae fuerte respecto al caso sano, y el flujo queda marcado en ✗.
  // (No cae a cero porque no tener deudas SÍ suma — y eso es correcto.)
  if (healthy - r.score < 20) throw new Error(`esperaba una caída fuerte; sano=${healthy}, este=${r.score}`);
  const flow = r.factors.find((f) => f.label.toLowerCase().includes("flujo"));
  eq(flow?.ok, false, "flujo marcado mal");
});

test("sin deudas, el factor deuda da el máximo y dice 'Sin deudas'", () => {
  const r = computeHealth(base({ debtOutstanding: 0 }));
  const debt = r.factors.find((f) => f.label === "Sin deudas");
  eq(!!debt, true, "existe el factor 'Sin deudas'");
  eq(debt!.points, debt!.max, "deuda da el máximo");
});

test("una deuda de más de 3 meses de ingreso lleva el factor deuda a 0", () => {
  const r = computeHealth(base({ income: 1_000_000, debtOutstanding: 4_000_000 }));
  const debt = r.factors.find((f) => f.label.toLowerCase().includes("deuda"));
  eq(debt?.ok, false, "deuda marcada mal");
  eq(debt?.points, 0, "deuda alta da 0 puntos");
});

test("delivery que se come el 30% del gasto dispara la alerta de concentración", () => {
  const r = computeHealth(base({ expense: 700_000, categorySpend: { DELIVERY: 250_000 } }));
  const conc = r.factors.find((f) => f.label.toLowerCase().includes("delivery"));
  eq(!!conc, true, "aparece la alerta de delivery");
  eq(conc!.ok, false, "concentración marcada mal");
});

test("un rubro NECESARIO (SERVICIOS) no cuenta como concentración discrecional", () => {
  // Aunque servicios sea grande, no debe disparar la alerta de "gasto discrecional alto".
  const r = computeHealth(base({ expense: 700_000, categorySpend: { SERVICIOS: 400_000 } }));
  const conc = r.factors.find((f) => f.label.includes("repartidos") || f.label.toLowerCase().includes("servicios"));
  eq(conc?.ok, true, "servicios no dispara concentración");
});

test("demasiadas suscripciones respecto al ingreso baja ese factor", () => {
  const r = computeHealth(base({ income: 500_000, monthlyServices: 250_000 })); // 50%
  const subs = r.factors.find((f) => f.label.toLowerCase().includes("suscripciones"));
  eq(subs?.ok, false, "suscripciones marcadas mal");
});

test("sin ingresos ni gastos, no rompe y da un puntaje válido", () => {
  const r = computeHealth(base({ income: 0, expense: 0, monthlyServices: 0, serviceCount: 0 }));
  between(r.score, 0, 100, "score");
  eq(r.factors.length, 5, "siempre 5 factores");
});

console.log(
  failures.length
    ? `\n❌ ${failures.length} fallaron, ${passed} pasaron\n`
    : `\n${passed}/${passed} tests de salud financiera pasaron\n`
);
if (failures.length) process.exit(1);
