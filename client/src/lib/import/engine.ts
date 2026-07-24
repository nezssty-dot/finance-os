import type { Categorizer, CategorySuggestion, Importer, ReadResult } from "./types";
import { CsvImporter } from "./importers/csv";
import { ExcelImporter } from "./importers/excel";
import { PdfImporter } from "./importers/pdf";
import { OfxImporter } from "./importers/ofx";
import { QifImporter } from "./importers/qif";
import { detectSource } from "./sources";

/**
 * EL MOTOR.
 *
 *     archivo → Importer → tabla → texto delimitado → servidor
 *
 * Este archivo no sabe leer PDF, ni Excel, ni CSV. Sabe ELEGIR quién lo hace. Esa es
 * toda su responsabilidad, y por eso agregar un formato nuevo no lo toca.
 *
 * ─── AGREGAR UN FORMATO ───
 *
 *   1. Escribir la clase en importers/  (implementar Importer: format, extensions,
 *      accepts, read)
 *   2. Sumarla al array IMPORTERS de abajo.
 *
 * Eso es todo. Ni la pantalla ni el servidor se enteran.
 */

const IMPORTERS: Importer[] = [
  new CsvImporter(),
  new ExcelImporter(),
  new PdfImporter(),
  // Formatos de intercambio bancario: vienen etiquetados, así que son MÁS confiables que
  // el PDF (no hay que adivinar columnas). Muchos homebanking los exportan.
  new OfxImporter(),
  new QifImporter(),
  // Para agregar: JSON, XML.
  // Y más adelante, si un origen necesita parseo especial de verdad:
  //   new MercadoPagoImporter(), new GaliciaImporter(), new IolImporter()
  // Van ACÁ, no como un `if` adentro del motor genérico.
];

/** Para mostrarle al usuario qué puede arrastrar. */
export const ACCEPTED_EXTENSIONS = IMPORTERS.flatMap((i) => i.extensions);

export class ImportEngine {
  private readonly importers: Importer[];
  private readonly categorizer: Categorizer | null;

  constructor(opts: { importers?: Importer[]; categorizer?: Categorizer } = {}) {
    this.importers = opts.importers ?? IMPORTERS;
    this.categorizer = opts.categorizer ?? null;
  }

  /** ¿Alguien puede con este archivo? */
  canRead(file: File): boolean {
    return this.importers.some((i) => i.accepts(file));
  }

  /**
   * Lee el archivo y devuelve la tabla + el texto que va al servidor.
   *
   * El texto se arma con TAB como separador, a propósito: es el único carácter que
   * prácticamente nunca aparece adentro de la descripción de un movimiento. Con coma
   * o punto y coma, un comercio llamado "COTO, S.A." parte la fila al medio y el monto
   * termina en la columna equivocada — y como el archivo "se importa bien", nadie se
   * entera hasta que los totales no cierran.
   */
  async read(file: File): Promise<ReadResult> {
    const importer = this.importers.find((i) => i.accepts(file));

    if (!importer) {
      throw new Error(
        `No sabemos leer archivos ${extensionOf(file)}. ` +
          `Por ahora: ${ACCEPTED_EXTENSIONS.join(", ")}.`
      );
    }

    const table = await importer.read(file);

    if (!table.rows.length) {
      throw new Error("El archivo se leyó pero no tiene ninguna fila.");
    }

    // Si una celda ya trae un TAB (raro, pero pasa), se reemplaza por un espacio: si no,
    // rompería la columna que estamos armando.
    const text = table.rows
      .map((row) => row.map((c) => c.replace(/\t/g, " ")).join("\t"))
      .join("\n");

    return { table, text, source: detectSource(text) };
  }

  /**
   * ─── PREPARADO, NO IMPLEMENTADO ───
   *
   * El día que haya un Categorizer (IA, reglas, lo que sea), se registra en el
   * constructor y esto empieza a devolver sugerencias. Ni la pantalla ni el servidor
   * cambian: la costura ya está.
   *
   * Hoy devuelve null, que significa "no sé" — y eso es correcto. Una categoría
   * inventada ensucia los reportes EN SILENCIO: el usuario confía, no revisa, y tres
   * meses después no entiende por qué "Combustible" tiene la cuenta de Netflix adentro.
   */
  async suggestCategory(
    input: { description: string; amount: number }
  ): Promise<CategorySuggestion | null> {
    if (!this.categorizer) return null;
    return this.categorizer.suggest(input);
  }
}

function extensionOf(file: File): string {
  const dot = file.name.lastIndexOf(".");
  return dot > 0 ? file.name.slice(dot) : "sin extensión";
}

/** Una sola instancia para toda la app. */
export const importEngine = new ImportEngine();

export type { Importer, RawTable, ReadResult, DetectedSource, Categorizer, CategorySuggestion } from "./types";
