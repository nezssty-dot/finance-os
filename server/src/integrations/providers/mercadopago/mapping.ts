/**
 * Mapeo Mercado Pago → Finance OS. PURO: sin imports, sin IO, sin base de datos.
 *
 * ─── Campos VERIFICADOS contra la referencia oficial de la API ───
 *   id, status, status_detail, operation_type, payment_method_id, payment_type_id,
 *   currency_id, description, collector_id, payer{id,email}, transaction_amount,
 *   transaction_amount_refunded, date_created, date_approved, point_of_interaction
 *
 * ─── Campos NO verificados (ver PROVIDERS.md → LÍMITES) ───
 *   · fee_details[].{amount,fee_payer} — la forma es la que usa todo el ecosistema,
 *     pero no la vi en la respuesta de ejemplo oficial. Si viene distinta, las
 *     comisiones simplemente no se importan; nada se rompe y el payload queda crudo.
 *   · operation_type "investment" para rendimientos — es una suposición. Es probable
 *     que los rendimientos de Mercado Pago NO salgan por /v1/payments/search.
 *     Está aislado en isYield() para que corregirlo sea una línea.
 *
 * LÍMITE DURO DE LA API: /v1/payments/search solo devuelve los últimos 12 MESES.
 * No es una decisión nuestra. La UI tiene que decirlo.
 */

import type { RawMovement, MovementType } from "../../types";

/**
 * Los únicos estados en los que la plata se movió de verdad.
 *
 * Todo lo demás — rejected, cancelled, pending, in_process — es un pago que no pasó.
 * Importarlos como movimientos reales era el bug: una tarjeta rechazada se convertía
 * en un gasto e inflaba lo que el usuario creía haber gastado.
 */
export const REAL_STATUSES = new Set(["approved", "refunded", "charged_back"]);
export const REVERSING_STATUSES = new Set(["refunded", "charged_back"]);

/** payment_type_id → cómo se pagó, en castellano. Valores oficiales de MP. */
const METHOD: Record<string, string> = {
  credit_card: "Tarjeta de crédito",
  debit_card: "Tarjeta de débito",
  bank_transfer: "Transferencia",
  account_money: "Dinero en cuenta",
  ticket: "Efectivo",
  atm: "Cajero",
  prepaid_card: "Tarjeta prepaga",
  digital_wallet: "Billetera",
  digital_currency: "Cripto",
  voucher_card: "Voucher",
};

export function isQR(p: any): boolean {
  return (
    String(p?.point_of_interaction?.type ?? "").toUpperCase() === "QR" ||
    String(p?.operation_type ?? "").toLowerCase() === "pos_payment"
  );
}

/**
 * Rendimientos (Mercado Fondos).
 *
 * NO VERIFICADO. Es muy posible que los rendimientos no salgan por payments/search.
 * Si no salen, esto simplemente nunca da true y no rompe nada: se detecta cuando
 * Gabi corra una sync real y compare contra lo que ve en la app de Mercado Pago.
 */
export function isYield(p: any): boolean {
  return String(p?.operation_type ?? "").toLowerCase() === "investment";
}

export function describeMethod(p: any): string | null {
  if (isQR(p)) return "QR";
  const t = String(p?.payment_type_id ?? "").toLowerCase();
  return METHOD[t] ?? (t || null);
}

export function mapPayment(p: any, ownMpUser: string): RawMovement | null {
  const status = String(p?.status ?? "").toLowerCase();
  if (!REAL_STATUSES.has(status)) return null; // nunca movió plata

  const amount = Math.abs(Number(p?.transaction_amount ?? 0));
  if (!amount || Number.isNaN(amount)) return null;

  const payerId = String(p?.payer?.id ?? "");
  const collectorId = String(p?.collector?.id ?? p?.collector_id ?? "");
  const opType = String(p?.operation_type ?? "").toLowerCase();

  const counterpart =
    p?.payer?.first_name ||
    p?.additional_info?.payer?.first_name ||
    p?.payer?.email ||
    p?.description ||
    "Mercado Pago";

  let description: string = p?.description || p?.reason || String(counterpart);
  let hint: string = String(counterpart);

  // Los dos lados soy yo → estoy moviendo mi propia plata dentro de Mercado Pago
  // (a la reserva, por ejemplo). No es ingreso ni gasto: si lo contáramos, el
  // patrimonio crecería cada vez que la plata cambia de bolsillo.
  let type: MovementType;
  if (payerId && collectorId && payerId === ownMpUser && collectorId === ownMpUser) {
    type = "INTERNAL";
  } else if (collectorId === ownMpUser) {
    type = "INCOME";
  } else {
    type = "EXPENSE";
  }

  if (isYield(p)) {
    type = "INCOME";
    description = "Rendimientos Mercado Pago";
    hint = "rendimientos";
  } else if (isQR(p)) {
    description = `${description} (QR)`;
    hint = `${hint} qr`;
  } else if (opType === "cellphone_recharge") {
    hint = "recarga celular";
  }

  // Una devolución invierte la dirección del pago original.
  if (REVERSING_STATUSES.has(status)) {
    type = type === "INCOME" ? "EXPENSE" : type === "EXPENSE" ? "INCOME" : type;
    description = `Devolución: ${description}`;
  }

  return {
    providerTxId: String(p.id),
    type,
    amount,
    currency: p?.currency_id ?? "ARS",
    description: description.slice(0, 160),
    counterpart: String(counterpart).slice(0, 120),
    date: new Date(p?.date_approved ?? p?.date_created ?? Date.now()),
    status,
    method: describeMethod(p),
    classifyHint: hint,
    payload: p,
  };
}

/**
 * Devolución PARCIAL.
 *
 * `transaction_amount_refunded` está en la respuesta oficial y es más preciso que
 * mirar solo el status: un pago puede seguir `approved` y tener parte devuelta. Sin
 * esto, el usuario ve el monto bruto y cree que cobró más de lo que cobró.
 */
export function mapPartialRefund(p: any, ownMpUser: string): RawMovement | null {
  const refunded = Math.abs(Number(p?.transaction_amount_refunded ?? 0));
  if (!refunded) return null;

  const status = String(p?.status ?? "").toLowerCase();
  if (status !== "approved") return null; // los totales ya los cubre mapPayment

  const total = Math.abs(Number(p?.transaction_amount ?? 0));
  if (refunded >= total) return null; // no es parcial

  const collectorId = String(p?.collector?.id ?? p?.collector_id ?? "");
  const iCollected = collectorId === ownMpUser;

  return {
    // Id derivado: re-sincronizar nunca lo duplica.
    providerTxId: `${p.id}-refund`,
    type: iCollected ? "EXPENSE" : "INCOME",
    amount: refunded,
    currency: p?.currency_id ?? "ARS",
    description: `Devolución parcial: ${String(p?.description ?? "").slice(0, 120)}`.trim(),
    counterpart: p?.payer?.first_name ?? "Mercado Pago",
    date: new Date(p?.date_last_updated ?? p?.date_approved ?? Date.now()),
    status: "partially_refunded",
    method: describeMethod(p),
    classifyHint: "devolución",
    payload: { partial_refund_of: p.id, amount: refunded },
  };
}

/**
 * La comisión que Mercado Pago se quedó.
 *
 * Nunca llega como pago propio: viene enterrada en fee_details del pago. No importarla
 * significa mostrar el monto bruto y dejar que el usuario crea que ganó más.
 *
 * fee_details NO está en la respuesta de ejemplo oficial que pude leer. Si el nombre
 * del campo es otro, esto devuelve null y no se importa ninguna comisión — no rompe
 * nada, y el payload crudo queda guardado para re-mapear.
 */
export function extractFee(p: any, ownMpUser: string): RawMovement | null {
  if (String(p?.status ?? "").toLowerCase() !== "approved") return null;

  const collectorId = String(p?.collector?.id ?? p?.collector_id ?? "");
  if (!collectorId || collectorId !== ownMpUser) return null; // no cobré yo, no pagué comisión

  const fees: any[] = Array.isArray(p?.fee_details) ? p.fee_details : [];
  const mine = fees
    .filter((f) => String(f?.fee_payer ?? "collector").toLowerCase() === "collector")
    .reduce((s, f) => s + Math.abs(Number(f?.amount ?? 0)), 0);
  if (!(mine > 0)) return null;

  return {
    providerTxId: `${p.id}-fee`,
    type: "EXPENSE",
    amount: mine,
    currency: p?.currency_id ?? "ARS",
    description: "Comisión Mercado Pago",
    counterpart: "Mercado Pago",
    date: new Date(p?.date_approved ?? p?.date_created ?? Date.now()),
    status: "approved",
    method: "Comisión",
    classifyHint: "comisiones",
    payload: { fee_of: p.id, fee_details: p.fee_details },
  };
}

/** Todo lo que sale de un solo pago: el movimiento, su comisión, su devolución parcial. */
export function mapPaymentAll(p: any, ownMpUser: string): RawMovement[] {
  const out: RawMovement[] = [];
  const m = mapPayment(p, ownMpUser);
  if (m) out.push(m);
  const fee = extractFee(p, ownMpUser);
  if (fee) out.push(fee);
  const refund = mapPartialRefund(p, ownMpUser);
  if (refund) out.push(refund);
  return out;
}
