/**
 * Reinicio mensual de servicios.
 *
 * Regla que el usuario pidió explícitamente: cuando pago un servicio queda marcado como
 * pagado ESE mes, y al empezar un mes nuevo se "desmarca" solo para volver a pagarlo.
 *
 * En el código real esto NO necesita un proceso que desmarque: un servicio se considera
 * pagado solo si existe un pago cuya fecha de vencimiento (dueDate) cae dentro del mes que
 * se está mirando. Al cambiar de mes, el rango cambia y el pago del mes anterior queda
 * fuera. Este test blinda esa lógica de "¿está pagado en este período?".
 */

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  \u2713 ${name}`); }
  catch (e: any) { failures.push(name); console.log(`  \u2717 ${name}\n      ${e.message}`); }
}
function eq(a: any, b: any, what: string) {
  if (a !== b) throw new Error(`${what}: esperaba ${JSON.stringify(b)}, obtuve ${JSON.stringify(a)}`);
}

/** Réplica exacta de la lógica del servidor: ¿hay un pago con dueDate dentro del mes? */
function estaPagadoEnElMes(
  pagos: { dueDate: Date; paidAt: Date | null }[],
  mesInicio: Date,
  mesFin: Date
): boolean {
  return pagos.some(
    (p) => p.paidAt !== null && p.dueDate >= mesInicio && p.dueDate <= mesFin
  );
}

const bounds = (year: number, month0: number) => ({
  start: new Date(year, month0, 1, 0, 0, 0, 0),
  end: new Date(year, month0 + 1, 0, 23, 59, 59, 999),
});

console.log("\n\u2500\u2500\u2500 El pago cuenta en SU mes \u2500\u2500\u2500\n");

test("pagué el servicio en julio → aparece pagado en julio", () => {
  const pagos = [{ dueDate: new Date(2026, 6, 10), paidAt: new Date(2026, 6, 8) }];
  const jul = bounds(2026, 6);
  eq(estaPagadoEnElMes(pagos, jul.start, jul.end), true, "pagado en julio");
});

console.log("\n\u2500\u2500\u2500 EL REINICIO: el mes siguiente vuelve a pendiente \u2500\u2500\u2500\n");

test("ese mismo pago de julio NO cuenta en agosto (se desmarca solo)", () => {
  const pagos = [{ dueDate: new Date(2026, 6, 10), paidAt: new Date(2026, 6, 8) }];
  const ago = bounds(2026, 7);
  eq(estaPagadoEnElMes(pagos, ago.start, ago.end), false, "en agosto ya NO está pagado");
});

test("al pagar de nuevo en agosto, vuelve a contar en agosto", () => {
  const pagos = [
    { dueDate: new Date(2026, 6, 10), paidAt: new Date(2026, 6, 8) },  // julio
    { dueDate: new Date(2026, 7, 10), paidAt: new Date(2026, 7, 9) },  // agosto
  ];
  const ago = bounds(2026, 7);
  eq(estaPagadoEnElMes(pagos, ago.start, ago.end), true, "pagado en agosto");
});

console.log("\n\u2500\u2500\u2500 Casos borde \u2500\u2500\u2500\n");

test("un vencimiento registrado pero SIN pagar no cuenta como pagado", () => {
  const pagos = [{ dueDate: new Date(2026, 6, 10), paidAt: null }];
  const jul = bounds(2026, 6);
  eq(estaPagadoEnElMes(pagos, jul.start, jul.end), false, "no pagado");
});

test("el pago del día 1 del mes cuenta (borde inferior)", () => {
  const pagos = [{ dueDate: new Date(2026, 6, 1), paidAt: new Date(2026, 6, 1) }];
  const jul = bounds(2026, 6);
  eq(estaPagadoEnElMes(pagos, jul.start, jul.end), true, "día 1 incluido");
});

test("el pago del último día del mes cuenta (borde superior)", () => {
  const pagos = [{ dueDate: new Date(2026, 6, 31), paidAt: new Date(2026, 6, 31) }];
  const jul = bounds(2026, 6);
  eq(estaPagadoEnElMes(pagos, jul.start, jul.end), true, "día 31 incluido");
});

test("sin pagos, nunca está pagado", () => {
  const jul = bounds(2026, 6);
  eq(estaPagadoEnElMes([], jul.start, jul.end), false, "vacío");
});

console.log(
  failures.length ? `\n\u274c ${failures.length} fallaron, ${passed} pasaron\n` : `\n\u2705 Reinicio mensual de servicios: ${passed} tests pasaron\n`
);
if (failures.length) process.exit(1);
