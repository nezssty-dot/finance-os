import type { Importer, RawTable } from "../types";

/**
 * CSV — el caso fácil, y aun así tiene una trampa.
 *
 * Un CSV no es "separar por comas". Un campo entre comillas puede TENER comas adentro:
 *
 *     15/03/2024,"SUPERMERCADO COTO, SUCURSAL 12",-8500.00
 *
 * Partir eso por comas da tres columnas donde hay que tener tres, pero con la segunda
 * cortada al medio. Y como el archivo igual "se lee", el error no aparece hasta que el
 * usuario ve un movimiento con la descripción mutilada y el monto en la columna que no es.
 *
 * Acá se respeta el comillado. El delimitador lo detecta el servidor (ya lo hace, y
 * probado con Galicia, Santander, Macro y Brubank): este importer solo entrega las
 * líneas crudas y deja que el motor genérico decida.
 */
export class CsvImporter implements Importer {
  readonly format = "csv" as const;
  readonly extensions = [".csv", ".txt"];

  accepts(file: File): boolean {
    const name = file.name.toLowerCase();
    return this.extensions.some((e) => name.endsWith(e)) || file.type === "text/csv";
  }

  async read(file: File): Promise<RawTable> {
    const text = await readAsText(file);
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

    if (!lines.length) throw new Error("El archivo está vacío.");

    // El delimitador se detecta acá SOLO para armar la tabla de preview. El servidor lo
    // vuelve a detectar sobre el texto crudo (su lógica ya está testeada); esto es para
    // que la pantalla pueda mostrar columnas antes de hablar con el backend.
    const delimiter = detectDelimiter(lines.slice(0, 20));
    const rows = lines.map((l) => splitRespectingQuotes(l, delimiter));

    return { rows, format: "csv" };
  }
}

/** Lee el archivo probando codificaciones: los resúmenes argentinos suelen venir en Latin-1. */
async function readAsText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();

  // UTF-8 primero. Si aparece el carácter de reemplazo (), el archivo no era UTF-8.
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("\uFFFD")) return utf8;

  // Latin-1: es lo que exportan la mayoría de los homebanking locales. Sin esto, cada
  // "ó" y cada "ñ" de las descripciones sale como basura.
  return new TextDecoder("windows-1252").decode(buf);
}

/** Cuál de , ; \t | aparece de forma más CONSISTENTE en las líneas. */
function detectDelimiter(lines: string[]): string {
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestScore = -1;

  for (const d of candidates) {
    const counts = lines.map((l) => splitRespectingQuotes(l, d).length);
    if (counts.some((c) => c < 2)) continue;

    // No gana el que MÁS columnas produce, sino el más CONSISTENTE: un delimitador
    // correcto da la misma cantidad de columnas en todas las filas. Uno equivocado da
    // números que saltan.
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    const variance = counts.reduce((a, c) => a + (c - avg) ** 2, 0) / counts.length;
    const score = avg - variance * 10;

    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }

  return best;
}

/** Parte una línea respetando las comillas. Un campo comillado puede tener el delimitador adentro. */
function splitRespectingQuotes(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];

    if (c === '"') {
      // Dos comillas seguidas adentro de un campo comillado = una comilla literal.
      if (inQuotes && line[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (c === delimiter && !inQuotes) {
      out.push(field.trim());
      field = "";
      continue;
    }

    field += c;
  }

  out.push(field.trim());
  return out;
}
