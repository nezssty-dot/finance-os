/**
 * Tests del núcleo de integraciones.
 *
 * IOL: contra el PosicionModel oficial documentado.
 * Dedup: contra el hash de contenido, que es lo que decide si un movimiento se
 *        importa, se actualiza o se ignora.
 *
 * Todo puro: sin base de datos, sin red, sin credenciales.
 */

import { mapPosition, mapAccountStatus, normalizeKind, normalizeCurrency } from "../src/integrations/providers/iol/mapping";
import { contentHash } from "../src/integrations/hash";
import type { RawMovement } from "../src/integrations/types";

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

function eq(actual: any, expected: any, what: string) {
  if (actual !== expected)
    throw new Error(`${what}: esperaba ${JSON.stringify(expected)}, obtuve ${JSON.stringify(actual)}`);
}

/** Una posición con la forma exacta del PosicionModel documentado por IOL. */
const posicion = (over: any = {}) => ({
  cantidad: 100,
  comprometido: 0,
  gananciaDinero: 45000,
  gananciaPorcentaje: 18.5,
  ppc: 2432.43,
  ultimoPrecio: 2882.5,
  valorizado: 288250,
  variacionDiaria: 1.2,
  titulo: {
    simbolo: "GGAL",
    descripcion: "Grupo Financiero Galicia",
    tipo: "ACCIONES",
    mercado: "bCBA",
    moneda: "peso_Argentino",
    pais: "argentina",
    plazo: "t0",
  },
  ...over,
});

console.log("\n─── IOL · Cartera (PosicionModel oficial) ───\n");

test("una posición se mapea completa", () => {
  const h = mapPosition(posicion())!;
  eq(h.ticker, "GGAL", "ticker");
  eq(h.name, "Grupo Financiero Galicia", "nombre");
  eq(h.kind, "Acciones", "tipo");
  eq(h.quantity, 100, "cantidad");
  eq(h.avgPrice, 2432.43, "precio promedio (PPC)");
  eq(h.currentPrice, 2882.5, "precio actual");
  eq(h.totalValue, 288250, "valor total");
  eq(h.gainAmount, 45000, "ganancia $");
  eq(h.gainPct, 18.5, "ganancia %");
  eq(h.currency, "ARS", "moneda");
});

test("usamos la ganancia que calcula IOL, no la nuestra", () => {
  // Si nuestro número difiere del que el usuario ve en la app de IOL, el que está
  // mal somos nosotros. No le vamos a discutir a su broker cuánto ganó.
  const h = mapPosition(posicion({ gananciaDinero: 999, gananciaPorcentaje: 3.3 }))!;
  eq(h.gainAmount, 999, "ganancia $");
  eq(h.gainPct, 3.3, "ganancia %");
});

test("una posición sin cantidad (cerrada) se descarta", () => {
  eq(mapPosition(posicion({ cantidad: 0 })), null, "posición cerrada");
});

test("una posición sin símbolo se descarta en vez de romper", () => {
  eq(mapPosition(posicion({ titulo: { simbolo: "" } })), null, "sin símbolo");
});

test("si IOL no valorizó, se deriva de cantidad × precio", () => {
  const h = mapPosition(posicion({ valorizado: 0, cantidad: 10, ultimoPrecio: 50 }))!;
  eq(h.totalValue, 500, "valor derivado");
});

test("IOL a veces manda PascalCase; también se mapea", () => {
  const h = mapPosition({
    Cantidad: 5, PPC: 100, UltimoPrecio: 120, Valorizado: 600,
    GananciaDinero: 100, GananciaPorcentaje: 20,
    Titulo: { Simbolo: "AAPL", Descripcion: "Apple", Tipo: "CEDEARS", Moneda: "dolar_Estadounidense" },
  })!;
  eq(h.ticker, "AAPL", "ticker");
  eq(h.kind, "CEDEARs", "tipo");
  eq(h.currency, "USD", "moneda");
});

console.log("\n─── IOL · Tipos de activo ───\n");

test("acciones, CEDEARs, bonos, FCI y ON se normalizan", () => {
  eq(normalizeKind("ACCIONES"), "Acciones", "acciones");
  eq(normalizeKind("CEDEARS"), "CEDEARs", "cedears");
  eq(normalizeKind("TitulosPublicos"), "Bonos", "bonos");
  eq(normalizeKind("FondoComunDeInversion"), "Fondos Comunes", "fci");
  eq(normalizeKind("ObligacionesNegociables"), "Obligaciones Negociables", "on");
  eq(normalizeKind("OPCIONES"), "Opciones", "opciones");
});

test("un tipo desconocido no se pierde: se muestra tal cual", () => {
  eq(normalizeKind("CAUCION_RARA"), "CAUCION_RARA", "desconocido");
});

test("las monedas de IOL se pasan a ISO", () => {
  eq(normalizeCurrency("peso_Argentino"), "ARS", "pesos");
  eq(normalizeCurrency("dolar_Estadounidense"), "USD", "dólares");
});

console.log("\n─── IOL · Estado de cuenta ───\n");

test("el saldo en pesos se concilia", () => {
  const { balance } = mapAccountStatus({
    cuentas: [{ moneda: "peso_Argentino", disponible: 150000, comprometido: 20000, total: 400000 }],
  });
  eq(balance!.available, 150000, "disponible");
  eq(balance!.reserved, 20000, "comprometido");
  eq(balance!.invested, 230000, "invertido");
});

test("los dólares NO se suman a los pesos: se avisa", () => {
  // Sumar monedas distintas como si fueran la misma es exactamente el error que una
  // app de finanzas no puede cometer.
  const { balance, warnings } = mapAccountStatus({
    cuentas: [
      { moneda: "peso_Argentino", disponible: 100000, total: 100000 },
      { moneda: "dolar_Estadounidense", disponible: 500, total: 500 },
    ],
  });
  eq(balance!.available, 100000, "solo pesos");
  eq(warnings.length, 1, "hay advertencia");
  if (!warnings[0].includes("USD")) throw new Error("la advertencia no nombra la moneda");
});

test("una cuenta vacía no rompe", () => {
  eq(mapAccountStatus({}).balance, null, "sin cuentas");
});

console.log("\n─── Deduplicación (punto 6: si cambia, actualizar) ───\n");

const mov = (over: Partial<RawMovement> = {}): RawMovement => ({
  providerTxId: "abc123",
  type: "INCOME",
  amount: 50000,
  currency: "ARS",
  description: "Sesión",
  counterpart: "Pekam",
  date: new Date("2026-03-10T14:00:00Z"),
  status: "approved",
  method: "Transferencia",
  classifyHint: "pekam",
  payload: {},
  ...over,
});

test("el mismo movimiento produce el mismo hash", () => {
  eq(contentHash(mov()), contentHash(mov()), "hash estable");
});

test("si cambia el monto, cambia el hash → se actualiza", () => {
  if (contentHash(mov()) === contentHash(mov({ amount: 60000 })))
    throw new Error("un monto distinto tiene que dar otro hash");
});

test("si cambia el estado, cambia el hash → se actualiza", () => {
  if (contentHash(mov()) === contentHash(mov({ status: "refunded" })))
    throw new Error("un estado distinto tiene que dar otro hash");
});

test("el payload NO entra en el hash", () => {
  // Mercado Pago mete campos que se mueven solos (date_last_updated). Si entraran en
  // el hash, cada sync reescribiría todo sin que nada real hubiera cambiado.
  eq(
    contentHash(mov({ payload: { a: 1 } })),
    contentHash(mov({ payload: { b: 2, date_last_updated: "ahora" } })),
    "el payload no afecta el hash"
  );
});

test("el hash entra en la columna sin desbordar", () => {
  if (contentHash(mov()).length !== 32) throw new Error("el hash debería ser de 32 chars");
});

console.log(
  failures.length
    ? `\n❌ ${failures.length} fallaron, ${passed} pasaron\n`
    : `\n${passed}/${passed} tests de integraciones pasaron\n`
);

if (failures.length) process.exit(1);
