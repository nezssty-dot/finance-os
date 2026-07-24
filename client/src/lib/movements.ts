/**
 * Utilidades para procesar movimientos en la UI. PURO: sin React, sin red.
 *
 * Existe para blindar un bug real: la pantalla de Meses se rompía ("Algo se rompió en
 * esta pantalla") porque asumía que la respuesta de /movements era SIEMPRE un array y que
 * cada movimiento tenía `date` como string. Cuando el endpoint devolvía un objeto
 * { items } o un movimiento con date null/Date, `.sort()` con `.localeCompare` reventaba
 * y tiraba abajo todo el render. Esta lógica, aislada y testeada, evita que vuelva a pasar.
 */

export interface MovementLike {
  id?: string;
  date?: unknown;
  amount?: unknown;
  type?: string;
  category?: { name?: string; color?: string } | null;
}

/**
 * Normaliza CUALQUIER respuesta del endpoint de movimientos a un array. Acepta un array
 * plano o un objeto { items: [...] }. Ante cualquier otra cosa (null, undefined, un objeto
 * sin items), devuelve un array vacío en vez de romper.
 */
export function toMovementArray(data: unknown): MovementLike[] {
  if (Array.isArray(data)) return data as MovementLike[];
  if (data && typeof data === "object" && Array.isArray((data as any).items)) {
    return (data as any).items as MovementLike[];
  }
  return [];
}

/**
 * Ordena movimientos por fecha descendente SIN mutar el array original y tolerando fechas
 * que no sean string (Date, null, undefined). El String(...) es lo que evita el crash.
 */
export function sortByDateDesc(movs: MovementLike[]): MovementLike[] {
  return [...movs].sort((a, b) =>
    String(b?.date ?? "").localeCompare(String(a?.date ?? ""))
  );
}

/** Suma ingresos y egresos de una tanda de movimientos. Números no válidos cuentan como 0. */
export function sumInOut(movs: MovementLike[]): { income: number; expense: number; balance: number } {
  let income = 0;
  let expense = 0;
  for (const m of movs) {
    const amount = Number(m?.amount);
    if (!Number.isFinite(amount)) continue;
    if (m?.type === "INCOME") income += amount;
    else if (m?.type === "EXPENSE") expense += amount;
  }
  return { income, expense, balance: income - expense };
}
