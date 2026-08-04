/**
 * Motor de vencimientos de servicios. PURO: sin base, sin fechas "de ahora" ocultas.
 *
 * Todas las funciones reciben la fecha de referencia como parámetro (`from`, `today`).
 * Eso no es un capricho: una función que por dentro llama `new Date()` no se puede
 * testear —el resultado cambia según cuándo la corras— y acá lo que se calcula son
 * fechas de vencimiento, donde un error de un día en febrero es un pago que se avisa
 * tarde. Recibiendo la fecha, cada caso raro (día 31, año bisiesto, fin de mes) se
 * prueba con una fecha fija.
 *
 * Por qué esto es puro y separado del módulo con `prisma`: mismo motivo que
 * balance-math.ts. La lógica difícil (calendario) se prueba sin levantar una base.
 */

export type Frequency = "MONTHLY" | "WEEKLY" | "YEARLY";

/** Lo mínimo que el motor necesita de un servicio. No le hace falta la fila entera. */
export interface ServiceLike {
  amount: number;
  frequency: Frequency;
  interval: number; // cada cuántos períodos (3 + MONTHLY = trimestral)
  dueDay: number | null; // día del mes de vencimiento (1-31); null = usa el día de startDate
  startDate: Date;
  endDate: Date | null;
  active: boolean;
}

/** Suma meses a una fecha SIN desbordar de mes. */
// El caso que rompe la aritmética ingenua: 31 de enero + 1 mes. JavaScript te tira
// "31 de febrero", que interpreta como 2 o 3 de marzo. Un servicio que vence el 31 no
// debería "saltar" a marzo en los meses cortos: vence el último día del mes. Esto
// fija el día al último día real del mes cuando el día pedido no existe.
function addMonths(date: Date, months: number, targetDay?: number): Date {
  const y = date.getFullYear();
  const m = date.getMonth();
  const wantDay = targetDay ?? date.getDate();

  const firstOfTarget = new Date(y, m + months, 1);
  const daysInTarget = new Date(
    firstOfTarget.getFullYear(),
    firstOfTarget.getMonth() + 1,
    0
  ).getDate();

  const day = Math.min(wantDay, daysInTarget);
  return new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth(), day);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addYears(date: Date, years: number, targetDay?: number): Date {
  // Reusa addMonths para heredar el manejo del 29/2: 29-feb + 1 año → 28-feb.
  return addMonths(date, years * 12, targetDay);
}

/** Avanza una fecha un período según la frecuencia. */
function advance(date: Date, freq: Frequency, interval: number, dueDay: number | null): Date {
  switch (freq) {
    case "WEEKLY":
      return addDays(date, 7 * interval);
    case "YEARLY":
      return addYears(date, interval, dueDay ?? undefined);
    case "MONTHLY":
    default:
      return addMonths(date, interval, dueDay ?? undefined);
  }
}

/** El primer vencimiento del servicio: su startDate, pero corrido al dueDay si tiene uno. */
function firstDueDate(service: ServiceLike): Date {
  const { startDate, dueDay, frequency } = service;
  if (dueDay == null || frequency === "WEEKLY") return new Date(startDate);

  // Mismo mes que startDate, pero en el día de vencimiento (acotado al largo del mes).
  const y = startDate.getFullYear();
  const m = startDate.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(dueDay, daysInMonth));
}

/**
 * El próximo vencimiento en o después de `from`.
 *
 * Devuelve `null` si el servicio está inactivo o ya terminó (endDate pasada). Nunca se
 * guarda: se calcula cada vez, para que no pueda quedar una fecha vieja pegada.
 */
export function nextDueDate(service: ServiceLike, from: Date): Date | null {
  if (!service.active) return null;
  if (service.endDate && service.endDate < from) return null;

  let due = firstDueDate(service);

  // Avanza hasta alcanzar o pasar `from`. Con una guarda dura por si algún dato raro
  // (interval 0, fechas absurdas) dejara el bucle sin avanzar: nunca colgar la app.
  let guard = 0;
  while (due < from && guard < 5000) {
    const next = advance(due, service.frequency, Math.max(1, service.interval), service.dueDay);
    if (next <= due) break; // no avanzó: cortar en vez de loopear para siempre
    due = next;
    guard++;
  }

  if (service.endDate && due > service.endDate) return null;
  return due;
}

/**
 * Todos los vencimientos de un servicio dentro de [from, to].
 *
 * Es lo que alimenta el calendario y el timeline: no "el próximo", sino todos los que
 * caen en una ventana. Acotado a 500 por servicio para que un rango enorme con un
 * servicio semanal no genere una lista infinita.
 */
export function dueDatesBetween(service: ServiceLike, from: Date, to: Date): Date[] {
  const out: Date[] = [];
  if (!service.active) return out;

  let due = nextDueDate(service, from);
  let guard = 0;
  while (due && due <= to && guard < 500) {
    out.push(due);
    const next = advance(due, service.frequency, Math.max(1, service.interval), service.dueDay);
    if (next <= due) break;
    if (service.endDate && next > service.endDate) break;
    due = next;
    guard++;
  }
  return out;
}

/**
 * Cuánto suma un servicio en un rango — cuántas veces vence por su monto.
 * Es lo que se comprometió en ese período. Por moneda no discrimina: eso lo agrupa
 * quien llama (los servicios en USD y en ARS no se suman entre sí).
 */
export function committedInRange(service: ServiceLike, from: Date, to: Date): number {
  return dueDatesBetween(service, from, to).length * service.amount;
}

/** Primer y último instante de un mes. Útil para "comprometido este mes". */
export function monthBounds(year: number, month0: number): { start: Date; end: Date } {
  return {
    start: new Date(year, month0, 1, 0, 0, 0, 0),
    end: new Date(year, month0 + 1, 0, 23, 59, 59, 999),
  };
}

/**
 * Agrupa el comprometido de varios servicios por moneda, dentro de un rango.
 * Devuelve p. ej. { ARS: 210000, USD: 54 }. No mezcla monedas: sumar pesos con dólares
 * daría un número sin sentido, y el dashboard necesita mostrarlos separados.
 */
export function committedByCurrency(
  services: (ServiceLike & { currency: string })[],
  from: Date,
  to: Date
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of services) {
    const amount = committedInRange(s, from, to);
    if (amount === 0) continue;
    out[s.currency] = (out[s.currency] ?? 0) + amount;
  }
  return out;
}
