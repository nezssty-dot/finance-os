/**
 * Tests del resumen de actividad. Determinístico: se fija "ahora" para que las ventanas
 * (hoy/semana/mes) sean estables. Sin base ni red.
 */

import { activitySummary } from "../src/lib/activity";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e: any) { failures.push(name); console.log(`  ✗ ${name}\n      ${e.message}`); }
}
function eq(a: any, b: any, what: string) {
  if (a !== b) throw new Error(`${what}: esperaba ${JSON.stringify(b)}, obtuve ${JSON.stringify(a)}`);
}

// "Ahora" fijo: miércoles 15 de julio de 2026, 15:00. La semana (lunes) arranca el 13.
const NOW = new Date(2026, 6, 15, 15, 0, 0);

const inc = (date: Date, amount: number) => ({ date, type: "INCOME", amount });
const exp = (date: Date, amount: number) => ({ date, type: "EXPENSE", amount });

console.log("\n─── Ventana de HOY ───\n");

test("suma ingresos y gastos de hoy", () => {
  const s = activitySummary([
    inc(new Date(2026, 6, 15, 9, 0), 100000), // hoy
    exp(new Date(2026, 6, 15, 12, 0), 30000), // hoy
    inc(new Date(2026, 6, 14, 9, 0), 999), // ayer, no cuenta
  ], NOW);
  eq(s.todayIncome, 100000, "ingreso de hoy");
  eq(s.todayExpense, 30000, "gasto de hoy");
});

test("un movimiento de mañana no cuenta como hoy", () => {
  const s = activitySummary([exp(new Date(2026, 6, 16, 1, 0), 5000)], NOW);
  eq(s.todayExpense, 0, "mañana no es hoy");
});

console.log("\n─── Ventana de la SEMANA (lunes a hoy) ───\n");

test("la semana arranca el lunes", () => {
  const s = activitySummary([
    inc(new Date(2026, 6, 13, 10, 0), 50000), // lunes 13 → cuenta
    exp(new Date(2026, 6, 14, 10, 0), 20000), // martes 14 → cuenta
    inc(new Date(2026, 6, 12, 10, 0), 99999), // domingo 12 → NO (semana pasada)
  ], NOW);
  eq(s.weekIncome, 50000, "ingreso de la semana");
  eq(s.weekExpense, 20000, "gasto de la semana");
  eq(s.weekBalance, 30000, "balance semanal");
});

console.log("\n─── Ventana del MES ───\n");

test("suma todo el mes y calcula el balance", () => {
  const s = activitySummary([
    inc(new Date(2026, 6, 1, 10, 0), 500000), // 1 de julio
    exp(new Date(2026, 6, 5, 10, 0), 150000),
    exp(new Date(2026, 6, 15, 10, 0), 50000),
    inc(new Date(2026, 5, 30, 10, 0), 999999), // 30 de junio → NO
  ], NOW);
  eq(s.monthIncome, 500000, "ingreso del mes");
  eq(s.monthExpense, 200000, "gasto del mes");
  eq(s.monthBalance, 300000, "balance mensual");
});

console.log("\n─── Reglas ───\n");

test("transferencias y otros tipos no cuentan", () => {
  const s = activitySummary([
    { date: new Date(2026, 6, 15, 10, 0), type: "TRANSFER", amount: 100000 },
    { date: new Date(2026, 6, 15, 10, 0), type: "INVESTMENT", amount: 100000 },
    { date: new Date(2026, 6, 15, 10, 0), type: "INTERNAL", amount: 100000 },
  ], NOW);
  eq(s.todayIncome, 0, "sin ingresos");
  eq(s.todayExpense, 0, "sin gastos");
});

test("los montos se toman en valor absoluto (el signo lo da el tipo)", () => {
  const s = activitySummary([exp(new Date(2026, 6, 15, 10, 0), -45000)], NOW);
  eq(s.todayExpense, 45000, "gasto positivo aunque venga negativo");
});

test("lista vacía da todo en cero", () => {
  const s = activitySummary([], NOW);
  eq(s.monthBalance, 0, "cero");
  eq(s.todayIncome, 0, "cero");
});

console.log(
  failures.length ? `\n❌ ${failures.length} fallaron, ${passed} pasaron\n` : `\n✅ Resumen de actividad: ${passed} tests pasaron\n`
);
if (failures.length) process.exit(1);
