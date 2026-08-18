/**
 * El motor de importación — contratos.
 *
 * ─── LA IDEA ───
 *
 * Un resumen bancario puede venir en PDF, Excel o CSV. Los tres dicen lo mismo:
 * fecha, descripción, monto. Lo único que cambia es CÓMO están guardados.
 *
 * Entonces cada Importer hace UNA cosa: convertir su formato en una TABLA DE TEXTO
 * DELIMITADO. Nada más. No sabe qué es una fecha, ni qué columna es el monto, ni de
 * qué banco viene.
 *
 * Eso lo resuelve el motor que YA EXISTE en el servidor (detectDelimiter, detectColumns,
 * parseAmount…), probado con formatos reales de Galicia, Santander, Macro y Brubank.
 * No lo reescribimos: le damos de comer.
 *
 *     archivo → Importer → texto delimitado → /integrations/import/analyze → preview
 *
 * Agregar un formato nuevo = escribir un Importer. Nada más se toca.
 */

/** Una tabla, tal como salió del archivo. Sin interpretar. */
export interface RawTable {
  /** Filas × columnas, todo string. Lo que había en el archivo, crudo. */
  rows: string[][];
  /** El formato del que salió, para mostrárselo al usuario. */
  format: ImportFormat;
  /** Cuántas páginas/hojas tenía el original (0 si no aplica). */
  sheets?: number;
}

export type ImportFormat = "csv" | "xlsx" | "pdf" | "ofx" | "qif" | "json" | "xml";

/**
 * Un Importer traduce UN formato a una tabla. Eso es todo lo que hace.
 *
 * No parsea fechas. No detecta columnas. No sabe de bancos. Si tu Importer
 * empieza a hacer eso, se te escapó la responsabilidad de lugar.
 */
export interface Importer {
  /** Para mostrarlo en la UI. */
  readonly format: ImportFormat;
  /** Extensiones que maneja, en minúscula y con punto: [".csv"] */
  readonly extensions: string[];

  /** ¿Puede con este archivo? */
  accepts(file: File): boolean;

  /** Convierte el archivo en una tabla de texto. Tira si el archivo está roto. */
  read(file: File): Promise<RawTable>;
}

/**
 * De dónde salió el archivo. Es una PISTA, no una verdad: sirve para mostrarle al
 * usuario "esto parece de Mercado Pago" y para que en el futuro un importer específico
 * pueda afinar el parseo.
 *
 * Deliberadamente NO cambia cómo se parsea. El motor genérico ya anda con formatos
 * reales de cuatro bancos. Meter reglas por banco es la forma más rápida de terminar
 * con un if gigante que nadie entiende.
 */
export interface DetectedSource {
  id: string;
  /** Lo que ve el usuario: "Mercado Pago", "Banco Galicia". */
  name: string;
  /** 0 a 1. Abajo de 0.5 no se muestra: una corazonada no es un dato. */
  confidence: number;
}

/**
 * ─── CLASIFICACIÓN AUTOMÁTICA (preparado, NO implementado) ───
 *
 * Esta interfaz existe para que el día que se meta IA —o reglas, o lo que sea— no haya
 * que tocar ni la pantalla ni el motor: se registra otro Categorizer y listo.
 *
 *     "Spotify"        → Suscripciones
 *     "YPF"            → Combustible
 *     "MERCADOLIBRE"   → Compras
 *     "STARBUCKS"      → Cafetería
 *
 * Hoy hay uno solo, por reglas, y es a propósito: un modelo que alucina la categoría
 * de un gasto es peor que no categorizar nada, porque el usuario confía y no revisa.
 * Cuando haya IA, va a proponer, no a decidir — y siempre con la categoría editable.
 */
export interface Categorizer {
  readonly id: string;
  /**
   * Propone una categoría para un movimiento. `null` = no sé, y eso está bien.
   * NUNCA adivinar: una categoría equivocada ensucia los reportes en silencio.
   */
  suggest(input: { description: string; amount: number }): Promise<CategorySuggestion | null>;
}

export interface CategorySuggestion {
  /** El nombre de la categoría propuesta. Se matchea contra las del usuario. */
  category: string;
  /** 0 a 1. La UI decide qué hacer con la duda; el categorizador no. */
  confidence: number;
  /** Por qué. Para que el usuario pueda no creerle. */
  reason?: string;
}

/** Lo que la pantalla recibe cuando el motor terminó de leer un archivo. */
export interface ReadResult {
  table: RawTable;
  /** El texto delimitado que se le manda al servidor. */
  text: string;
  source: DetectedSource | null;
}
