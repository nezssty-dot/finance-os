/**
 * Tests del desglose de inversiones por tipo. Determinístico, sin base ni red.
 */

import { assetType, groupByAssetType } from "../src/lib/portfolio-breakdown";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e: any) { failures.push(name); console.log(`  ✗ ${name}\n      ${e.message}`); }
}
function eq(a: any, b: any, what: string) {
  if (a !== b) throw new Error(`${what}: esperaba ${JSON.stringify(b)}, obtuve ${JSON.stringify(a)}`);
}
function near(a: number, b: number, what: string, tol = 0.05) {
  if (Math.abs(a - b) > tol) throw new Error(`${what}: esperaba ~${b}, obtuve ${a}`);
}

console.log("\n─── assetType: mapea kinds de IOL y manuales ───\n");

test("kinds de IOL", () => {
  eq(assetType("Acciones"), "Acciones", "acciones");
  eq(assetType("CEDEARs"), "CEDEARs", "cedears");
  eq(assetType("Bonos"), "Bonos", "bonos");
  eq(assetType("Obligaciones Negociables"), "Renta fija", "ON");
  eq(assetType("Fondos Comunes"), "Renta fija", "FCI");
  eq(assetType("Cauciones"), "Renta fija", "cauciones");
});

test("kinds manuales", () => {
  eq(assetType("STOCK"), "Acciones", "stock");
  eq(assetType("FIXED_TERM"), "Renta fija", "plazo fijo");
  eq(assetType("FUND"), "Renta fija", "fund");
  eq(assetType("BTC"), "Crypto", "btc");
  eq(assetType("ETH"), "Crypto", "eth");
  eq(assetType("USDT"), "Crypto", "usdt");
  eq(assetType("USD"), "Efectivo", "dólares");
  eq(assetType("PESOS"), "Efectivo", "pesos");
  eq(assetType("ETF"), "ETF", "etf");
});

test("kind desconocido cae en Otro", () => {
  eq(assetType("algo raro"), "Otro", "desconocido");
});

console.log("\n─── groupByAssetType: agrupa y calcula % ───\n");

test("agrupa por tipo y suma valores", () => {
  const g = groupByAssetType([
    { kind: "Acciones", currentValue: 500000 },
    { kind: "Acciones", currentValue: 300000 },
    { kind: "CEDEARs", currentValue: 200000 },
  ]);
  eq(g.length, 2, "dos grupos");
  const acciones = g.find((x) => x.type === "Acciones");
  eq(acciones?.value, 800000, "acciones sumadas");
  eq(acciones?.count, 2, "dos posiciones de acciones");
});

test("los porcentajes suman ~100", () => {
  const g = groupByAssetType([
    { kind: "Acciones", currentValue: 600000 },
    { kind: "Bonos", currentValue: 300000 },
    { kind: "CEDEARs", currentValue: 100000 },
  ]);
  // 60% / 30% / 10%
  near(g.find((x) => x.type === "Acciones")!.pct, 60, "acciones 60%");
  near(g.find((x) => x.type === "Bonos")!.pct, 30, "bonos 30%");
  near(g.find((x) => x.type === "CEDEARs")!.pct, 10, "cedears 10%");
  const totalPct = g.reduce((s, x) => s + x.pct, 0);
  near(totalPct, 100, "los % suman 100");
});

test("viene ordenado de mayor a menor valor", () => {
  const g = groupByAssetType([
    { kind: "CEDEARs", currentValue: 100000 },
    { kind: "Acciones", currentValue: 500000 },
    { kind: "Bonos", currentValue: 300000 },
  ]);
  eq(g[0].type, "Acciones", "primero acciones");
  eq(g[1].type, "Bonos", "segundo bonos");
  eq(g[2].type, "CEDEARs", "tercero cedears");
});

test("mezcla IOL y manual bajo la misma categoría", () => {
  // "Acciones" (IOL) y STOCK (manual) son la misma categoría.
  const g = groupByAssetType([
    { kind: "Acciones", currentValue: 400000 },
    { kind: "STOCK", currentValue: 100000 },
  ]);
  eq(g.length, 1, "un solo grupo Acciones");
  eq(g[0].value, 500000, "sumadas juntas");
});

test("lista vacía no rompe", () => {
  const g = groupByAssetType([]);
  eq(g.length, 0, "sin grupos");
});

console.log(
  failures.length ? `\n❌ ${failures.length} fallaron, ${passed} pasaron\n` : `\n✅ Desglose por tipo: ${passed} tests pasaron\n`
);
if (failures.length) process.exit(1);
