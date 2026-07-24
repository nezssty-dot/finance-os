import * as XLSX from "xlsx";
import type { Importer, RawTable } from "../types";

/**
 * Excel — y su trampa propia: las FECHAS.
 *
 * Excel no guarda "15/03/2024". Guarda 45366: los días transcurridos desde el 1/1/1900.
 * Si leés la celda cruda te llega un número, y el motor lo interpreta como un MONTO.
 *
 * Resultado: un movimiento de $45.366 que nunca existió, en una fecha que tampoco.
 * Y no falla nada — el archivo se importa "bien". El usuario lo descubre semanas
 * después, cuando los totales no le cierran.
 *
 * Por eso acá se le pide a SheetJS que convierta las fechas a texto ISO ANTES de que
 * nadie más las toque (`raw: false` + `dateNF`).
 */
export class ExcelImporter implements Importer {
  readonly format = "xlsx" as const;
  readonly extensions = [".xlsx", ".xls", ".xlsm"];

  accepts(file: File): boolean {
    const name = file.name.toLowerCase();
    return (
      this.extensions.some((e) => name.endsWith(e)) ||
      file.type.includes("spreadsheet") ||
      file.type.includes("excel")
    );
  }

  async read(file: File): Promise<RawTable> {
    const buf = await file.arrayBuffer();

    // cellDates: que SheetJS convierta los seriales a Date de verdad, en vez de dejarlos
    // como números que después alguien confunde con un monto.
    const wb = XLSX.read(buf, { type: "array", cellDates: true, cellNF: false });

    if (!wb.SheetNames.length) throw new Error("El Excel no tiene ninguna hoja.");

    // Se toma la primera hoja con datos. Un resumen bancario tiene una; si alguien manda
    // un libro con varias, agarrar la primera vacía sería mostrarle "0 movimientos" a
    // alguien cuyo archivo SÍ tenía movimientos.
    let rows: string[][] = [];
    let used = 0;

    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        raw: false, // → strings ya formateados, no seriales
        dateNF: "yyyy-mm-dd", // → fechas en ISO, que es lo que el motor entiende
        defval: "",
        blankrows: false,
      });

      const cleaned = data
        .map((r) => (r as unknown[]).map((c) => String(c ?? "").trim()))
        .filter((r) => r.some((c) => c.length > 0));

      if (cleaned.length > rows.length) {
        rows = cleaned;
        used = wb.SheetNames.indexOf(name) + 1;
      }
    }

    if (!rows.length) throw new Error("El Excel no tiene filas con datos.");

    // Las filas de Excel pueden venir con distinta cantidad de celdas (las vacías del
    // final se omiten). El motor espera una tabla rectangular.
    const width = Math.max(...rows.map((r) => r.length));
    const padded = rows.map((r) => [...r, ...Array(width - r.length).fill("")]);

    return { rows: padded, format: "xlsx", sheets: used };
  }
}
