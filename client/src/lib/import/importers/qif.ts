import type { Importer, RawTable } from "../types";

/**
 * QIF — Quicken Interchange Format. Formato de texto viejo pero muy usado para exportar
 * movimientos. Es línea por línea, con un código de un carácter al principio:
 *
 *     D03/15/2024      D = fecha
 *     T-8500.00        T (o U) = monto CON signo
 *     PSUPERMERCADO    P = beneficiario (payee)
 *     MCompra changas  M = memo
 *     ^                fin de la transacción
 *
 * La primera línea suele ser `!Type:Bank` (el tipo de cuenta) y se ignora.
 *
 * Igual que el resto de los importers, entrega una tabla con encabezado conocido
 * (Fecha / Descripción / Monto) para que el servidor la mapee con su detección ya probada.
 */

/**
 * PURO: texto QIF → filas [Fecha, Descripción, Monto]. Sin File, sin FileReader, sin red.
 */
export function parseQif(text: string): string[][] {
  const rows: string[][] = [["Fecha", "Descripción", "Monto"]];
  let cur: { date?: string; amount?: string; payee?: string; memo?: string } = {};

  const flush = () => {
    if (cur.amount !== undefined) {
      const desc = [cur.payee, cur.memo].filter((s) => s && s.length).join(" · ") || "Movimiento";
      rows.push([cur.date ?? "", desc, cur.amount]);
    }
    cur = {};
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("!")) continue; // encabezado de tipo (!Type:Bank), no es dato

    const code = line[0];
    const val = line.slice(1).trim();

    if (code === "^") {
      flush();
    } else if (code === "D") {
      cur.date = val;
    } else if (code === "T" || code === "U") {
      // QIF es formato US: la coma es separador de miles, el punto es decimal. Se sacan
      // las comas para que quede un número limpio (el servidor interpreta el signo).
      cur.amount = val.replace(/,/g, "");
    } else if (code === "P") {
      cur.payee = val;
    } else if (code === "M") {
      cur.memo = val;
    }
  }
  // Última transacción si el archivo no termina con "^".
  flush();

  return rows;
}

export class QifImporter implements Importer {
  readonly format = "qif" as const;
  readonly extensions = [".qif"];

  accepts(file: File): boolean {
    const name = file.name.toLowerCase();
    return this.extensions.some((e) => name.endsWith(e));
  }

  async read(file: File): Promise<RawTable> {
    const buf = await file.arrayBuffer();
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.includes("\uFFFD")) text = new TextDecoder("windows-1252").decode(buf);

    const rows = parseQif(text);
    if (rows.length <= 1) {
      throw new Error("El archivo QIF se leyó pero no tiene movimientos.");
    }
    return { rows, format: "qif" };
  }
}
