/**
 * Mercado Pago mapping tests.
 *
 * These run against the real mapping code with realistic Mercado Pago payloads.
 *
 * WHAT THEY PROVE: the logic is right — a rejected payment is never counted, a refund
 * reverses the original, a commission is extracted and never duplicated.
 *
 * WHAT THEY DO NOT PROVE: that Mercado Pago's real payloads use these exact field
 * names. That needs one sync against a real account. See KNOWN-GAPS.md §3.
 */

import { mapPayment, extractFee, isQR, isYield } from "../src/integrations/providers/mercadopago/mapping";

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    failures.push(`${name}\n      ${e.message}`);
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}

function eq(actual: any, expected: any, what: string) {
  const a = actual instanceof Date ? actual.toISOString() : actual;
  const b = expected instanceof Date ? expected.toISOString() : expected;
  if (a !== b) throw new Error(`${what}: esperaba ${JSON.stringify(b)}, obtuve ${JSON.stringify(a)}`);
}

const ME = "123456789";
const THEM = "987654321";

/** A payment shaped the way Mercado Pago documents it. */
const payment = (over: Record<string, any> = {}) => ({
  id: 111222333,
  status: "approved",
  operation_type: "regular_payment",
  transaction_amount: 50000,
  currency_id: "ARS",
  description: "Sesión de grabación",
  date_created: "2026-03-10T14:00:00.000-03:00",
  date_approved: "2026-03-10T14:00:05.000-03:00",
  payer: { id: THEM, first_name: "Pekam" },
  collector_id: ME,
  fee_details: [],
  ...over,
});

console.log("\n─── Plata que nunca se movió (el bug) ───\n");

test("un pago RECHAZADO no entra al libro", () => {
  eq(mapPayment(payment({ status: "rejected" }), ME), null, "rechazado");
});

test("un pago CANCELADO no entra al libro", () => {
  eq(mapPayment(payment({ status: "cancelled" }), ME), null, "cancelado");
});

test("un pago PENDIENTE no entra al libro", () => {
  eq(mapPayment(payment({ status: "pending" }), ME), null, "pendiente");
});

test("un pago EN PROCESO no entra al libro", () => {
  eq(mapPayment(payment({ status: "in_process" }), ME), null, "in_process");
});

test("un pago de monto cero se ignora", () => {
  eq(mapPayment(payment({ transaction_amount: 0 }), ME), null, "monto cero");
});

test("una tarjeta rechazada NO cuenta como gasto (era el bug: inflaba tus gastos)", () => {
  const rechazado = payment({ status: "rejected", payer: { id: ME }, collector_id: THEM });
  eq(mapPayment(rechazado, ME), null, "tarjeta rechazada");
});

console.log("\n─── Dirección de la plata ───\n");

test("si cobré yo, es INGRESO", () => {
  const m = mapPayment(payment(), ME)!;
  eq(m.type, "INCOME", "tipo");
  eq(m.amount, 50000, "monto");
  eq(m.counterpart, "Pekam", "contraparte");
});

test("si pagué yo, es GASTO", () => {
  const m = mapPayment(payment({ payer: { id: ME }, collector_id: THEM }), ME)!;
  eq(m.type, "EXPENSE", "tipo");
});

test("plata mía moviéndose entre mis propias cuentas de MP es INTERNAL", () => {
  const m = mapPayment(payment({ payer: { id: ME }, collector_id: ME }), ME)!;
  eq(m.type, "INTERNAL", "tipo");
});

test("el monto siempre es positivo (el signo lo pone el tipo, no el número)", () => {
  const m = mapPayment(payment({ transaction_amount: -50000 }), ME)!;
  eq(m.amount, 50000, "monto");
});

console.log("\n─── Devoluciones ───\n");

test("una devolución de algo que cobré invierte el signo: pasa a GASTO", () => {
  const m = mapPayment(payment({ status: "refunded" }), ME)!;
  eq(m.type, "EXPENSE", "tipo");
  eq(m.description.startsWith("Devolución:"), true, "descripción marcada");
});

test("una devolución de algo que pagué me devuelve la plata: pasa a INGRESO", () => {
  const m = mapPayment(payment({ status: "refunded", payer: { id: ME }, collector_id: THEM }), ME)!;
  eq(m.type, "INCOME", "tipo");
});

test("un contracargo también invierte el signo", () => {
  const m = mapPayment(payment({ status: "charged_back" }), ME)!;
  eq(m.type, "EXPENSE", "tipo");
});

console.log("\n─── QR ───\n");

test("QR detectado por point_of_interaction", () => {
  eq(isQR(payment({ point_of_interaction: { type: "QR" } })), true, "es QR");
});

test("QR detectado por operation_type pos_payment", () => {
  eq(isQR(payment({ operation_type: "pos_payment" })), true, "es QR");
});

test("un cobro por QR sigue siendo INGRESO, pero queda etiquetado", () => {
  const m = mapPayment(payment({ point_of_interaction: { type: "QR" } }), ME)!;
  eq(m.type, "INCOME", "tipo");
  eq(m.description.includes("(QR)"), true, "etiquetado");
});

test("un pago normal NO se marca como QR", () => {
  eq(isQR(payment()), false, "no es QR");
});

console.log("\n─── Rendimientos ───\n");

test("los rendimientos son INGRESO con categoría propia", () => {
  const m = mapPayment(payment({ operation_type: "investment", payer: { id: ME }, collector_id: ME }), ME)!;
  eq(m.type, "INCOME", "tipo");
  eq(m.classifyHint, "rendimientos", "categoría");
  eq(m.description, "Rendimientos Mercado Pago", "descripción");
});

test("los rendimientos ganan sobre INTERNAL (si no, la plata que generás no se vería)", () => {
  // Both sides are me, which would normally be INTERNAL. But this is money the
  // account earned by itself — it is real income and has to show up as such.
  const m = mapPayment(payment({ operation_type: "investment", payer: { id: ME }, collector_id: ME }), ME)!;
  eq(m.type, "INCOME", "tipo");
});

test("un pago normal no es rendimiento", () => {
  eq(isYield(payment()), false, "no es rendimiento");
});

console.log("\n─── Comisiones ───\n");

test("la comisión se extrae de fee_details cuando cobré yo", () => {
  const fee = extractFee(
    payment({ fee_details: [{ type: "mercadopago_fee", amount: 3120.5, fee_payer: "collector" }] }),
    ME
  )!;
  eq(fee.amount, 3120.5, "monto");
  eq(fee.currency, "ARS", "moneda");
});

test("si la comisión la paga el otro, no es mi gasto", () => {
  const fee = extractFee(
    payment({ fee_details: [{ type: "mercadopago_fee", amount: 3120.5, fee_payer: "payer" }] }),
    ME
  );
  eq(fee, null, "comisión ajena");
});

test("si pagué yo, no hay comisión mía que registrar", () => {
  const fee = extractFee(
    payment({
      payer: { id: ME },
      collector_id: THEM,
      fee_details: [{ type: "mercadopago_fee", amount: 999, fee_payer: "collector" }],
    }),
    ME
  );
  eq(fee, null, "no cobré yo");
});

test("sin fee_details no hay comisión", () => {
  eq(extractFee(payment(), ME), null, "sin comisión");
});

test("varias comisiones en un mismo pago se suman", () => {
  const fee = extractFee(
    payment({
      fee_details: [
        { type: "mercadopago_fee", amount: 3000, fee_payer: "collector" },
        { type: "financing_fee", amount: 120.5, fee_payer: "collector" },
      ],
    }),
    ME
  )!;
  eq(fee.amount, 3120.5, "suma");
});

test("la comisión de un pago rechazado no existe", () => {
  const fee = extractFee(
    payment({
      status: "rejected",
      fee_details: [{ type: "mercadopago_fee", amount: 3000, fee_payer: "collector" }],
    }),
    ME
  );
  eq(fee, null, "sin comisión");
});

test("el id de la comisión es determinístico: re-sincronizar NO duplica", () => {
  const p = payment({ fee_details: [{ type: "mercadopago_fee", amount: 3000, fee_payer: "collector" }] });
  const a = extractFee(p, ME)!;
  const b = extractFee(p, ME)!; // same payment, synced again
  eq(a.providerTxId, b.providerTxId, "mismo id");
  eq(a.providerTxId, "111222333-fee", "id derivado del pago");
});

test("el id de la comisión nunca choca con el del pago", () => {
  const p = payment({ fee_details: [{ type: "mercadopago_fee", amount: 3000, fee_payer: "collector" }] });
  const mov = mapPayment(p, ME)!;
  const fee = extractFee(p, ME)!;
  if (mov.providerTxId === fee.providerTxId) throw new Error("el pago y su comisión comparten id");
});

console.log("\n─── Robustez (MP manda basura a veces) ───\n");

test("un payload sin payer no rompe", () => {
  const m = mapPayment(payment({ payer: undefined }), ME)!;
  eq(m.type, "INCOME", "tipo");
});

test("un payload sin descripción cae en un valor razonable", () => {
  const m = mapPayment(payment({ description: undefined, payer: { id: THEM } }), ME)!;
  eq(m.counterpart, "Mercado Pago", "contraparte");
});

test("una descripción kilométrica se corta y no revienta la base", () => {
  const m = mapPayment(payment({ description: "x".repeat(500) }), ME)!;
  if (m.description.length > 160) throw new Error(`descripción de ${m.description.length} chars`);
});

test("usa date_approved cuando existe, no date_created", () => {
  const m = mapPayment(payment(), ME)!;
  eq(m.date.toISOString(), new Date("2026-03-10T14:00:05.000-03:00").toISOString(), "fecha");
});

console.log(
  failures.length
    ? `\n❌ ${failures.length} fallaron, ${passed} pasaron\n`
    : `\n${passed}/${passed} tests de Mercado Pago pasaron\n`
);

if (failures.length) process.exit(1);
