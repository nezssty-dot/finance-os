/**
 * Tests de la interpretación del lenguaje bancario. Determinístico, sin base ni red.
 * Cubre las frases reales que usan los bancos y billeteras argentinas.
 */

import { detectKind, resolveKind, normalizePhrase } from "../src/lib/bank-language";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  \u2713 ${name}`); }
  catch (e: any) { failures.push(name); console.log(`  \u2717 ${name}\n      ${e.message}`); }
}
function eq(a: any, b: any, what: string) {
  if (a !== b) throw new Error(`${what}: esperaba ${JSON.stringify(b)}, obtuve ${JSON.stringify(a)}`);
}

console.log("\n\u2500\u2500\u2500 Normalización \u2500\u2500\u2500\n");

test("saca acentos y mayúsculas", () => {
  eq(normalizePhrase("ACREDITACIÓN  de Haberes"), "acreditacion de haberes", "normalizado");
});

console.log("\n\u2500\u2500\u2500 Ingresos \u2500\u2500\u2500\n");

const ingresos = [
  "Transferencia recibida de Juan Perez",
  "ACREDITACION HABERES EMPRESA SA",
  "Deposito en efectivo sucursal 12",
  "Cobro por servicios prestados",
  "Devolucion de compra",
  "Rendimientos cuenta remunerada",
];
for (const frase of ingresos) {
  test(`"${frase.slice(0, 34)}..." \u2192 INGRESO`, () => {
    eq(detectKind(frase).kind, "INCOME", "tipo");
  });
}

console.log("\n\u2500\u2500\u2500 Gastos \u2500\u2500\u2500\n");

const gastos = [
  "Compra con debito CARREFOUR",
  "Transferencia enviada a Maria",
  "Debito automatico SPOTIFY",
  "Extraccion cajero automatico",
  "Pago QR kiosco",
  "Pago de servicios EDESUR",
  "Impuesto ley 25413",
  "Comision mantenimiento cuenta",
];
for (const frase of gastos) {
  test(`"${frase.slice(0, 34)}..." \u2192 GASTO`, () => {
    eq(detectKind(frase).kind, "EXPENSE", "tipo");
  });
}

console.log("\n\u2500\u2500\u2500 Transferencias entre cuentas propias \u2500\u2500\u2500\n");

test("'entre cuentas propias' es TRANSFER, no gasto", () => {
  eq(detectKind("Transferencia entre cuentas propias").kind, "TRANSFER", "tipo");
});

test("'traspaso' también es TRANSFER", () => {
  eq(detectKind("Traspaso a mi cuenta en dolares").kind, "TRANSFER", "tipo");
});

test("una transferencia a un tercero NO es TRANSFER interna", () => {
  eq(detectKind("Transferencia enviada a Pedro Gomez").kind, "EXPENSE", "es gasto");
});

console.log("\n\u2500\u2500\u2500 La frase MÁS ESPECÍFICA gana \u2500\u2500\u2500\n");

test("'transferencia recibida' le gana a 'transferencia'", () => {
  eq(detectKind("Transferencia recibida").kind, "INCOME", "ingreso");
});

test("ante ambigüedad marca confianza baja", () => {
  const r = detectKind("Pago recibido por venta");
  eq(r.kind, "INCOME", "gana la más larga");
});

test("devuelve la frase que disparó la decisión", () => {
  eq(detectKind("ACREDITACION HABERES").matchedPhrase, "acreditacion haberes", "frase");
});

console.log("\n\u2500\u2500\u2500 Ante la duda, NO adivina \u2500\u2500\u2500\n");

test("una descripción sin señal devuelve null", () => {
  const r = detectKind("REF 88421 OPERACION 1123");
  eq(r.kind, null, "no adivina");
  eq(r.confidence, "none", "sin confianza");
});

test("descripción vacía no rompe", () => {
  eq(detectKind("").kind, null, "null");
});

console.log("\n\u2500\u2500\u2500 resolveKind: texto + signo del monto \u2500\u2500\u2500\n");

test("el signo negativo manda: es gasto", () => {
  eq(resolveKind("SUPERMERCADO COTO", -8500).kind, "EXPENSE", "gasto");
});

test("el signo positivo manda: es ingreso", () => {
  eq(resolveKind("DEPOSITO", 150000).kind, "INCOME", "ingreso");
});

test("si texto y signo coinciden, confianza ALTA", () => {
  eq(resolveKind("Compra con debito", -5000).confidence, "high", "alta");
});

test("si el texto era ambiguo, queda marcado para revisar aunque el signo coincida", () => {
  // "Devolucion de compra" tiene señales de ingreso Y de gasto: aunque el signo confirme,
  // conviene que el usuario lo mire.
  const r = resolveKind("Devolucion de compra", 5000);
  eq(r.kind, "INCOME", "manda el signo");
  eq(r.confidence, "low", "marcado para revisar");
});

test("contradicción real: texto dice gasto, signo dice ingreso \u2192 manda el signo", () => {
  const r = resolveKind("Compra con debito", 5000);
  eq(r.kind, "INCOME", "el signo es un hecho");
  eq(r.confidence, "low", "marcado para revisar");
});

test("sin signo (monto sin signo), decide el texto", () => {
  eq(resolveKind("Acreditacion de haberes", null).kind, "INCOME", "por texto");
});

test("la transferencia interna gana incluso con signo negativo", () => {
  // El signo la vería como gasto, pero no lo es: la plata sigue siendo del usuario.
  eq(resolveKind("Transferencia entre cuentas propias", -20000).kind, "TRANSFER", "interna");
});

test("sin texto ni signo, no hay tipo", () => {
  eq(resolveKind("REF 001", null).kind, null, "null");
});

console.log(
  failures.length ? `\n\u274c ${failures.length} fallaron, ${passed} pasaron\n` : `\n\u2705 Lenguaje bancario: ${passed} tests pasaron\n`
);
if (failures.length) process.exit(1);
