/**
 * Tests del motor de cotización del dólar. Determinístico, sin base ni red: se le pasan
 * respuestas de la fuente ya capturadas y se verifica el parseo, la cascada de respaldo,
 * la frescura y —lo más importante— que NUNCA invente un tipo de cambio.
 */

import {
  parseQuotes, pickQuote, rateOf, isStale, convert, totalIn,
} from "../src/lib/fx";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e: any) { failures.push(name); console.log(`  ✗ ${name}\n      ${e.message}`); }
}
function eq(a: any, b: any, what: string) {
  if (a !== b) throw new Error(`${what}: esperaba ${JSON.stringify(b)}, obtuve ${JSON.stringify(a)}`);
}

// Respuesta real de la fuente pública (recortada). Ojo: el MEP viene como casa "bolsa".
const PAYLOAD = [
  { moneda: "USD", casa: "oficial", nombre: "Oficial", compra: 1000, venta: 1050, fechaActualizacion: "2026-07-18T14:00:00.000Z" },
  { moneda: "USD", casa: "blue", nombre: "Blue", compra: 1300, venta: 1330, fechaActualizacion: "2026-07-18T14:00:00.000Z" },
  { moneda: "USD", casa: "bolsa", nombre: "Bolsa", compra: 1280, venta: 1295, fechaActualizacion: "2026-07-18T14:00:00.000Z" },
];

console.log("\n─── parseQuotes ───\n");

test("reconoce el MEP aunque la fuente lo llame 'bolsa'", () => {
  const q = parseQuotes(PAYLOAD);
  const mep = q.find((x) => x.kind === "MEP");
  eq(mep?.sell, 1295, "venta del MEP");
  eq(mep?.buy, 1280, "compra del MEP");
});

test("lee las tres cotizaciones", () => {
  eq(parseQuotes(PAYLOAD).length, 3, "cantidad");
});

test("ignora entradas sin precio (no guarda ceros)", () => {
  const q = parseQuotes([{ casa: "oficial", compra: null, venta: null }]);
  eq(q.length, 0, "descartada");
});

test("ignora casas desconocidas en vez de romper", () => {
  const q = parseQuotes([{ casa: "inventada", venta: 999 }]);
  eq(q.length, 0, "descartada");
});

test("una respuesta rota no tira excepción", () => {
  eq(parseQuotes(null).length, 0, "vacío");
  eq(parseQuotes("texto").length, 0, "vacío");
  eq(parseQuotes([null, 5, "x"]).length, 0, "vacío");
});

console.log("\n─── pickQuote: cascada de respaldo ───\n");

test("prefiere MEP cuando está", () => {
  eq(pickQuote(parseQuotes(PAYLOAD))?.kind, "MEP", "elegida");
});

test("si no hay MEP, cae al siguiente disponible (oficial)", () => {
  const soloOficial = parseQuotes([PAYLOAD[0]]);
  eq(pickQuote(soloOficial)?.kind, "OFICIAL", "fallback");
});

test("sin ninguna cotización devuelve null (no inventa)", () => {
  eq(pickQuote([]), null, "null");
});

test("rateOf usa la venta; si falta, la compra", () => {
  eq(rateOf({ kind: "MEP", buy: 1280, sell: 1295, date: new Date(), source: "x" }), 1295, "venta");
  eq(rateOf({ kind: "MEP", buy: 1280, sell: null, date: new Date(), source: "x" }), 1280, "compra");
  eq(rateOf(null), null, "sin cotización");
});

console.log("\n─── isStale: se refresca una vez por día ───\n");

const HOY = new Date(2026, 6, 18, 15, 0);

test("una cotización de hoy NO está vieja", () => {
  eq(isStale(new Date(2026, 6, 18, 9, 0), HOY), false, "fresca");
});

test("una de ayer SÍ está vieja", () => {
  eq(isStale(new Date(2026, 6, 17, 23, 59), HOY), true, "vieja");
});

test("sin fecha se considera vieja (hay que traerla)", () => {
  eq(isStale(null, HOY), true, "vieja");
});

console.log("\n─── convert: NUNCA inventa un tipo de cambio ───\n");

test("ARS a USD divide por la cotización", () => {
  eq(convert(1295000, "ARS", "USD", 1295), 1000, "usd");
});

test("USD a ARS multiplica", () => {
  eq(convert(1000, "USD", "ARS", 1295), 1295000, "ars");
});

test("misma moneda devuelve el monto tal cual", () => {
  eq(convert(5000, "ARS", "ARS", null), 5000, "sin tocar");
});

test("SIN cotización devuelve null, no un número inventado", () => {
  eq(convert(1000, "USD", "ARS", null), null, "null");
  eq(convert(1000, "USD", "ARS", 0), null, "null con tasa cero");
});

test("un par sin cotización propia (EUR) no se adivina", () => {
  eq(convert(1000, "EUR", "ARS", 1295), null, "null");
});

console.log("\n─── totalIn: patrimonio en una sola moneda ───\n");

test("suma pesos y dólares convertidos", () => {
  const r = totalIn({ ARS: 9500000, USD: 7100 }, "ARS", 1295);
  eq(r.total, 9500000 + 7100 * 1295, "total en pesos");
  eq(r.converted, true, "todo convertido");
});

test("avisa cuando quedó algo sin convertir (total incompleto)", () => {
  const r = totalIn({ ARS: 100000, EUR: 500 }, "ARS", 1295);
  eq(r.total, 100000, "solo lo convertible");
  eq(r.converted, false, "marca que está incompleto");
});

test("sin cotización, el total en la otra moneda queda incompleto", () => {
  const r = totalIn({ ARS: 100000, USD: 50 }, "USD", null);
  eq(r.converted, false, "incompleto");
  eq(r.total, 50, "solo lo que ya estaba en USD");
});

console.log(
  failures.length ? `\n❌ ${failures.length} fallaron, ${passed} pasaron\n` : `\n✅ Cotización del dólar: ${passed} tests pasaron\n`
);
if (failures.length) process.exit(1);
