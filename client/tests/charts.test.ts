/**
 * Tests de los generadores de gráficos SVG del PDF. Puros: entra data, sale un string.
 * Lo que importa verificar: que las proporciones sean correctas (un gráfico que miente
 * es peor que no tenerlo) y que no rompa con datos raros.
 */

import { donutChart, barChart, incomeVsExpenseBar, escapeSvg } from "../src/lib/charts.ts";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  \u2713 ${name}`); }
  catch (e) { failures.push(name); console.log(`  \u2717 ${name}\n      ${(e as Error).message}`); }
}
function eq(a: unknown, b: unknown, what: string) {
  if (a !== b) throw new Error(`${what}: esperaba ${JSON.stringify(b)}, obtuve ${JSON.stringify(a)}`);
}
function ok(cond: boolean, what: string) {
  if (!cond) throw new Error(what);
}

console.log("\n\u2500\u2500\u2500 Dona \u2500\u2500\u2500\n");

test("genera un SVG con un arco por categoría", () => {
  const svg = donutChart([
    { label: "Comida", value: 50, color: "#f00" },
    { label: "Transporte", value: 50, color: "#0f0" },
  ]);
  ok(svg.startsWith("<svg"), "es un SVG");
  eq((svg.match(/<circle/g) || []).length, 2, "dos arcos");
});

test("las proporciones son correctas (mitad y mitad = arcos iguales)", () => {
  const svg = donutChart([
    { label: "A", value: 100, color: "#f00" },
    { label: "B", value: 100, color: "#0f0" },
  ]);
  const dashes = [...svg.matchAll(/stroke-dasharray="([\d.]+)/g)].map((m) => Number(m[1]));
  eq(dashes.length, 2, "dos dasharray");
  ok(Math.abs(dashes[0] - dashes[1]) < 0.01, "los dos arcos miden lo mismo");
});

test("una porción de 75% ocupa 3/4 de la circunferencia", () => {
  const svg = donutChart([
    { label: "A", value: 75, color: "#f00" },
    { label: "B", value: 25, color: "#0f0" },
  ]);
  const dashes = [...svg.matchAll(/stroke-dasharray="([\d.]+) ([\d.]+)/g)];
  const first = Number(dashes[0][1]);
  const total = first + Number(dashes[0][2]);
  ok(Math.abs(first / total - 0.75) < 0.001, "la primera ocupa 75%");
});

test("sin datos válidos devuelve vacío (no dibuja un gráfico falso)", () => {
  eq(donutChart([]), "", "vacío");
  eq(donutChart([{ label: "A", value: 0, color: "#f00" }]), "", "todo en cero");
});

test("ignora valores negativos o inválidos", () => {
  const svg = donutChart([
    { label: "A", value: 100, color: "#f00" },
    { label: "B", value: -50, color: "#0f0" },
    { label: "C", value: NaN, color: "#00f" },
  ]);
  eq((svg.match(/<circle/g) || []).length, 1, "solo el válido");
});

test("acepta una etiqueta central", () => {
  const svg = donutChart([{ label: "A", value: 10, color: "#f00" }], { centerLabel: "Julio" });
  ok(svg.includes("Julio"), "muestra la etiqueta");
});

console.log("\n\u2500\u2500\u2500 Barras \u2500\u2500\u2500\n");

test("genera una fila por item", () => {
  const svg = barChart([
    { label: "Comida", value: 100, color: "#f00" },
    { label: "Salud", value: 50, color: "#0f0" },
  ]);
  eq((svg.match(/<g transform/g) || []).length, 2, "dos filas");
});

test("la barra más grande es el doble que una de la mitad", () => {
  const svg = barChart([
    { label: "A", value: 100, color: "#f00" },
    { label: "B", value: 50, color: "#0f0" },
  ], { width: 500 });
  // El segundo rect de cada fila es la barra llena
  const widths = [...svg.matchAll(/rx="5\.5" fill="#[0-9a-f]{3,6}" \/>/g)];
  const barWidths = [...svg.matchAll(/width="([\d.]+)" height="11" rx="5\.5" fill="#(?!f1f1f3)/g)]
    .map((m) => Number(m[1]));
  ok(barWidths.length === 2, "dos barras llenas");
  ok(Math.abs(barWidths[0] / barWidths[1] - 2) < 0.05, "la primera es el doble");
  void widths;
});

test("muestra el monto formateado", () => {
  const svg = barChart([{ label: "A", value: 1234, color: "#f00" }], {
    formatValue: (n) => `$ ${n}`,
  });
  ok(svg.includes("$ 1234"), "monto formateado");
});

test("sin datos devuelve vacío", () => {
  eq(barChart([]), "", "vacío");
});

console.log("\n\u2500\u2500\u2500 Ingresos vs gastos \u2500\u2500\u2500\n");

test("dibuja las dos barras", () => {
  const svg = incomeVsExpenseBar(100000, 60000);
  ok(svg.includes("Ingresos"), "ingresos");
  ok(svg.includes("Gastos"), "gastos");
});

test("no rompe con todo en cero", () => {
  const svg = incomeVsExpenseBar(0, 0);
  ok(svg.startsWith("<svg"), "sigue siendo un SVG válido");
});

console.log("\n\u2500\u2500\u2500 Seguridad del SVG \u2500\u2500\u2500\n");

test("escapa caracteres que romperían el SVG", () => {
  eq(escapeSvg('Bar & <Grill>'), "Bar &amp; &lt;Grill&gt;", "escapado");
});

test("un nombre de categoría con & no rompe el gráfico", () => {
  const svg = barChart([{ label: "Bar & Resto", value: 10, color: "#f00" }]);
  ok(svg.includes("&amp;"), "escapado dentro del SVG");
  ok(!svg.includes("Bar & Resto"), "no queda el & crudo");
});

console.log(
  failures.length ? `\n\u274c ${failures.length} fallaron, ${passed} pasaron\n` : `\n\u2705 Gráficos SVG: ${passed} tests pasaron\n`
);
if (failures.length) process.exit(1);
