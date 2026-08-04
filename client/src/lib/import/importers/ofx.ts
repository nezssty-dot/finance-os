import type { Importer, RawTable } from "../types";

/**
 * OFX — el formato de intercambio bancario (Open Financial Exchange). Muchos bancos y
 * homebanking lo exportan, y es MÁS confiable que el PDF: los campos vienen etiquetados,
 * no hay que adivinar columnas ni parsear una tabla visual.
 *
 * OFX es "casi XML" pero no del todo: las etiquetas viejas (SGML) no cierran —
 * `<TRNAMT>-8500.00` sin `</TRNAMT>`, el valor va hasta el próximo `<` o fin de línea—.
 * Por eso se parsea con regex tolerante en vez de un parser XML estricto, que se rompería
 * con la mitad de los archivos reales.
 *
 * Cada transacción es un bloque <STMTTRN> con:
 *   <TRNAMT>  monto CON signo (negativo = débito)
 *   <DTPOSTED> fecha YYYYMMDD[HHMMSS]
 *   <NAME> / <MEMO> descripción
 *
 * Se entrega una tabla con encabezado conocido (Fecha / Descripción / Monto) que el
 * servidor ya sabe mapear — la misma detección probada con Galicia, Santander, etc.
 */

/** Saca el valor de una etiqueta OFX, tolerando que no cierre (SGML) o que sí (XML). */
function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, "i"));
  return m ? m[1].trim() : null;
}

/** "20240315120000" → "2024-03-15" (ISO, sin ambigüedad para el parser de fechas). */
function formatOfxDate(raw: string | null): string {
  if (!raw) return "";
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : raw;
}

/**
 * PURO: texto OFX → filas [Fecha, Descripción, Monto]. Sin File, sin FileReader, sin red.
 * Separado de la clase para poder testearlo con casos fijos.
 */
export function parseOfx(text: string): string[][] {
  const rows: string[][] = [["Fecha", "Descripción", "Monto"]];
  const blocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];

  for (const block of blocks) {
    const amount = tag(block, "TRNAMT");
    if (amount === null) continue; // sin monto no es un movimiento
    const date = formatOfxDate(tag(block, "DTPOSTED"));
    const name = tag(block, "NAME");
    const memo = tag(block, "MEMO");
    const desc = [name, memo].filter((s) => s && s.length).join(" · ") || "Movimiento";
    rows.push([date, desc, amount]);
  }
  return rows;
}

export class OfxImporter implements Importer {
  readonly format = "ofx" as const;
  readonly extensions = [".ofx"];

  accepts(file: File): boolean {
    const name = file.name.toLowerCase();
    return this.extensions.some((e) => name.endsWith(e));
  }

  async read(file: File): Promise<RawTable> {
    const buf = await file.arrayBuffer();
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.includes("\uFFFD")) text = new TextDecoder("windows-1252").decode(buf);

    const rows = parseOfx(text);
    if (rows.length <= 1) {
      throw new Error("El archivo OFX se leyó pero no tiene movimientos (<STMTTRN>).");
    }
    return { rows, format: "ofx" };
  }
}
