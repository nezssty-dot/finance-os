import { createHash } from "node:crypto";
import type { RawMovement } from "./types";

/**
 * Huella del contenido de una transacción. PURO: sin base de datos, sin IO.
 *
 * Vive separado de sync.ts a propósito. Es la función que decide si un movimiento se
 * importa, se actualiza o se ignora — o sea, la que decide si vas a ver un gasto
 * duplicado en tu libro. Tiene que poder testearse sin levantar una base de datos.
 *
 * Si el proveedor reenvía el mismo pago con el monto corregido o el estado cambiado
 * (de pendiente a acreditado), el hash cambia y el movimiento se ACTUALIZA. Si viene
 * idéntico, se ignora sin tocar nada.
 *
 * Deliberadamente NO incluye el payload entero: Mercado Pago manda campos que se
 * mueven solos (date_last_updated, money_release_date). Si entraran en el hash, cada
 * sincronización reescribiría todo sin que nada real hubiera cambiado.
 */
export function contentHash(m: RawMovement): string {
  const material = [
    m.type,
    m.amount.toFixed(2),
    m.currency,
    m.description,
    m.counterpart ?? "",
    m.date.toISOString(),
    m.status ?? "",
    m.method ?? "",
  ].join("|");

  return createHash("sha256").update(material).digest("hex").slice(0, 32);
}
