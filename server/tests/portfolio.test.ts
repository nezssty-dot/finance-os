/**
 * Tests de la reconstrucción de cartera.
 *
 * El foco está en la matemática de costo promedio y ganancia realizada — donde un error
 * corrompe tu patrimonio en silencio. Todo determinístico, con operaciones fijas.
 * Sin red, sin base, sin API de IOL.
 */

import { reconstructPortfolio, unrealizedPnL, type Operation } from "../src/lib/portfolio";
import { mapOperations, classifyOperation } from "../src/integrations/providers/iol/mapping";

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
function near(a: number, b: number, what: string, tol = 0.01) {
  if (Math.abs(a - b) > tol) throw new Error(`${what}: esperaba ~${b}, obtuve ${a}`);
}

let opId = 0;
function op(over: Partial<Operation>): Operation {
  return {
    id: `op${opId++}`,
    type: "BUY",
    date: new Date(2025, 0, 1),
    symbol: "GGAL",
    quantity: 0,
    price: 0,
    amount: 0,
    currency: "ARS",
    ...over,
  };
}

console.log("\n─── Costo promedio ponderado ───\n");

test("una sola compra fija el PPC y el costo", () => {
  const r = reconstructPortfolio([
    op({ type: "BUY", symbol: "GGAL", quantity: 100, price: 500, amount: 50000 }),
  ]);
  eq(r.positions.length, 1, "una posición abierta");
  const p = r.positions[0];
  eq(p.quantity, 100, "cantidad");
  near(p.avgCost, 500, "PPC");
  near(p.costBasis, 50000, "costo");
  near(r.investedByCurrency.ARS, 50000, "invertido ARS");
});

test("dos compras a distinto precio promedian ponderado", () => {
  // 100 @ 500 = 50000, después 100 @ 700 = 70000. Total 200 nominales, 120000 → PPC 600.
  const r = reconstructPortfolio([
    op({ type: "BUY", quantity: 100, price: 500, amount: 50000, date: new Date(2025, 0, 1) }),
    op({ type: "BUY", quantity: 100, price: 700, amount: 70000, date: new Date(2025, 0, 2) }),
  ]);
  const p = r.positions[0];
  eq(p.quantity, 200, "cantidad");
  near(p.avgCost, 600, "PPC ponderado");
  near(p.costBasis, 120000, "costo");
});

test("comprar más caro sube el PPC; el orden cronológico manda", () => {
  // Mismas ops, cargadas en orden inverso: el resultado debe ser idéntico (se ordenan).
  const r = reconstructPortfolio([
    op({ type: "BUY", quantity: 100, price: 700, amount: 70000, date: new Date(2025, 0, 2) }),
    op({ type: "BUY", quantity: 100, price: 500, amount: 50000, date: new Date(2025, 0, 1) }),
  ]);
  near(r.positions[0].avgCost, 600, "PPC igual sin importar el orden de carga");
});

console.log("\n─── Ventas y ganancia realizada ───\n");

test("vender parte realiza ganancia y NO cambia el PPC", () => {
  // Compro 100 @ 500. Vendo 40 @ 800 → realizada (800-500)×40 = 12000. Quedan 60 @ 500.
  const r = reconstructPortfolio([
    op({ type: "BUY", quantity: 100, price: 500, amount: 50000, date: new Date(2025, 0, 1) }),
    op({ type: "SELL", quantity: 40, price: 800, amount: 32000, date: new Date(2025, 0, 5) }),
  ]);
  const p = r.positions[0];
  eq(p.quantity, 60, "cantidad restante");
  near(p.avgCost, 500, "PPC no cambia al vender");
  near(p.realizedPnL, 12000, "ganancia realizada");
  near(r.realizedByCurrency.ARS, 12000, "realizada total ARS");
  near(p.costBasis, 30000, "costo de lo que queda");
});

test("vender con pérdida da realizada negativa", () => {
  const r = reconstructPortfolio([
    op({ type: "BUY", quantity: 100, price: 500, amount: 50000, date: new Date(2025, 0, 1) }),
    op({ type: "SELL", quantity: 50, price: 400, amount: 20000, date: new Date(2025, 0, 5) }),
  ]);
  near(r.positions[0].realizedPnL, -5000, "pérdida realizada (400-500)×50");
});

test("vender todo cierra la posición y resetea el PPC", () => {
  const r = reconstructPortfolio([
    op({ type: "BUY", quantity: 100, price: 500, amount: 50000, date: new Date(2025, 0, 1) }),
    op({ type: "SELL", quantity: 100, price: 900, amount: 90000, date: new Date(2025, 0, 5) }),
  ]);
  eq(r.positions.length, 0, "sin posiciones abiertas");
  eq(r.closedPositions.length, 1, "una posición cerrada");
  near(r.closedPositions[0].realizedPnL, 40000, "realizada (900-500)×100");
  eq(r.investedByCurrency.ARS ?? 0, 0, "nada invertido");
});

test("comprar, vender todo, y volver a comprar arranca un PPC nuevo", () => {
  const r = reconstructPortfolio([
    op({ type: "BUY", quantity: 100, price: 500, amount: 50000, date: new Date(2025, 0, 1) }),
    op({ type: "SELL", quantity: 100, price: 900, amount: 90000, date: new Date(2025, 0, 5) }),
    op({ type: "BUY", quantity: 50, price: 1000, amount: 50000, date: new Date(2025, 0, 10) }),
  ]);
  eq(r.positions.length, 1, "posición reabierta");
  eq(r.positions[0].quantity, 50, "cantidad nueva");
  near(r.positions[0].avgCost, 1000, "PPC del nuevo lote, sin arrastrar el viejo");
  near(r.positions[0].realizedPnL, 40000, "la realizada del ciclo anterior se conserva");
});

test("no se puede vender más de lo que se tiene (historial incompleto): se acota", () => {
  const r = reconstructPortfolio([
    op({ type: "BUY", quantity: 30, price: 500, amount: 15000, date: new Date(2025, 0, 1) }),
    op({ type: "SELL", quantity: 100, price: 800, amount: 80000, date: new Date(2025, 0, 5) }),
  ]);
  // Solo se venden 30 (lo que había). No quedan cantidades negativas.
  eq(r.positions.length, 0, "posición cerrada, no negativa");
  near(r.closedPositions[0].realizedPnL, 9000, "realizada solo sobre lo que había (800-500)×30");
});

console.log("\n─── Dividendos, intereses, cupones (plata que entra) ───\n");

test("dividendos cuentan como renta, no como venta, y no tocan la posición", () => {
  const r = reconstructPortfolio([
    op({ type: "BUY", quantity: 100, price: 500, amount: 50000, date: new Date(2025, 0, 1) }),
    op({ type: "DIVIDEND", symbol: "GGAL", quantity: 0, price: 0, amount: 3000, date: new Date(2025, 0, 15) }),
  ]);
  eq(r.positions[0].quantity, 100, "la cantidad no cambia");
  near(r.positions[0].incomeReceived, 3000, "dividendo imputado al activo");
  near(r.incomeByCurrency.ARS, 3000, "renta total ARS");
  // Y en el ledger es un INCOME, no un INVESTMENT.
  const div = r.ledger.find((e) => e.description.includes("Dividendos"));
  eq(div?.kind, "INCOME", "el dividendo va como INCOME al ledger");
  eq(div!.signedAmount > 0, true, "entra plata");
});

test("intereses y cupones también son renta", () => {
  const r = reconstructPortfolio([
    op({ type: "INTEREST", symbol: "AL30", quantity: 0, price: 0, amount: 1200, currency: "USD", date: new Date(2025, 0, 10) }),
    op({ type: "COUPON", symbol: "AL30", quantity: 0, price: 0, amount: 800, currency: "USD", date: new Date(2025, 0, 20) }),
  ]);
  near(r.incomeByCurrency.USD, 2000, "renta en USD");
});

console.log("\n─── Monedas separadas ───\n");

test("un activo en USD y otro en ARS no se mezclan", () => {
  const r = reconstructPortfolio([
    op({ type: "BUY", symbol: "GGAL", quantity: 100, price: 500, amount: 50000, currency: "ARS", date: new Date(2025, 0, 1) }),
    op({ type: "BUY", symbol: "AAPL", quantity: 10, price: 150, amount: 1500, currency: "USD", date: new Date(2025, 0, 2) }),
  ]);
  eq(r.positions.length, 2, "dos posiciones");
  near(r.investedByCurrency.ARS, 50000, "invertido ARS");
  near(r.investedByCurrency.USD, 1500, "invertido USD");
});

test("el mismo ticker en ARS y en USD son posiciones distintas", () => {
  const r = reconstructPortfolio([
    op({ type: "BUY", symbol: "AL30", quantity: 100, price: 800, amount: 80000, currency: "ARS", date: new Date(2025, 0, 1) }),
    op({ type: "BUY", symbol: "AL30", quantity: 50, price: 30, amount: 1500, currency: "USD", date: new Date(2025, 0, 2) }),
  ]);
  eq(r.positions.length, 2, "AL30 pesos y AL30 dólares por separado");
});

console.log("\n─── Ledger: cada operación es un movimiento con su fecha ───\n");

test("compras y ventas van como INVESTMENT (no como gasto/ingreso)", () => {
  const r = reconstructPortfolio([
    op({ type: "BUY", quantity: 100, price: 500, amount: 50000, date: new Date(2025, 0, 1) }),
    op({ type: "SELL", quantity: 100, price: 900, amount: 90000, date: new Date(2025, 0, 5) }),
  ]);
  const buys = r.ledger.filter((e) => e.kind === "INVESTMENT");
  eq(buys.length, 2, "compra y venta son INVESTMENT");
  const buy = r.ledger.find((e) => e.description.startsWith("Compra"));
  eq(buy!.signedAmount < 0, true, "la compra saca plata");
  const sell = r.ledger.find((e) => e.description.startsWith("Venta"));
  eq(sell!.signedAmount > 0, true, "la venta trae plata");
});

test("el ledger conserva la fecha original de cada operación", () => {
  const d1 = new Date(2023, 5, 15);
  const r = reconstructPortfolio([
    op({ type: "BUY", quantity: 10, price: 100, amount: 1000, date: d1 }),
  ]);
  eq(r.ledger[0].date.getTime(), d1.getTime(), "fecha histórica preservada");
});

test("el ledger está en orden cronológico", () => {
  const r = reconstructPortfolio([
    op({ type: "SELL", quantity: 10, price: 100, amount: 1000, date: new Date(2025, 5, 1) }),
    op({ type: "BUY", quantity: 10, price: 80, amount: 800, date: new Date(2025, 0, 1) }),
  ]);
  eq(r.ledger[0].date < r.ledger[1].date, true, "ordenado por fecha");
});

console.log("\n─── Ganancia no realizada ───\n");

test("unrealizedPnL usa el precio actual contra el PPC", () => {
  // 100 nominales, PPC 500, precio actual 650 → no realizada (650-500)×100 = 15000.
  near(unrealizedPnL({ quantity: 100, avgCost: 500 }, 650), 15000, "no realizada");
});

test("unrealizedPnL negativa cuando el precio cayó", () => {
  near(unrealizedPnL({ quantity: 100, avgCost: 500 }, 450), -5000, "no realizada negativa");
});

console.log("\n─── Robustez ───\n");

test("lista vacía no rompe", () => {
  const r = reconstructPortfolio([]);
  eq(r.positions.length, 0, "sin posiciones");
  eq(r.ledger.length, 0, "sin ledger");
});

test("una operación desconocida entra al ledger sin romper la cartera", () => {
  const r = reconstructPortfolio([
    op({ type: "ADJUSTMENT", symbol: null, quantity: 0, price: 0, amount: 500, date: new Date(2025, 0, 1) }),
  ]);
  eq(r.positions.length, 0, "no crea posición");
  eq(r.ledger.length, 1, "queda registrada para revisar");
});

console.log(
  failures.length
    ? `\n❌ ${failures.length} fallaron, ${passed} pasaron\n`
    : `\n${passed}/${passed} tests de reconstrucción de cartera pasaron\n`
);
if (failures.length) process.exit(1);

// ─────────────── Mapper de operaciones de IOL ───────────────


console.log("\n─── classifyOperation: tipos de IOL → normalizados ───\n");

test("clasifica los tipos principales de IOL", () => {
  eq(classifyOperation("Compra"), "BUY", "compra");
  eq(classifyOperation("Venta"), "SELL", "venta");
  eq(classifyOperation("Suscripción FCI"), "SUBSCRIPTION", "suscripción");
  eq(classifyOperation("Rescate"), "REDEMPTION", "rescate");
  eq(classifyOperation("Dividendos en efectivo"), "DIVIDEND", "dividendo");
  eq(classifyOperation("Pago de Cupón"), "COUPON", "cupón");
  eq(classifyOperation("Renta"), "INTEREST", "renta");
  eq(classifyOperation("Amortización"), "COUPON", "amortización");
  eq(classifyOperation("algo raro"), "OTHER", "desconocido");
});

console.log("\n─── mapOperations: respuesta cruda → Operation[] ───\n");

test("mapea una compra terminada con todos los campos", () => {
  const ops = mapOperations([
    {
      numero: 987654,
      tipo: "Compra",
      estado: "terminada",
      fechaOperada: "2023-06-15T14:30:00",
      simbolo: "ggal",
      cantidad: 100,
      precio: 500,
      montoOperado: 50000,
      moneda: "peso_Argentino",
    },
  ]);
  eq(ops.length, 1, "una operación");
  eq(ops[0].id, "987654", "id como string");
  eq(ops[0].type, "BUY", "tipo");
  eq(ops[0].symbol, "GGAL", "símbolo en mayúscula");
  eq(ops[0].quantity, 100, "cantidad");
  eq(ops[0].amount, 50000, "monto");
  eq(ops[0].currency, "ARS", "moneda");
});

test("descarta operaciones no terminadas (canceladas/pendientes)", () => {
  const ops = mapOperations([
    { numero: 1, tipo: "Compra", estado: "cancelada", fechaOperada: "2023-06-15", cantidad: 10, precio: 100 },
    { numero: 2, tipo: "Compra", estado: "terminada", fechaOperada: "2023-06-15", cantidad: 10, precio: 100, moneda: "peso_Argentino" },
  ]);
  eq(ops.length, 1, "solo la terminada");
  eq(ops[0].id, "2", "la que quedó");
});

test("deriva el monto de cantidad×precio si no viene", () => {
  const ops = mapOperations([
    { numero: 5, tipo: "Compra", estado: "terminada", fechaOperada: "2023-06-15", simbolo: "AAPL", cantidad: 10, precio: 150, moneda: "dolar_Estadounidense" },
  ]);
  eq(ops[0].amount, 1500, "monto derivado");
  eq(ops[0].currency, "USD", "dólares");
});

test("tolera nombres de campo alternativos (mayúsculas)", () => {
  const ops = mapOperations([
    { Numero: 77, Tipo: "Venta", Estado: "terminada", FechaOperada: "2023-07-01", Simbolo: "PAMP", Cantidad: 50, Precio: 800, Monto: 40000, Moneda: "peso_Argentino" },
  ]);
  eq(ops.length, 1, "mapeó con nombres en mayúscula");
  eq(ops[0].type, "SELL", "tipo");
  eq(ops[0].quantity, 50, "cantidad");
});

test("una operación sin id o sin fecha válida se descarta (no se puede deduplicar/ubicar)", () => {
  const ops = mapOperations([
    { tipo: "Compra", estado: "terminada", fechaOperada: "2023-06-15", cantidad: 10, precio: 100 }, // sin numero
    { numero: 9, tipo: "Compra", estado: "terminada", fechaOperada: "fecha-invalida", cantidad: 10, precio: 100 }, // fecha mala
  ]);
  eq(ops.length, 0, "ambas descartadas");
});

test("lista vacía o no-array no rompe", () => {
  eq(mapOperations([]).length, 0, "vacío");
  eq(mapOperations(null).length, 0, "null");
  eq(mapOperations(undefined).length, 0, "undefined");
});

console.log(
  failures.length
    ? `\n❌ ${failures.length} fallaron en total\n`
    : `\n✅ Reconstrucción + mapper: ${passed} tests pasaron\n`
);
if (failures.length) process.exit(1);
