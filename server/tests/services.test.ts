/**
 * Tests del motor de vencimientos de servicios.
 *
 * El foco está en el calendario, que es donde la aritmética ingenua de fechas se rompe:
 * el día 31 en meses cortos, febrero, años bisiestos, fin de mes. Todo con fechas fijas
 * —el módulo es puro y recibe la fecha de referencia— así que estos casos se prueban de
 * verdad y no "según el día que corras el test".
 *
 * Sin base, sin red. Igual que balance-math y classify.
 */

import {
  nextDueDate,
  dueDatesBetween,
  committedInRange,
  committedByCurrency,
  monthBounds,
  type ServiceLike,
} from "../src/lib/services-math";
import { matchMovementToService } from "../src/lib/service-match";

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

/**
 * Fecha en YYYY-MM-DD tomando los componentes LOCALES.
 *
 * NO se usa toISOString(): eso convierte a UTC y hace que el test dependa de la zona
 * horaria de quien lo corre. monthBounds y todo el agrupado por mes de la app trabajan en
 * hora local, así que comparar contra UTC daba falsos fallos (y, peor, falsa confianza:
 * el test pasaba en UTC pero el usuario corre la app en Argentina).
 */
const iso = (d: Date | null) => {
  if (!d) return "null";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
function eqDate(actual: Date | null, expected: string, what: string) {
  if (iso(actual) !== expected)
    throw new Error(`${what}: esperaba ${expected}, obtuve ${iso(actual)}`);
}
function eq(actual: any, expected: any, what: string) {
  if (actual !== expected)
    throw new Error(`${what}: esperaba ${JSON.stringify(expected)}, obtuve ${JSON.stringify(actual)}`);
}

// Fábrica: un servicio mensual base, sobreescribible.
function svc(over: Partial<ServiceLike> = {}): ServiceLike {
  return {
    amount: 5500,
    frequency: "MONTHLY",
    interval: 1,
    dueDay: null,
    startDate: new Date(2025, 0, 10), // 10-ene-2025
    endDate: null,
    active: true,
    ...over,
  };
}

console.log("\n─── nextDueDate: mensual simple ───\n");

test("si el vencimiento es hoy, devuelve hoy (no el mes que viene)", () => {
  const s = svc({ startDate: new Date(2025, 5, 10), dueDay: 10 });
  eqDate(nextDueDate(s, new Date(2025, 5, 10)), "2025-06-10", "vencimiento");
});

test("si ya pasó el del mes, devuelve el del mes siguiente", () => {
  const s = svc({ startDate: new Date(2025, 0, 10), dueDay: 10 });
  eqDate(nextDueDate(s, new Date(2025, 5, 15)), "2025-07-10", "vencimiento");
});

test("un servicio inactivo no tiene próximo vencimiento", () => {
  eq(nextDueDate(svc({ active: false }), new Date(2025, 5, 1)), null, "vencimiento");
});

test("un servicio ya terminado (endDate pasada) no tiene próximo vencimiento", () => {
  const s = svc({ endDate: new Date(2025, 2, 1) });
  eq(nextDueDate(s, new Date(2025, 5, 1)), null, "vencimiento");
});

console.log("\n─── nextDueDate: los casos que rompen la aritmética ingenua ───\n");

test("día 31: en un mes de 30 días cae el 30, no salta a mayo", () => {
  // 31 de abril no existe. La aritmética ingenua (setMonth) daría 1-may.
  const s = svc({ startDate: new Date(2025, 0, 31), dueDay: 31 });
  eqDate(nextDueDate(s, new Date(2025, 3, 1)), "2025-04-30", "vencimiento en abril");
});

test("día 31: en febrero cae el 28 (año no bisiesto)", () => {
  const s = svc({ startDate: new Date(2025, 0, 31), dueDay: 31 });
  eqDate(nextDueDate(s, new Date(2025, 1, 1)), "2025-02-28", "vencimiento en febrero");
});

test("día 31: en febrero de año bisiesto cae el 29", () => {
  const s = svc({ startDate: new Date(2024, 0, 31), dueDay: 31 });
  eqDate(nextDueDate(s, new Date(2024, 1, 1)), "2024-02-29", "vencimiento en febrero bisiesto");
});

test("día 31: después de febrero VUELVE a 31 (no se queda pegado en 28)", () => {
  // El bug clásico: si guardás el 28, marzo también sale 28. Como se recalcula desde
  // el dueDay original cada vez, marzo vuelve a 31.
  const s = svc({ startDate: new Date(2025, 0, 31), dueDay: 31 });
  eqDate(nextDueDate(s, new Date(2025, 2, 1)), "2025-03-31", "vencimiento en marzo");
});

console.log("\n─── Frecuencias ───\n");

test("semanal: avanza de a 7 días", () => {
  const s = svc({ frequency: "WEEKLY", startDate: new Date(2025, 5, 2) });
  eqDate(nextDueDate(s, new Date(2025, 5, 10)), "2025-06-16", "vencimiento");
});

test("trimestral (mensual, interval 3): salta 3 meses", () => {
  const s = svc({ frequency: "MONTHLY", interval: 3, startDate: new Date(2025, 0, 15), dueDay: 15 });
  eqDate(nextDueDate(s, new Date(2025, 1, 1)), "2025-04-15", "vencimiento");
});

test("anual: el mismo día un año después", () => {
  const s = svc({ frequency: "YEARLY", startDate: new Date(2025, 6, 20), dueDay: 20 });
  eqDate(nextDueDate(s, new Date(2025, 8, 1)), "2026-07-20", "vencimiento");
});

test("anual desde 29-feb: en año no bisiesto cae el 28", () => {
  const s = svc({ frequency: "YEARLY", startDate: new Date(2024, 1, 29), dueDay: 29 });
  eqDate(nextDueDate(s, new Date(2025, 0, 1)), "2025-02-28", "vencimiento");
});

console.log("\n─── Robustez: datos raros no cuelgan la app ───\n");

test("interval 0 no genera un bucle infinito", () => {
  const s = svc({ interval: 0, dueDay: 10, startDate: new Date(2025, 0, 10) });
  // No importa tanto el valor exacto: importa que TERMINE y no cuelgue.
  const r = nextDueDate(s, new Date(2025, 5, 1));
  eq(r instanceof Date, true, "devuelve una fecha sin colgarse");
});

console.log("\n─── dueDatesBetween y committed ───\n");

test("un mensual genera un vencimiento por mes en el rango", () => {
  const s = svc({ dueDay: 10, startDate: new Date(2025, 0, 10) });
  const dates = dueDatesBetween(s, new Date(2025, 0, 1), new Date(2025, 3, 30));
  eq(dates.map(iso).join(","), "2025-01-10,2025-02-10,2025-03-10,2025-04-10", "vencimientos");
});

test("committedInRange = cantidad de vencimientos por monto", () => {
  const s = svc({ amount: 5500, dueDay: 10, startDate: new Date(2025, 0, 10) });
  // 3 meses (ene, feb, mar) × 5500
  eq(committedInRange(s, new Date(2025, 0, 1), new Date(2025, 2, 31)), 16500, "comprometido");
});

test("un servicio que termina a mitad de rango deja de contar", () => {
  const s = svc({ amount: 1000, dueDay: 10, startDate: new Date(2025, 0, 10), endDate: new Date(2025, 1, 15) });
  // solo ene y feb caen antes de la endDate
  eq(committedInRange(s, new Date(2025, 0, 1), new Date(2025, 5, 30)), 2000, "comprometido");
});

test("committedByCurrency NO mezcla monedas", () => {
  const services = [
    { ...svc({ amount: 5500, dueDay: 10, startDate: new Date(2025, 0, 10) }), currency: "ARS" },
    { ...svc({ amount: 30, dueDay: 10, startDate: new Date(2025, 0, 10) }), currency: "USD" },
  ];
  const r = committedByCurrency(services, new Date(2025, 0, 1), new Date(2025, 0, 31));
  eq(r.ARS, 5500, "total ARS");
  eq(r.USD, 30, "total USD");
});

test("monthBounds da el primer y último instante del mes", () => {
  const { start, end } = monthBounds(2025, 1); // febrero 2025
  eqDate(start, "2025-02-01", "inicio");
  eqDate(end, "2025-02-28", "fin");
});

// ─────────────────────────── Detección de pagos ───────────────────────────



console.log("\n─── matchMovementToService: conservador, ante la duda NO ───\n");

const spotify = {
  id: "s1",
  name: "Spotify",
  amount: 5500,
  currency: "ARS",
  service: svc({ amount: 5500, dueDay: 5, startDate: new Date(2025, 0, 5) }),
};

function tMatch(name: string, fn: () => void) { test(name, fn); }

tMatch("matchea nombre + monto exacto + fecha en el vencimiento", () => {
  const m = { description: "COMPRA SPOTIFY AB", amount: 5500, currency: "ARS", date: new Date(2025, 5, 5) };
  const r = matchMovementToService(m, [spotify]);
  eq(r?.serviceId, "s1", "servicio detectado");
  eqDate(r?.dueDate ?? null, "2025-06-05", "vencimiento asociado");
});

tMatch("acepta una variación de monto chica (±15%)", () => {
  const m = { description: "SPOTIFY", amount: 5900, currency: "ARS", date: new Date(2025, 5, 5) };
  eq(matchMovementToService(m, [spotify])?.serviceId, "s1", "servicio");
});

tMatch("RECHAZA si el monto se va lejos (aunque el nombre coincida)", () => {
  const m = { description: "SPOTIFY PREMIUM FAMILY", amount: 12000, currency: "ARS", date: new Date(2025, 5, 5) };
  eq(matchMovementToService(m, [spotify]), null, "sin match");
});

tMatch("RECHAZA si el nombre no aparece en la descripción", () => {
  const m = { description: "PAGO VARIOS 4821", amount: 5500, currency: "ARS", date: new Date(2025, 5, 5) };
  eq(matchMovementToService(m, [spotify]), null, "sin match");
});

tMatch("RECHAZA si la fecha está lejos de cualquier vencimiento", () => {
  const m = { description: "SPOTIFY", amount: 5500, currency: "ARS", date: new Date(2025, 5, 20) };
  eq(matchMovementToService(m, [spotify]), null, "sin match");
});

tMatch("RECHAZA si la moneda no coincide (ARS no paga un servicio en USD)", () => {
  const usdSvc = { ...spotify, currency: "USD", service: svc({ amount: 5500, dueDay: 5, startDate: new Date(2025,0,5) }) };
  const m = { description: "SPOTIFY", amount: 5500, currency: "ARS", date: new Date(2025, 5, 5) };
  eq(matchMovementToService(m, [usdSvc]), null, "sin match");
});

tMatch("entre dos servicios candidatos, elige el de mejor score", () => {
  const netflix = { id: "s2", name: "Netflix", amount: 5500, currency: "ARS", service: svc({ amount: 5500, dueDay: 5, startDate: new Date(2025,0,5) }) };
  // La descripción dice Spotify: debe ganar Spotify aunque Netflix tenga mismo monto/fecha.
  const m = { description: "SPOTIFY AB", amount: 5500, currency: "ARS", date: new Date(2025, 5, 5) };
  eq(matchMovementToService(m, [netflix, spotify])?.serviceId, "s1", "servicio ganador");
});

tMatch("descripción vacía nunca matchea", () => {
  const m = { description: "", amount: 5500, currency: "ARS", date: new Date(2025, 5, 5) };
  eq(matchMovementToService(m, [spotify]), null, "sin match");
});

console.log(
  failures.length
    ? `\n❌ ${failures.length} fallaron en total\n`
    : `\n✅ Todos los tests de servicios (incl. detección) pasaron: ${passed}\n`
);
if (failures.length) process.exit(1);
