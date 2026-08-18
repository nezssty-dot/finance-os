import type { Importer, RawTable } from "../types";

/**
 * pdf.js pesa ~350 KB. Cargarlo en el bundle principal haría más lento el arranque de la
 * app PARA TODOS — incluidos los que nunca importan un PDF, que son la mayoría.
 *
 * Con un import() dinámico, Vite lo parte en su propio chunk y el navegador lo baja
 * recién cuando alguien suelta un PDF. Cero costo para el resto.
 */
type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  // Una sola vez: si el usuario importa tres PDF seguidos, no se baja tres veces.
  pdfjsPromise ??= (async () => {
    const [pdfjs, worker] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]);

    // pdf.js parsea en un worker. Sin esto congela la ventana entera mientras lee — y un
    // resumen de tarjeta de 40 páginas tarda lo suficiente como para que el usuario crea
    // que la app se colgó.
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  })();

  return pdfjsPromise;
}

/**
 * PDF — el formato más difícil, y hay que ser honesto sobre por qué.
 *
 * ─── UN PDF NO TIENE TABLAS ───
 *
 * Un CSV tiene columnas. Un Excel tiene celdas. Un PDF tiene TEXTO CON COORDENADAS:
 *
 *     "15/03/2024"  en x=72,  y=310
 *     "STARBUCKS"   en x=140, y=310
 *     "-4.500,00"   en x=480, y=310
 *
 * Que eso "sea una fila" es una interpretación NUESTRA. El PDF no lo dice en ningún lado.
 *
 * ─── CÓMO SE RECONSTRUYE ───
 *
 * 1. Se agrupan los fragmentos por Y  → cada grupo es una línea visual.
 * 2. Se buscan las X donde el texto ARRANCA de forma consistente en muchas líneas.
 *    Esas son las columnas de verdad. Una X que aparece en 2 líneas de 200 es ruido
 *    (un pie de página, un logo); una que aparece en 180 es una columna.
 * 3. Cada fragmento se asigna a la columna cuya X esté más cerca.
 *
 * Es una heurística, y como toda heurística puede fallar. Por eso la pantalla SIEMPRE
 * muestra la previsualización antes de importar: si el PDF salió mal armado, se ve
 * antes de que ensucie la base, no después.
 *
 * Un PDF escaneado (una foto del resumen) NO tiene capa de texto y acá no hay nada que
 * hacer: se avisa con un mensaje claro en vez de importar cero filas en silencio.
 */
export class PdfImporter implements Importer {
  readonly format = "pdf" as const;
  readonly extensions = [".pdf"];

  accepts(file: File): boolean {
    return file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";
  }

  async read(file: File): Promise<RawTable> {
    const pdfjs = await loadPdfJs();
    const buf = await file.arrayBuffer();

    let doc;
    try {
      doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
    } catch {
      throw new Error("No se pudo abrir el PDF. ¿Está protegido con contraseña?");
    }

    const lines: TextLine[] = [];

    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();

      // getTextContent() mezcla dos cosas: TextItem (texto con posición) y
      // TextMarkedContent (marcas de estructura, SIN texto ni coordenadas). Leerle
      // .transform a una marca revienta, así que se filtran en runtime — no alcanza
      // con confiar en el tipo.
      const items: Fragment[] = [];

      for (const raw of content.items) {
        const item = raw as Partial<PdfTextItem>;
        if (typeof item.str !== "string" || !Array.isArray(item.transform)) continue;

        const text = item.str.trim();
        if (!text) continue;

        items.push({
          text,
          // transform = [a, b, c, d, e, f] — e y f son la posición en la página.
          x: Math.round(item.transform[4]),
          y: Math.round(item.transform[5]),
        });
      }

      lines.push(...groupIntoLines(items, p));
    }

    if (!lines.length) {
      throw new Error(
        "El PDF no tiene texto: probablemente sea un escaneo o una foto. " +
          "Necesita OCR, que todavía no soportamos. Probá con el CSV o el Excel del homebanking."
      );
    }

    const columns = detectColumns(lines);
    const rows = lines.map((line) => toRow(line, columns));

    // Las líneas de una sola celda son títulos, encabezados de página, pies. No son
    // movimientos. Dejarlas ensucia la vista previa y el detector de columnas del servidor.
    const table = rows.filter((r) => r.filter((c) => c.length > 0).length >= 2);

    if (!table.length) {
      throw new Error("El PDF tiene texto pero no se pudo reconstruir ninguna tabla.");
    }

    return { rows: table, format: "pdf", sheets: doc.numPages };
  }
}

/** Un fragmento de texto con posición. Lo otro que devuelve pdf.js son marcas de
 *  estructura, que no tienen ni texto ni coordenadas. */
interface PdfTextItem {
  str: string;
  transform: number[];
}

interface Fragment {
  text: string;
  x: number;
  y: number;
}

interface TextLine {
  page: number;
  y: number;
  fragments: Fragment[];
}

/**
 * Agrupa fragmentos en líneas visuales.
 *
 * Dos fragmentos están en la misma línea si su Y difiere en menos de la tolerancia. No
 * se compara por igualdad: el renderizador puede desplazar medio punto un fragmento y
 * eso partiría la fila al medio.
 */
function groupIntoLines(items: Fragment[], page: number): TextLine[] {
  const TOLERANCE = 3; // puntos PDF (~1 px). Suficiente para el jitter del renderizado.
  const byY = new Map<number, Fragment[]>();

  for (const item of items) {
    // Se busca una línea existente cuya Y esté dentro de la tolerancia.
    let key = item.y;
    for (const existing of byY.keys()) {
      if (Math.abs(existing - item.y) <= TOLERANCE) {
        key = existing;
        break;
      }
    }
    (byY.get(key) ?? byY.set(key, []).get(key)!).push(item);
  }

  return [...byY.entries()]
    .map(([y, fragments]) => ({
      page,
      y,
      fragments: fragments.sort((a, b) => a.x - b.x),
    }))
    // De arriba hacia abajo: en un PDF la Y CRECE hacia arriba, así que se ordena al revés.
    .sort((a, b) => b.y - a.y);
}

/**
 * Encuentra dónde arrancan las columnas.
 *
 * La clave es la CONSISTENCIA, no la frecuencia bruta. Una X que aparece en 3 líneas de
 * 200 es un pie de página. Una que aparece en 180 es una columna. Se pide que aparezca
 * en al menos el 15% de las líneas: abajo de eso es ruido, y una "columna" fantasma
 * corre todos los datos un lugar a la derecha.
 */
function detectColumns(lines: TextLine[]): number[] {
  const TOLERANCE = 8; // puntos. Dos X más cerca que esto son la MISMA columna.
  const clusters = new Map<number, number>(); // x → cuántas líneas la usan

  for (const line of lines) {
    const seen = new Set<number>();

    for (const f of line.fragments) {
      let key = f.x;
      for (const existing of clusters.keys()) {
        if (Math.abs(existing - f.x) <= TOLERANCE) {
          key = existing;
          break;
        }
      }
      // Una sola vez por línea: si una fila tiene dos fragmentos en la misma columna,
      // no cuenta doble.
      if (!seen.has(key)) {
        clusters.set(key, (clusters.get(key) ?? 0) + 1);
        seen.add(key);
      }
    }
  }

  const minLines = Math.max(2, Math.floor(lines.length * 0.15));

  return [...clusters.entries()]
    .filter(([, count]) => count >= minLines)
    .map(([x]) => x)
    .sort((a, b) => a - b);
}

/** Asigna cada fragmento a su columna. Los que caen en la misma se concatenan. */
function toRow(line: TextLine, columns: number[]): string[] {
  if (!columns.length) return [line.fragments.map((f) => f.text).join(" ")];

  const cells: string[][] = columns.map(() => []);

  for (const f of line.fragments) {
    // La columna cuya X esté más cerca del arranque del fragmento.
    let best = 0;
    let bestDist = Infinity;

    for (let i = 0; i < columns.length; i++) {
      const dist = Math.abs(columns[i] - f.x);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }

    cells[best].push(f.text);
  }

  return cells.map((c) => c.join(" ").trim());
}
