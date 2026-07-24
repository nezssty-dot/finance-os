/**
 * Auditoría financiera. PURO: sin base, sin red.
 *
 * El objetivo del sprint: que el usuario pueda CONFIAR en los balances. Este motor revisa
 * una tanda de movimientos y levanta banderas sobre lo que puede estar mal, sin tocar
 * nada — solo informa. Cada hallazgo dice qué encontró y sobre qué movimientos, para que
 * el usuario decida.
 *
 * Se apoya en SIGN (el mismo mapa de signos que usa balance-math) para que la aritmética
 * de la auditoría sea EXACTAMENTE la misma que la que calcula los saldos. Si audita
 * distinto a como suma, la auditoría no serviría de nada.
 */

import { SIGN } from "./balance-math";

export interface AuditMovement {
  id: string;
  date: unknown; // idealmente "YYYY-MM-DD"; se tolera Date/null
  description?: string | null;
  amount: unknown; // número o string numérico
  type: string; // INCOME | EXPENSE | ...
  currency?: string;
  categoryId?: string | null;
  accountId?: string | null;
}

export type FindingSeverity = "warning" | "info";

export interface AuditFinding {
  kind:
    | "duplicate"
    | "uncategorized_income"
    | "uncategorized_expense"
    | "invalid_date"
    | "invalid_amount"
    | "no_account";
  severity: FindingSeverity;
  message: string;
  /** Los ids de los movimientos involucrados (para poder resaltarlos en la UI). */
  movementIds: string[];
}

export interface AuditReport {
  analyzed: number;
  findings: AuditFinding[];
  /** Totales por moneda, calculados con el MISMO signo que los saldos reales. */
  totalsByCurrency: Record<string, { income: number; expense: number; net: number }>;
  ok: boolean; // true si no hay findings de severidad "warning"
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toDateStr(v: unknown): string | null {
  if (typeof v === "string" && v.length >= 8) return v.slice(0, 10);
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  return null;
}

function normDesc(s: string | null | undefined): string {
  return String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Audita una tanda de movimientos (típicamente los de un mes). No modifica nada: devuelve
 * un reporte con lo que encontró.
 *
 * @param movements   los movimientos a revisar
 * @param opts.window rango esperado {from,to} en "YYYY-MM-DD"; marca los que caen afuera
 */
export function auditMovements(
  movements: AuditMovement[],
  opts: { window?: { from: string; to: string } } = {}
): AuditReport {
  const findings: AuditFinding[] = [];
  const totalsByCurrency: Record<string, { income: number; expense: number; net: number }> = {};

  // ─── Duplicados ───
  // Misma fecha + mismo monto + misma descripción normalizada + mismo tipo = sospechoso.
  // No se borra nada: se avisa para que el usuario confirme (dos cafés iguales el mismo
  // día son legítimos; por eso es "warning", no un borrado automático).
  const seen = new Map<string, string[]>();
  for (const m of movements) {
    const dateStr = toDateStr(m.date);
    const amount = toNumber(m.amount);
    const key = `${dateStr}|${amount}|${normDesc(m.description)}|${m.type}`;
    const list = seen.get(key) ?? [];
    list.push(m.id);
    seen.set(key, list);
  }
  for (const [, ids] of seen) {
    if (ids.length > 1) {
      findings.push({
        kind: "duplicate",
        severity: "warning",
        message: `${ids.length} movimientos idénticos (misma fecha, monto y descripción). Revisá si es un duplicado.`,
        movementIds: ids,
      });
    }
  }

  // ─── Recorrido por movimiento: categoría, fecha, monto, cuenta, totales ───
  const uncategorizedIncome: string[] = [];
  const uncategorizedExpense: string[] = [];
  const invalidDate: string[] = [];
  const invalidAmount: string[] = [];
  const noAccount: string[] = [];

  for (const m of movements) {
    const amount = toNumber(m.amount);
    const dateStr = toDateStr(m.date);
    const cur = m.currency || "ARS";

    // Monto inválido: es lo más grave para un balance, porque descuadra todo.
    if (amount === null || amount < 0) {
      invalidAmount.push(m.id);
    } else {
      const sign = SIGN[m.type] ?? 0;
      const bucket = (totalsByCurrency[cur] ??= { income: 0, expense: 0, net: 0 });
      if (sign > 0) bucket.income += amount;
      else if (sign < 0) bucket.expense += amount;
      bucket.net += sign * amount;
    }

    // Fecha inválida o fuera del rango esperado.
    if (!dateStr) {
      invalidDate.push(m.id);
    } else if (opts.window && (dateStr < opts.window.from || dateStr > opts.window.to)) {
      invalidDate.push(m.id);
    }

    // Ingresos/egresos sin categoría: ensucian los reportes por rubro.
    if (!m.categoryId) {
      if (SIGN[m.type] > 0) uncategorizedIncome.push(m.id);
      else if (SIGN[m.type] < 0) uncategorizedExpense.push(m.id);
    }

    // Sin cuenta: un movimiento sin cuenta no impacta ningún saldo (plata "fantasma").
    if (!m.accountId && m.type !== "INTERNAL") noAccount.push(m.id);
  }

  // Redondeo prolijo de los totales.
  for (const c of Object.keys(totalsByCurrency)) {
    const b = totalsByCurrency[c];
    b.income = Math.round(b.income * 100) / 100;
    b.expense = Math.round(b.expense * 100) / 100;
    b.net = Math.round(b.net * 100) / 100;
  }

  if (invalidAmount.length)
    findings.push({ kind: "invalid_amount", severity: "warning", message: `${invalidAmount.length} movimientos con monto inválido o negativo.`, movementIds: invalidAmount });
  if (invalidDate.length)
    findings.push({ kind: "invalid_date", severity: "warning", message: `${invalidDate.length} movimientos con fecha inválida o fuera del mes.`, movementIds: invalidDate });
  if (uncategorizedIncome.length)
    findings.push({ kind: "uncategorized_income", severity: "info", message: `${uncategorizedIncome.length} ingresos sin categoría.`, movementIds: uncategorizedIncome });
  if (uncategorizedExpense.length)
    findings.push({ kind: "uncategorized_expense", severity: "info", message: `${uncategorizedExpense.length} gastos sin categoría.`, movementIds: uncategorizedExpense });
  if (noAccount.length)
    findings.push({ kind: "no_account", severity: "info", message: `${noAccount.length} movimientos sin cuenta asignada (no impactan ningún saldo).`, movementIds: noAccount });

  const ok = !findings.some((f) => f.severity === "warning");

  return { analyzed: movements.length, findings, totalsByCurrency, ok };
}

/**
 * Compara el total registrado contra un total externo (por ejemplo, el que decía el
 * resumen del banco al importarlo). Devuelve la diferencia por moneda, o null si cuadra.
 * Es "la diferencia de $3.500 con la importación original" del ejemplo del sprint.
 */
export function reconcileTotals(
  registered: Record<string, number>,
  external: Record<string, number>,
  tolerance = 1
): { currency: string; diff: number }[] {
  const out: { currency: string; diff: number }[] = [];
  const currencies = new Set([...Object.keys(registered), ...Object.keys(external)]);
  for (const c of currencies) {
    const diff = Math.round(((registered[c] ?? 0) - (external[c] ?? 0)) * 100) / 100;
    if (Math.abs(diff) > tolerance) out.push({ currency: c, diff });
  }
  return out;
}
