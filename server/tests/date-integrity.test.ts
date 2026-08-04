/**
 * Integridad de fechas al importar. BUG CRÍTICO que este test blinda:
 *
 * El parser creaba las fechas con Date.UTC. El 01/07/2026 quedaba como
 * 2026-07-01T00:00:00Z y, leído en Argentina (UTC-3), daba "30 de junio 21:00": el
 * movimiento se iba al MES ANTERIOR y descuadraba todo el balance mensual.
 *
 * Estos tests verifican la invariante que importa: el día que dice el archivo es el día
 * que queda guardado, y el mes con el que se agrupa es el mes del archivo. Se cumple en
 * CUALQUIER zona horaria. Si alguien vuelve a UTC, estos tests fallan.
 */

import { analyze, parseAmount } from "../src/integrations/import/statement";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  \u2713 ${name}`); }
  catch (e: any) { failures.push(name); console.log(`  \u2717 ${name}\n      ${e.message}`); }
}
function eq(a: any, b: any, what: string) {
  if (a !== b) throw new Error(`${what}: esperaba ${JSON.stringify(b)}, obtuve ${JSON.stringify(a)}`);
}

const MESES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

/** Importa un CSV mínimo y devuelve la fecha de la primera fila. */
function fechaDe(csv: string): Date {
  const r = analyze(csv);
  if (!r.rows.length) throw new Error(`No se importó ninguna fila. Rechazadas: ${JSON.stringify(r.rejected)}`);
  return r.rows[0].date;
}

console.log(`\n\u2500\u2500\u2500 Zona horaria del entorno: ${Intl.DateTimeFormat().resolvedOptions().timeZone} \u2500\u2500\u2500`);
console.log("\n\u2500\u2500\u2500 EL BUG: el d\u00eda 1 no puede caer en el mes anterior \u2500\u2500\u2500\n");

test("01/07/2026 queda en JULIO, nunca en junio", () => {
  const d = fechaDe("Fecha;Descripcion;Importe\n01/07/2026;Sueldo;100000");
  eq(d.getDate(), 1, "d\u00eda");
  eq(MESES[d.getMonth()], "jul", "mes");
  eq(d.getFullYear(), 2026, "a\u00f1o");
});

test("el primer d\u00eda de CADA mes se mantiene en su mes", () => {
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, "0");
    const d = fechaDe(`Fecha;Descripcion;Importe\n01/${mm}/2026;Test;1000`);
    eq(d.getDate(), 1, `d\u00eda del mes ${mm}`);
    eq(d.getMonth(), m - 1, `mes ${mm} se mantiene`);
  }
});

test("el \u00daLTIMO d\u00eda del mes tampoco se corre al siguiente", () => {
  const d = fechaDe("Fecha;Descripcion;Importe\n31/12/2026;Fin de a\u00f1o;5000");
  eq(d.getDate(), 31, "d\u00eda");
  eq(MESES[d.getMonth()], "dic", "sigue en diciembre");
  eq(d.getFullYear(), 2026, "no salta a 2027");
});

test("1 de enero no se va al a\u00f1o anterior", () => {
  const d = fechaDe("Fecha;Descripcion;Importe\n01/01/2026;A\u00f1o nuevo;1000");
  eq(d.getFullYear(), 2026, "a\u00f1o");
  eq(MESES[d.getMonth()], "ene", "enero");
  eq(d.getDate(), 1, "d\u00eda 1");
});

console.log("\n\u2500\u2500\u2500 La hora guardada es medianoche LOCAL \u2500\u2500\u2500\n");

test("la fecha queda a las 00:00 hora local (no a las 21:00 del d\u00eda anterior)", () => {
  const d = fechaDe("Fecha;Descripcion;Importe\n15/07/2026;Test;1000");
  eq(d.getHours(), 0, "hora");
  eq(d.getMinutes(), 0, "minutos");
});

console.log("\n\u2500\u2500\u2500 Otros formatos de fecha, misma garant\u00eda \u2500\u2500\u2500\n");

test("formato ISO (2026-07-01) tambi\u00e9n queda en julio", () => {
  const d = fechaDe("date,description,amount\n2026-07-01,Test,1000");
  eq(d.getDate(), 1, "d\u00eda");
  eq(MESES[d.getMonth()], "jul", "julio");
});

test("fecha con nombre de mes (1 de julio de 2026) queda en julio", () => {
  const d = fechaDe("Fecha;Descripcion;Importe\n1 de julio de 2026;Test;1000");
  eq(d.getDate(), 1, "d\u00eda");
  eq(MESES[d.getMonth()], "jul", "julio");
});

console.log("\n\u2500\u2500\u2500 Agrupado mensual: la fecha cae dentro de su mes \u2500\u2500\u2500\n");

test("el 1 del mes cae DENTRO del rango de ese mes (como lo calcula la app)", () => {
  const d = fechaDe("Fecha;Descripcion;Importe\n01/07/2026;Test;1000");
  // Mismo c\u00e1lculo que monthBounds: hora local
  const start = new Date(2026, 6, 1, 0, 0, 0, 0);
  const end = new Date(2026, 7, 0, 23, 59, 59, 999);
  eq(d >= start && d <= end, true, "cae dentro de julio");
});

test("el 1 del mes NO cae en el rango del mes anterior", () => {
  const d = fechaDe("Fecha;Descripcion;Importe\n01/07/2026;Test;1000");
  const junStart = new Date(2026, 5, 1, 0, 0, 0, 0);
  const junEnd = new Date(2026, 6, 0, 23, 59, 59, 999);
  eq(d >= junStart && d <= junEnd, false, "NO cae en junio");
});

console.log("\n\u2500\u2500\u2500 Montos: todos los formatos del sprint \u2500\u2500\u2500\n");

const montos: [string, "," | ".", number][] = [
  ["$50.000", ",", 50000], ["$ 50.000", ",", 50000], ["50.000", ",", 50000], ["50000", ",", 50000],
  ["US$ 25", ",", 25], ["USD 25", ",", 25], ["25 USD", ",", 25],
  ["1.250.000", ",", 1250000], ["1250000", ",", 1250000],
  ["-25000", ",", -25000], ["+45000", ",", 45000],
  ["1.234,56", ",", 1234.56], ["1,234.56", ".", 1234.56],
  ["(1.500)", ",", -1500], ["1.500-", ",", -1500],
];
for (const [txt, dec, esperado] of montos) {
  test(`"${txt}" \u2192 ${esperado}`, () => {
    eq(parseAmount(txt, dec), esperado, "monto");
  });
}

test("el importe NO se redondea: los centavos se conservan", () => {
  eq(parseAmount("1.234,56", ","), 1234.56, "con centavos");
  eq(parseAmount("0,01", ","), 0.01, "un centavo");
});

console.log(
  failures.length ? `\n\u274c ${failures.length} fallaron, ${passed} pasaron\n` : `\n\u2705 Integridad de fechas: ${passed} tests pasaron\n`
);
if (failures.length) process.exit(1);
