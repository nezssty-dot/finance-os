/**
 * Tests del motor de recomendaciones. Determinístico, sin base ni red.
 */

import { recommendations, type RecoSnapshot } from "../src/lib/recommendations";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e: any) { failures.push(name); console.log(`  ✗ ${name}\n      ${e.message}`); }
}
function ok(cond: boolean, what: string) { if (!cond) throw new Error(what); }
function has(recos: { text: string }[], substr: string): boolean {
  return recos.some((r) => r.text.toLowerCase().includes(substr.toLowerCase()));
}

const base: RecoSnapshot = {
  monthIncome: 1000000,
  monthExpense: 600000,
  avgMonthlyIncome: 1000000,
  avgMonthlyExpense: 600000,
  categoriesThisMonth: [],
  accounts: [],
  debts: [],
  disponibleARS: 500000,
  invertidoARS: 0,
  netWorthARS: 1000000,
};

console.log("\n─── Gasto vs ingreso ───\n");

test("avisa si gastás más de lo que entra", () => {
  const r = recommendations({ ...base, monthIncome: 500000, monthExpense: 700000 });
  ok(has(r, "más de lo que entró"), "debería avisar del déficit");
});

console.log("\n─── Tasa de ahorro y recorte ───\n");

test("tasa de ahorro baja dispara aviso", () => {
  const r = recommendations({ ...base, monthIncome: 1000000, monthExpense: 950000 });
  ok(has(r, "ahorrando el 5%"), "5% de ahorro");
  ok(has(r, "colchón"), "menciona el colchón");
});

test("sugiere recorte concreto en la categoría discrecional más grande", () => {
  const r = recommendations({
    ...base,
    monthIncome: 1000000,
    monthExpense: 960000,
    categoriesThisMonth: [
      { name: "Ocio", amount: 200000 },
      { name: "Delivery", amount: 80000 },
      { name: "Alquiler", amount: 400000 },
    ],
  });
  // Ocio es la discrecional más grande → 15% de 200000 = 30000
  ok(has(r, "ocio"), "menciona ocio");
  ok(has(r, "30.000"), "sugiere el monto del recorte (15%)");
});

test("no toca categorías no discrecionales para el recorte", () => {
  const r = recommendations({
    ...base,
    monthIncome: 1000000,
    monthExpense: 960000,
    categoriesThisMonth: [{ name: "Alquiler", amount: 400000 }],
  });
  ok(!has(r, "recortando"), "alquiler no es recortable, no sugiere recorte");
});

console.log("\n─── Deudas y liquidez ───\n");

test("sugiere cancelar una deuda que entra en la mitad del disponible", () => {
  const r = recommendations({
    ...base,
    disponibleARS: 500000,
    debts: [{ name: "Celular", outstanding: 200000 }],
  });
  ok(has(r, "celular"), "menciona la deuda");
  ok(has(r, "cancelar"), "sugiere cancelarla");
});

test("NO sugiere cancelar una deuda que se comería la liquidez", () => {
  const r = recommendations({
    ...base,
    disponibleARS: 300000,
    debts: [{ name: "Auto", outstanding: 250000 }],
  });
  ok(!has(r, "auto"), "250k sobre 300k disponible es demasiado, no la sugiere");
});

console.log("\n─── Concentración de fondos ───\n");

test("avisa si una cuenta concentra más del 60%", () => {
  const r = recommendations({
    ...base,
    accounts: [
      { name: "Mercado Pago", balance: 700000 },
      { name: "Banco", balance: 300000 },
    ],
  });
  ok(has(r, "mercado pago"), "menciona la cuenta concentrada");
  ok(has(r, "diversificar"), "sugiere diversificar");
});

test("no avisa concentración si está repartido", () => {
  const r = recommendations({
    ...base,
    accounts: [
      { name: "A", balance: 500000 },
      { name: "B", balance: 500000 },
    ],
  });
  ok(!has(r, "concentra"), "50/50 no es concentración");
});

console.log("\n─── Suscripciones ───\n");

test("avisa si las suscripciones pesan más del 10% del ingreso", () => {
  const r = recommendations({
    ...base,
    monthIncome: 1000000,
    subscriptionsMonthly: 150000,
    subscriptionCount: 7,
  });
  ok(has(r, "suscripciones"), "menciona suscripciones");
  ok(has(r, "15%"), "el % del ingreso");
});

console.log("\n─── Exceso por categoría ───\n");

test("detecta gasto muy por encima del promedio de la categoría", () => {
  const r = recommendations({
    ...base,
    categoriesThisMonth: [{ name: "Comida", amount: 141000 }],
    categoryAverages: { Comida: 100000 },
  });
  ok(has(r, "comida"), "menciona la categoría");
  ok(has(r, "41%"), "el % por encima del promedio");
});

console.log("\n─── Proyección y refuerzo ───\n");

test("proyecta el cierre de año", () => {
  const r = recommendations({ ...base, projectedYearEndSavings: 3100000 });
  ok(has(r, "cerrás el año"), "proyección de cierre");
  ok(has(r, "3.100.000"), "el monto proyectado");
});

test("felicita si ahorra 20% o más", () => {
  const r = recommendations({ ...base, monthIncome: 1000000, monthExpense: 700000 });
  ok(has(r, "vas muy bien") || has(r, "sostené"), "refuerzo positivo");
});

test("vienen ordenadas por prioridad", () => {
  const r = recommendations({
    ...base,
    monthIncome: 1000000,
    monthExpense: 1100000, // déficit (prioridad 1)
    projectedYearEndSavings: -500000, // prioridad 9
  });
  ok(r.length >= 2, "hay varias");
  ok(r[0].priority <= r[r.length - 1].priority, "ordenadas asc por prioridad");
});

console.log(
  failures.length ? `\n❌ ${failures.length} fallaron, ${passed} pasaron\n` : `\n✅ Recomendaciones: ${passed} tests pasaron\n`
);
if (failures.length) process.exit(1);
