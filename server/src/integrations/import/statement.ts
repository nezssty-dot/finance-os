/**
 * Importador universal de extractos bancarios. PURO: sin imports, sin IO, sin base.
 *
 * ─── POR QUÉ ESTO Y NO CONECTORES POR BANCO ───
 *
 * Argentina no tiene Open Banking. Ningún banco (Macro, Galicia, Santander, BBVA,
 * Nación, Brubank, Ualá, Naranja X, Personal Pay, Prex) expone una API pública para
 * que una PERSONA lea su propia cuenta. Las APIs que existen — "Open Galicia", el
 * ApiBank de BIND — son para EMPRESAS.
 *
 * Escribir un "conector Banco Galicia" sería inventar una API que no existe, o
 * scrapear el home banking, que además de frágil viola sus términos.
 *
 * Todos los bancos SÍ dejan exportar el extracto. Entonces el importador no es un
 * plan B: es la integración. Y una que funciona con CUALQUIER banco, incluidos los
 * que todavía no existen.
 *
 * ─── EL PROBLEMA REAL ───
 *
 * Parsear un CSV es fácil. Lo difícil es que cada banco exporta distinto:
 *
 *   Galicia:   Fecha; Descripción; Débito; Crédito; Saldo
 *   Santander: FECHA, CONCEPTO, IMPORTE
 *   Macro:     Fecha Mov.|Detalle|Importe|Saldo
 *   Brubank:   date,description,amount
 *
 * Distintos separadores, distintos nombres, coma o punto decimal, débito/crédito en
 * dos columnas o importe con signo. Este módulo detecta todo eso solo.
 */

// ─────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────

export type ColumnRole = "date" | "description" | "amount" | "debit" | "credit" | "balance" | "ignore";

export interface ColumnMapping {
  /** Índice de columna → qué significa. */
  roles: ColumnRole[];
  /** Si la primera fila son encabezados. */
  hasHeader: boolean;
  delimiter: string;
  /** "," = decimal con coma (es-AR). "." = decimal con punto. */
  decimal: "," | ".";
  dateFormat: "DMY" | "MDY" | "YMD";
}

export interface ParsedRow {
  date: Date;
  description: string;
  /** Positivo = entró plata. Negativo = salió. */
  amount: number;
  balance: number | null;
  /** La fila original, sin tocar. Nunca se descarta. */
  raw: string[];
}

export interface ImportPreview {
  mapping: ColumnMapping;
  rows: ParsedRow[];
  /** Filas que no se pudieron parsear, con el motivo. Se muestran, no se ocultan. */
  rejected: { line: number; reason: string; raw: string }[];
  totalIncome: number;
  totalExpense: number;
  /**
   * Qué entendió el detector. Para que el usuario nunca vea un error genérico: acá está
   * qué columna es qué, cuáles no reconoció, y si falta la fecha o el importe (que es
   * lo que hace que no se importe nada).
   */
  diagnostics: {
    columns: { index: number; role: ColumnRole; header: string | null; sample: string | null }[];
    dateColumnFound: boolean;
    amountColumnFound: boolean;
    notes: string[];
  };
}

// ─────────────────────────────────────────────────────────────
// CSV
// ─────────────────────────────────────────────────────────────

const DELIMITERS = [";", ",", "\t", "|"];

/**
 * Detecta el separador contando cuál produce la misma cantidad de columnas en todas
 * las filas. Un archivo con "1.234,56" y separador "," daría columnas irregulares —
 * la consistencia es la señal, no la frecuencia.
 */
export function detectDelimiter(lines: string[]): string {
  let best = ";";
  let bestScore = -1;

  for (const d of DELIMITERS) {
    const counts = lines.slice(0, 20).map((l) => splitCsvLine(l, d).length);
    if (counts.length === 0 || counts[0] < 2) continue;

    const consistent = counts.every((c) => c === counts[0]);
    // Más columnas y consistentes = mejor. Un separador equivocado casi nunca da
    // el mismo número de columnas en todas las filas.
    const score = consistent ? counts[0] * 10 : 0;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** Split respetando comillas: un campo entrecomillado puede contener el separador. */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      // Comilla doble escapada dentro de un campo entrecomillado.
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (c === delimiter && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur.trim());
  return out;
}

// ─────────────────────────────────────────────────────────────
// Detección de columnas
// ─────────────────────────────────────────────────────────────

const HEADER_HINTS: Record<Exclude<ColumnRole, "ignore">, string[]> = {
  date: [
    "fecha", "date", "fec", "dia", "f. valor", "fecha mov", "fecha operacion",
    "fecha movimiento", "fecha comprobante", "fecha de operacion", "fecha valor",
    "transaction date", "trans date", "posted", "fecha contable", "f. operacion",
  ],
  description: [
    "descripcion", "detalle", "concepto", "description", "movimiento", "referencia",
    "leyenda", "detalle movimiento", "comercio", "beneficiario", "operacion",
    "transaccion", "memo", "narrative", "glosa", "observacion",
    // Planillas personales / Notion: la columna que nombra el movimiento suele llamarse
    // "Gasto" (o "Expense"). Es texto (Supermercado, Nafta…), no un número. Va a
    // descripción, y además dispara la inferencia de tipo (ver detectForcedType).
    "gasto", "gastos", "expense", "categoria",
  ],
  amount: [
    "importe", "monto", "amount", "valor", "total", "importe pesos", "importe ($)",
    "monto operacion", "importe operacion", "value",
  ],
  debit: ["debito", "debe", "debit", "cargo", "salida", "egreso", "extraccion", "retiro", "pago"],
  credit: [
    "credito", "haber", "credit", "abono", "entrada", "deposito", "ingreso",
    "acreditacion", "acreditamiento", "cobro",
  ],
  balance: ["saldo", "balance", "saldo actual", "saldo parcial"],
};

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z\s.]/g, "").trim();

/** Un valor que parece fecha en cualquiera de los formatos usuales. */
export function looksLikeDate(v: string): boolean {
  return /^\s*\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}/.test(v);
}

/** Un valor que parece plata: 1.234,56 · 1,234.56 · -500 · $ 1.200 */
export function looksLikeAmount(v: string): boolean {
  const clean = v.replace(/[$\s]/g, "");
  if (!clean) return false;
  return /^-?\(?[\d.,]+\)?-?$/.test(clean) && /\d/.test(clean);
}

/**
 * Qué significa cada columna.
 *
 * Primero por el encabezado, que es lo confiable. Si no hay encabezado, se infiere
 * mirando los datos: la columna que siempre parece fecha ES la fecha.
 */
/**
 * Infiere el TIPO de todos los movimientos a partir del encabezado.
 *
 * Notion y las planillas personales no traen signo: la plata siempre es un número
 * positivo en "Cantidad", y lo que dice si es ingreso o gasto es el NOMBRE de la tabla —
 * una columna "Gasto" significa que todo es egreso; una "Ingreso", que todo es ingreso.
 * Sin esto, los gastos entraban como ingresos (número positivo → INCOME) y te inflaban la
 * plata. No exige columnas Débito/Crédito: alcanza con el encabezado.
 *
 * Solo mira columnas de TEXTO: si "Ingreso" fuera una columna numérica (un banco con
 * crédito/débito en columnas separadas), es un monto, no una señal de tipo, y no cuenta.
 * Si aparecen las dos señales (ingreso Y gasto), no fuerza nada: ese es el caso del banco
 * con columnas separadas, que se resuelve por débito/crédito.
 */
export function detectForcedType(
  headerRow: string[] | null,
  roles: ColumnRole[]
): "INCOME" | "EXPENSE" | null {
  if (!headerRow) return null;
  let hasIncome = false;
  let hasExpense = false;
  headerRow.forEach((cell, i) => {
    // Una columna numérica es un monto, no una etiqueta de tipo.
    if (roles[i] === "amount" || roles[i] === "debit" || roles[i] === "credit") return;
    const h = norm(cell);
    if (/^(ingreso|ingresos|income)$/.test(h)) hasIncome = true;
    if (/^(gasto|gastos|expense|egreso|egresos)$/.test(h)) hasExpense = true;
  });
  if (hasExpense && !hasIncome) return "EXPENSE";
  if (hasIncome && !hasExpense) return "INCOME";
  return null;
}

/**
 * Ubica la fila de encabezado, esté donde esté.
 *
 * Los extractos suelen traer filas de preámbulo (banco, titular, período, número de
 * cuenta) ANTES de la tabla. Asumir que el header es la fila 0 rompía todo: el header
 * real quedaba adentro de los datos y no se detectaban las columnas por nombre (que es
 * lo único que distingue débito de crédito de saldo). Acá se busca la fila que más
 * parece encabezado: la que tiene varias palabras conocidas y ningún dato real.
 * Devuelve el índice, o -1 si no hay un encabezado reconocible.
 */
export function findHeaderRow(rows: string[][]): number {
  let best = -1;
  let bestScore = 0;
  const scan = Math.min(rows.length, 20); // el encabezado está arriba
  for (let i = 0; i < scan; i++) {
    let score = 0;
    for (const cell of rows[i]) {
      const h = norm(cell);
      if (!h) continue;
      for (const hints of Object.values(HEADER_HINTS)) {
        if (hints.some((hint) => h.includes(hint))) {
          score++;
          break;
        }
      }
    }
    // Un encabezado de verdad tiene ≥2 columnas reconocibles y NO tiene fechas ni
    // importes reales (esos son datos, no títulos).
    const hasData = rows[i].some(
      (c) => looksLikeDate(c) || (looksLikeAmount(c) && c.replace(/[$\s]/g, "").length > 2)
    );
    if (score >= 2 && !hasData && score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/**
 * Qué significa cada columna.
 *
 * Primero por el encabezado (si se encontró uno), que es lo confiable — es lo que
 * distingue débito de crédito. Lo que el encabezado no resuelve, se infiere mirando los
 * datos por MAYORÍA: la columna que mayormente parece fecha ES la fecha.
 */
export function detectColumns(headerRow: string[] | null, dataRows: string[][]): ColumnRole[] {
  const width = Math.max(headerRow?.length ?? 0, ...dataRows.map((r) => r.length), 0);
  const roles: ColumnRole[] = new Array(width).fill("ignore");

  if (headerRow) {
    for (let i = 0; i < width; i++) {
      const h = norm(headerRow[i] ?? "");
      if (!h) continue;
      for (const [role, hints] of Object.entries(HEADER_HINTS)) {
        if (hints.some((hint) => h.includes(hint))) {
          roles[i] = role as ColumnRole;
          break;
        }
      }
    }
  }

  // Lo que el encabezado no resolvió, lo resuelven los datos. Se filtran a las filas que
  // parecen transacciones (tienen una fecha en algún lado): así el preámbulo no ensucia
  // la proporción, aunque haya quedado mezclado en los datos.
  const sample = dataRows.slice(0, 50);
  const txRows = sample.filter((r) => r.some(looksLikeDate));
  const effective = txRows.length >= 2 ? txRows : sample;

  // MAYORÍA, no "todas". Antes se pedía que TODOS los valores parecieran fecha/importe;
  // una sola celda rara rompía la columna entera y el resultado era "no se reconoció
  // ningún movimiento". Con mayoría, la columna que mayormente parece fecha ES la fecha.
  const ratio = (values: string[], pred: (v: string) => boolean) =>
    values.length ? values.filter(pred).length / values.length : 0;
  const THRESHOLD = 0.6;

  for (let i = 0; i < width; i++) {
    if (roles[i] !== "ignore") continue;
    const values = effective.map((r) => r[i] ?? "").filter(Boolean);
    if (!values.length) continue;

    const dateRatio = ratio(values, looksLikeDate);
    const amountRatio = ratio(values, looksLikeAmount);

    if (dateRatio >= THRESHOLD && dateRatio >= amountRatio) {
      if (!roles.includes("date")) roles[i] = "date";
    } else if (amountRatio >= THRESHOLD) {
      // La primera columna numérica es el importe; la siguiente, probablemente el saldo.
      if (!roles.includes("amount") && !roles.includes("debit")) roles[i] = "amount";
      else if (!roles.includes("balance")) roles[i] = "balance";
    } else if (!roles.includes("description")) {
      roles[i] = "description";
    }
  }

  // Validación: una columna marcada como importe/débito/crédito TIENE que contener
  // números. Si el encabezado se llama "Ingreso" pero la columna es texto (la fuente del
  // ingreso, no el monto), el nombre engaña: se detectó por header pero los datos dicen
  // otra cosa. Sin esto, el importe salía de una columna de texto, parseAmount fallaba, y
  // se descartaban TODAS las filas. Se degrada a descripción (o se ignora si ya hay una).
  const looksNumeric = (v: string) => looksLikeAmount(v);
  for (let i = 0; i < width; i++) {
    if (roles[i] !== "amount" && roles[i] !== "debit" && roles[i] !== "credit") continue;
    const values = effective.map((r) => r[i] ?? "").filter(Boolean);
    if (!values.length) continue;
    const numericRatio = values.filter(looksNumeric).length / values.length;
    if (numericRatio < 0.5) {
      // La columna no es numérica: su nombre engañaba. Pasa a descripción (varias
      // descripciones se concatenan), así el texto útil —p.ej. "Sueldo"— no se pierde.
      roles[i] = "description";
    }
  }

  return roles;
}

/** Detecta si la primera fila es encabezado: no puede tener fechas ni importes. */
export function detectHeader(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  const first = rows[0];
  const hasData = first.some((c) => looksLikeDate(c) || (looksLikeAmount(c) && c.length > 2));
  return !hasData;
}

// ─────────────────────────────────────────────────────────────
// Números y fechas
// ─────────────────────────────────────────────────────────────

/**
 * Decide si el archivo usa coma o punto como decimal.
 *
 * Confundirse acá es catastrófico: "1.234" son mil doscientos treinta y cuatro pesos
 * en un banco argentino y un peso con veintitrés centavos en uno americano. Un error
 * de tres órdenes de magnitud en el patrimonio.
 *
 * La regla: si el separador que aparece ÚLTIMO tiene exactamente 2 dígitos después,
 * ese es el decimal.
 */
export function detectDecimal(values: string[]): "," | "." {
  let comma = 0;
  let dot = 0;

  for (const v of values) {
    const clean = v.replace(/[$\s-]/g, "");
    const lastComma = clean.lastIndexOf(",");
    const lastDot = clean.lastIndexOf(".");
    if (lastComma === -1 && lastDot === -1) continue;

    if (lastComma > lastDot) {
      if (clean.length - lastComma - 1 === 2) comma++;
    } else {
      if (clean.length - lastDot - 1 === 2) dot++;
    }
  }

  // Empate o sin datos → coma. Es Argentina.
  return dot > comma ? "." : ",";
}

export function parseAmount(v: string, decimal: "," | "."): number | null {
  if (!v) return null;

  // ─── Fuera los marcadores de moneda ───
  //
  // Antes solo se sacaban "$" y espacios, así que "USD 25" quedaba como "USD25" → NaN →
  // el movimiento se RECHAZABA entero. Los resúmenes con montos en dólares (o los tickets
  // que escriben la moneda al lado del número) perdían filas en silencio.
  //
  // Se sacan como palabra completa o pegados al número, en cualquier posición, porque
  // cada banco lo escribe distinto: "US$ 25", "USD 25", "25 USD", "$ 25".
  let s = v
    .replace(/(?:us\$|u\$s|usd|ars|eur|brl|uyu|clp|mxn|r\$)/gi, "")
    .replace(/[$€£\s]/g, "");
  if (!s) return null;

  // Contabilidad: los paréntesis significan negativo.
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  // Algunos bancos ponen el menos al final: "1.234,56-"
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }

  // Fuera los separadores de miles; el decimal se normaliza a punto.
  s = decimal === "," ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");

  const n = Number(s);
  if (Number.isNaN(n)) return null;
  return negative ? -n : n;
}

/**
 * Fecha.
 *
 * Argentina usa DD/MM/YYYY. Estados Unidos, MM/DD/YYYY. El 03/04 es 3 de abril o 4 de
 * marzo según a quién le preguntes — y no hay forma de saberlo mirando una sola fila.
 * Por eso el formato se detecta sobre TODO el archivo, no fila por fila.
 */
export function detectDateFormat(values: string[]): "DMY" | "MDY" | "YMD" {
  let dmy = 0;
  let mdy = 0;

  for (const v of values) {
    const m = v.trim().match(/^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})/);
    if (!m) continue;
    const [, a, b] = m;
    if (Number(a) > 31) return "YMD"; // el año va primero: no hay ambigüedad
    if (Number(a) > 12) dmy++; // > 12 solo puede ser día
    if (Number(b) > 12) mdy++; // > 12 en la segunda posición: es día, o sea MDY
  }

  if (mdy > dmy) return "MDY";
  return "DMY"; // el default es Argentina
}

export function parseDate(v: string, fmt: "DMY" | "MDY" | "YMD"): Date | null {
  const s = v.trim();

  // Fechas con nombre de mes: "16 de julio de 2026", "July 16, 2026", "16 Jul 2026",
  // "16-jul-2026". Los exports de Notion, Google Sheets y algunos bancos las usan así, y
  // el parseo numérico no las tomaba (se descartaban todas las filas).
  const named = parseNamedMonthDate(s);
  if (named) return named;

  const m = s.match(/^(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})/);
  if (!m) return null;

  const [, a, b, c] = m.map(Number) as unknown as [string, number, number, number];
  let day: number, month: number, year: number;

  if (fmt === "YMD") [year, month, day] = [a, b, c];
  else if (fmt === "MDY") [month, day, year] = [a, b, c];
  else [day, month, year] = [a, b, c];

  if (year < 100) year += year < 70 ? 2000 : 1900;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // ─── MEDIANOCHE LOCAL, NO UTC (bug crítico que corría los movimientos de mes) ───
  //
  // Antes se usaba Date.UTC. El 01/07/2026 quedaba como 2026-07-01T00:00:00Z, y al
  // leerlo en Argentina (UTC-3) daba "30 de junio 21:00": el movimiento se iba al mes
  // ANTERIOR y descuadraba el balance mensual.
  //
  // El resto de la app (monthBounds, los agrupados por mes) trabaja en hora LOCAL, así
  // que la fecha se construye igual. Así el día del archivo es exactamente el día que se
  // guarda y con el que se agrupa: 01/07 SIEMPRE es julio.
  const d = new Date(year, month - 1, day, 0, 0, 0, 0);
  // Rechaza el 31 de febrero: JS lo "corrige" al 3 de marzo en silencio.
  if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

// Nombres de mes en español e inglés (con y sin acento, abreviados o completos).
const MONTH_NAMES: Record<string, number> = {
  ene: 1, enero: 1, jan: 1, january: 1,
  feb: 2, febrero: 2, february: 2,
  mar: 3, marzo: 3, march: 3,
  abr: 4, abril: 4, apr: 4, april: 4,
  may: 5, mayo: 5,
  jun: 6, junio: 6, june: 6,
  jul: 7, julio: 7, july: 7,
  ago: 8, agosto: 8, aug: 8, august: 8,
  sep: 9, sept: 9, septiembre: 9, september: 9,
  oct: 10, octubre: 10, october: 10,
  nov: 11, noviembre: 11, november: 11,
  dic: 12, diciembre: 12, dec: 12, december: 12,
};

/** Fechas tipo "16 de julio de 2026", "July 16, 2026", "16 Jul 2026". */
function parseNamedMonthDate(s: string): Date | null {
  const lower = s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // saca acentos: "julio" y no "jᵁlio"
  // Buscar un nombre de mes en el texto.
  let month = 0;
  let monthName = "";
  for (const [name, num] of Object.entries(MONTH_NAMES)) {
    // \b para que "may" no matchee dentro de otra palabra.
    const re = new RegExp(`\\b${name}\\b`);
    if (re.test(lower) && name.length > monthName.length) {
      month = num;
      monthName = name;
    }
  }
  if (!month) return null;

  // Los dos números que quedan son día y año.
  const nums = lower.match(/\d{1,4}/g);
  if (!nums || nums.length < 2) return null;
  let day = 0;
  let year = 0;
  for (const n of nums) {
    const val = Number(n);
    if (n.length === 4 || val > 31) year = val;
    else if (!day) day = val;
  }
  if (!day || !year) {
    // "julio 2026" sin día → día 1.
    if (year && !day) day = 1;
    else return null;
  }
  if (year < 100) year += year < 70 ? 2000 : 1900;
  if (day < 1 || day > 31) return null;

  // Medianoche LOCAL, igual que arriba: si fuera UTC, el día 1 se iría al mes anterior
  // en cualquier zona horaria al oeste de Greenwich (Argentina incluida).
  const d = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

// ─────────────────────────────────────────────────────────────
// El importador
// ─────────────────────────────────────────────────────────────

/**
 * Analiza un extracto y devuelve lo que se va a importar, ANTES de importarlo.
 *
 * El usuario ve el resultado y confirma. Nunca se escribe nada en la base sin que
 * haya visto qué se va a escribir: un importador que se equivoca en silencio te
 * ensucia el historial financiero, y limpiarlo después es peor que cargarlo a mano.
 */
export function analyze(text: string, override?: Partial<ColumnMapping>): ImportPreview {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length)
    return {
      mapping: emptyMapping(),
      rows: [],
      rejected: [],
      totalIncome: 0,
      totalExpense: 0,
      diagnostics: { columns: [], dateColumnFound: false, amountColumnFound: false, notes: ["El archivo está vacío."] },
    };

  const delimiter = override?.delimiter ?? detectDelimiter(lines);
  const grid = lines.map((l) => splitCsvLine(l, delimiter));

  // El encabezado puede no estar en la fila 0: los extractos traen preámbulo (banco,
  // titular, período) arriba. Se busca dónde está de verdad, y todo lo anterior se saltea.
  const headerIdx = override?.hasHeader === false ? -1 : findHeaderRow(grid);
  const hasHeader = override?.hasHeader ?? headerIdx >= 0;
  const headerRow = hasHeader ? grid[headerIdx >= 0 ? headerIdx : 0] : null;
  const dataStart = headerIdx >= 0 ? headerIdx + 1 : hasHeader ? 1 : 0;

  const roles = override?.roles ?? detectColumns(headerRow, grid.slice(dataStart));

  // Tipo inferido del encabezado (Notion/planillas): "Gasto" → todo EXPENSE, "Ingreso" →
  // todo INCOME. Si el archivo no da señal, queda null y el signo sale del número/columnas.
  const forcedType = detectForcedType(headerRow, roles);

  const body = grid.slice(dataStart);

  // El decimal y el formato de fecha se deciden mirando TODO el archivo. Fila por
  // fila es imposible: "03/04" no dice nada por sí solo.
  const amountCols = roles
    .map((r, i) => (r === "amount" || r === "debit" || r === "credit" ? i : -1))
    .filter((i) => i >= 0);
  const dateCol = roles.indexOf("date");

  const decimal =
    override?.decimal ?? detectDecimal(body.flatMap((r) => amountCols.map((i) => r[i] ?? "")));
  const dateFormat =
    override?.dateFormat ?? detectDateFormat(dateCol >= 0 ? body.map((r) => r[dateCol] ?? "") : []);

  const mapping: ColumnMapping = { roles, hasHeader, delimiter, decimal, dateFormat };

  const rows: ParsedRow[] = [];
  const rejected: ImportPreview["rejected"] = [];

  const descCols = roles.map((r, i) => (r === "description" ? i : -1)).filter((i) => i >= 0);
  const debitCol = roles.indexOf("debit");
  const creditCol = roles.indexOf("credit");
  const amountCol = roles.indexOf("amount");
  const balanceCol = roles.indexOf("balance");

  body.forEach((cells, idx) => {
    const lineNo = idx + dataStart + 1;
    const rawLine = cells.join(delimiter);

    const date = dateCol >= 0 ? parseDate(cells[dateCol] ?? "", dateFormat) : null;
    if (!date) {
      rejected.push({ line: lineNo, reason: "No se pudo leer la fecha", raw: rawLine });
      return;
    }

    let amount: number | null = null;

    if (debitCol >= 0 || creditCol >= 0) {
      // Débito y crédito en columnas separadas: solo una tiene valor.
      const debit = debitCol >= 0 ? parseAmount(cells[debitCol] ?? "", decimal) : null;
      const credit = creditCol >= 0 ? parseAmount(cells[creditCol] ?? "", decimal) : null;
      if (debit) amount = -Math.abs(debit);
      else if (credit) amount = Math.abs(credit);
    }
    // Si no había débito/crédito, O si los había pero ninguno tenía un número válido en
    // esta fila, se cae a la columna de importe. Así un archivo con una columna de importe
    // real (aunque también tenga una columna tipo "Ingreso" de texto) igual se importa.
    if (amount === null && amountCol >= 0) {
      amount = parseAmount(cells[amountCol] ?? "", decimal);
    }

    // El tipo forzado por el encabezado manda el signo: en un archivo de "Gastos", el
    // número (positivo) es un egreso. Sin esto, entraba como ingreso.
    if (amount !== null && forcedType) {
      amount = forcedType === "EXPENSE" ? -Math.abs(amount) : Math.abs(amount);
    }

    if (amount === null || amount === 0) {
      rejected.push({ line: lineNo, reason: "No se pudo leer el importe", raw: rawLine });
      return;
    }

    const description = descCols.map((i) => cells[i] ?? "").filter(Boolean).join(" · ").slice(0, 160);

    rows.push({
      date,
      description: description || "Movimiento importado",
      amount,
      balance: balanceCol >= 0 ? parseAmount(cells[balanceCol] ?? "", decimal) : null,
      raw: cells,
    });
  });

  // Diagnóstico: qué columna es qué, y qué falta. Esto es lo que el usuario ve cuando
  // algo no cierra, en vez de un "no se reconoció nada" sin explicación.
  const firstDataRow = body.find((r) => r.some(Boolean)) ?? [];
  const columns = roles.map((role, i) => ({
    index: i,
    role,
    header: headerRow?.[i] ?? null,
    sample: firstDataRow[i] ?? null,
  }));
  const notes: string[] = [];
  if (dateCol < 0)
    notes.push("No se detectó una columna de FECHA. Sin fecha no se puede importar; revisá el archivo o usá el asistente de mapeo.");
  if (amountCol < 0 && debitCol < 0 && creditCol < 0)
    notes.push("No se detectó una columna de IMPORTE (ni débito/crédito). Revisá el archivo o usá el asistente de mapeo.");
  if (rows.length === 0 && rejected.length > 0 && dateCol >= 0 && (amountCol >= 0 || debitCol >= 0 || creditCol >= 0))
    notes.push(`Se encontraron las columnas pero ninguna fila se pudo leer (${rejected.length} descartadas). Puede ser un formato de fecha o de número inesperado.`);

  return {
    mapping,
    rows,
    rejected,
    totalIncome: rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0),
    totalExpense: Math.abs(rows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0)),
    diagnostics: {
      columns,
      dateColumnFound: dateCol >= 0,
      amountColumnFound: amountCol >= 0 || debitCol >= 0 || creditCol >= 0,
      notes,
    },
  };
}

function emptyMapping(): ColumnMapping {
  return { roles: [], hasHeader: false, delimiter: ";", decimal: ",", dateFormat: "DMY" };
}

/**
 * Id de deduplicación para una fila importada.
 *
 * Un extracto bancario no trae id de transacción, así que lo derivamos del contenido.
 * Importar el mismo extracto dos veces (algo que pasa todo el tiempo: descargás enero
 * y después descargás enero-febrero) NO puede duplicar los movimientos de enero.
 *
 * El índice entra en el id a propósito: dos cafés de $3.500 el mismo día en el mismo
 * lugar son DOS gastos reales, no uno duplicado. Sin el índice, el segundo desaparece.
 */
/**
 * Fecha en formato YYYY-MM-DD tomando los componentes LOCALES.
 *
 * No se usa toISOString() a propósito: eso convierte a UTC y, según la zona horaria del
 * usuario, puede devolver el día anterior o el siguiente. Como esta cadena forma parte
 * del id que evita duplicados —y ese id queda guardado en la base—, tiene que ser el
 * mismo día calendario que el usuario ve, sin importar dónde esté.
 */
function localDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function importId(row: ParsedRow, indexWithinDay: number): string {
  const material = [
    localDateKey(row.date),
    row.amount.toFixed(2),
    row.description.toLowerCase().replace(/\s+/g, " ").trim(),
    indexWithinDay,
  ].join("|");

  // Hash simple y estable. No hace falta criptografía: esto no protege nada, solo
  // identifica. Y siendo puro, se puede testear sin traer node:crypto.
  let h = 5381;
  for (let i = 0; i < material.length; i++) h = ((h << 5) + h + material.charCodeAt(i)) >>> 0;
  return `csv-${h.toString(36)}-${material.length.toString(36)}`;
}

/** Asigna a cada fila su índice dentro del día, para que los repetidos no se pisen. */
export function withImportIds(rows: ParsedRow[]): (ParsedRow & { importId: string })[] {
  const seen = new Map<string, number>();

  return rows.map((row) => {
    const key = `${localDateKey(row.date)}|${row.amount.toFixed(2)}|${row.description}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return { ...row, importId: importId(row, n) };
  });
}
