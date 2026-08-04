/**
 * Tests del importador de extractos.
 *
 * Con formatos REALES de bancos argentinos. Las dos trampas que se testean con más
 * saña son las que producen errores catastróficos y silenciosos:
 *
 *   1. El separador decimal. "1.234" son $1.234 acá y $1,23 en Estados Unidos.
 *      Equivocarse es errar el patrimonio por tres órdenes de magnitud.
 *
 *   2. El formato de fecha. 03/04 es 3 de abril o 4 de marzo. No hay forma de saberlo
 *      mirando una fila sola.
 */

import {
  analyze, detectDelimiter, detectDecimal, detectDateFormat, parseAmount, parseDate,
  splitCsvLine, withImportIds, type ParsedRow,
} from "../src/integrations/import/statement";

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e: any) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}

function eq(actual: any, expected: any, what: string) {
  const a = actual instanceof Date ? actual.toISOString().slice(0, 10) : actual;
  const b = expected instanceof Date ? expected.toISOString().slice(0, 10) : expected;
  if (a !== b) throw new Error(`${what}: esperaba ${JSON.stringify(b)}, obtuve ${JSON.stringify(a)}`);
}

console.log("\n─── El separador decimal (errarle es errar por 1000x) ───\n");

test("1.234,56 en formato argentino es mil doscientos treinta y cuatro", () => {
  eq(parseAmount("1.234,56", ","), 1234.56, "monto");
});

test("1,234.56 en formato americano es lo mismo", () => {
  eq(parseAmount("1,234.56", "."), 1234.56, "monto");
});

test("detecta coma decimal en un extracto argentino", () => {
  eq(detectDecimal(["1.234,56", "890,00", "12.000,75"]), ",", "decimal");
});

test("detecta punto decimal en un extracto americano", () => {
  eq(detectDecimal(["1,234.56", "890.00", "12,000.75"]), ".", "decimal");
});

test("ante la duda, asume Argentina", () => {
  eq(detectDecimal(["1234", "5678"]), ",", "decimal");
});

test("los paréntesis significan negativo (contabilidad)", () => {
  eq(parseAmount("(1.500,00)", ","), -1500, "monto");
});

test("el menos al final también es negativo (algunos bancos lo hacen)", () => {
  eq(parseAmount("1.500,00-", ","), -1500, "monto");
});

test("el signo peso y los espacios no molestan", () => {
  eq(parseAmount("$ 45.000,00", ","), 45000, "monto");
});

console.log("\n─── Fechas (03/04 es abril o marzo, según el país) ───\n");

test("DD/MM/YYYY es el default argentino", () => {
  eq(parseDate("03/04/2026", "DMY"), new Date(Date.UTC(2026, 3, 3)), "3 de abril");
});

test("MM/DD/YYYY da otro día distinto con el mismo texto", () => {
  eq(parseDate("03/04/2026", "MDY"), new Date(Date.UTC(2026, 2, 4)), "4 de marzo");
});

test("un día > 12 delata que el formato es DMY", () => {
  eq(detectDateFormat(["03/04/2026", "25/04/2026", "01/05/2026"]), "DMY", "formato");
});

test("un mes > 12 en segunda posición delata MDY", () => {
  eq(detectDateFormat(["04/25/2026", "03/14/2026"]), "MDY", "formato");
});

test("el año primero no tiene ambigüedad", () => {
  eq(detectDateFormat(["2026-04-03"]), "YMD", "formato");
});

test("el 31 de febrero se rechaza (JS lo 'corregiría' al 3 de marzo en silencio)", () => {
  eq(parseDate("31/02/2026", "DMY"), null, "fecha imposible");
});

console.log("\n─── Separadores y comillas ───\n");

test("detecta punto y coma (Galicia, Santander)", () => {
  eq(detectDelimiter(["Fecha;Detalle;Importe", "03/04/2026;Pago;1.000,00"]), ";", "separador");
});

test("detecta coma", () => {
  eq(detectDelimiter(["date,description,amount", "2026-04-03,Payment,1000.00"]), ",", "separador");
});

test("detecta pipe (Macro)", () => {
  eq(detectDelimiter(["Fecha|Detalle|Importe", "03/04/2026|Pago|1.000,00"]), "|", "separador");
});

test("un campo entrecomillado puede contener el separador", () => {
  const cells = splitCsvLine('03/04/2026;"Pago a Kevin, sesión";1.000,00', ";");
  eq(cells.length, 3, "columnas");
  eq(cells[1], "Pago a Kevin, sesión", "descripción con coma adentro");
});

console.log("\n─── Formatos reales de bancos ───\n");

test("Galicia: débito y crédito en columnas separadas", () => {
  const csv = [
    "Fecha;Descripción;Débito;Crédito;Saldo",
    "03/04/2026;TRANSFERENCIA RECIBIDA;;250.000,00;350.000,00",
    "05/04/2026;PAGO TARJETA VISA;85.400,50;;264.599,50",
  ].join("\n");

  const p = analyze(csv);
  eq(p.rows.length, 2, "filas");
  eq(p.rows[0].amount, 250000, "el crédito entra positivo");
  eq(p.rows[1].amount, -85400.5, "el débito entra negativo");
  eq(p.rows[0].balance, 350000, "saldo");
  eq(p.rejected.length, 0, "sin rechazos");
});

test("Santander: una sola columna de importe con signo", () => {
  const csv = [
    "FECHA,CONCEPTO,IMPORTE",
    "03/04/2026,ACREDITACION HABERES,\"450.000,00\"",
    "07/04/2026,DEBITO AUTOMATICO EDESUR,\"-12.350,80\"",
  ].join("\n");

  const p = analyze(csv);
  eq(p.rows.length, 2, "filas");
  eq(p.rows[0].amount, 450000, "ingreso");
  eq(p.rows[1].amount, -12350.8, "gasto");
});

test("Macro: separado por pipe", () => {
  const csv = [
    "Fecha Mov.|Detalle|Importe|Saldo",
    "10/04/2026|COMPRA DEBITO CARREFOUR|-32.500,00|180.000,00",
  ].join("\n");

  const p = analyze(csv);
  eq(p.rows.length, 1, "filas");
  eq(p.rows[0].amount, -32500, "gasto");
  eq(p.rows[0].description, "COMPRA DEBITO CARREFOUR", "descripción");
});

test("Brubank: formato inglés, ISO, decimal con punto", () => {
  const csv = ["date,description,amount", "2026-04-03,Transfer received,150000.00"].join("\n");
  const p = analyze(csv);
  eq(p.rows.length, 1, "filas");
  eq(p.rows[0].amount, 150000, "monto");
  eq(p.rows[0].date.toISOString().slice(0, 10), "2026-04-03", "fecha");
});

test("un CSV sin encabezado también se entiende", () => {
  const csv = ["03/04/2026;PAGO;-1.000,00", "04/04/2026;COBRO;5.000,00"].join("\n");
  const p = analyze(csv);
  eq(p.mapping.hasHeader, false, "sin encabezado");
  eq(p.rows.length, 2, "filas");
});

test("totales de ingreso y gasto", () => {
  const csv = [
    "Fecha;Detalle;Importe",
    "03/04/2026;COBRO;100.000,00",
    "04/04/2026;PAGO;-30.000,00",
  ].join("\n");
  const p = analyze(csv);
  eq(p.totalIncome, 100000, "ingresos");
  eq(p.totalExpense, 30000, "gastos");
});

console.log("\n─── Filas malas: se muestran, no se ocultan ───\n");

test("una fila sin fecha válida se rechaza con el motivo", () => {
  const csv = ["Fecha;Detalle;Importe", "basura;PAGO;-1.000,00"].join("\n");
  const p = analyze(csv);
  eq(p.rows.length, 0, "no se importa");
  eq(p.rejected.length, 1, "queda registrada");
  eq(p.rejected[0].reason, "No se pudo leer la fecha", "motivo");
});

test("una fila sin importe se rechaza", () => {
  const csv = ["Fecha;Detalle;Importe", "03/04/2026;PAGO;"].join("\n");
  const p = analyze(csv);
  eq(p.rejected.length, 1, "rechazada");
});

test("un archivo vacío no rompe", () => {
  eq(analyze("").rows.length, 0, "sin filas");
});

console.log("\n─── Deduplicación (importar el mismo extracto dos veces) ───\n");

const row = (over: Partial<ParsedRow> = {}): ParsedRow => ({
  date: new Date(Date.UTC(2026, 3, 3)),
  description: "CAFE MARTINEZ",
  amount: -3500,
  balance: null,
  raw: [],
  ...over,
});

test("la misma fila da el mismo id: reimportar NO duplica", () => {
  const a = withImportIds([row()]);
  const b = withImportIds([row()]);
  eq(a[0].importId, b[0].importId, "id estable");
});

test("dos cafés iguales el mismo día son DOS gastos, no uno duplicado", () => {
  // Este es el caso que rompe a los importadores ingenuos: deduplican por contenido y
  // se comen el segundo café, que era real.
  const ids = withImportIds([row(), row()]);
  if (ids[0].importId === ids[1].importId)
    throw new Error("se comió el segundo gasto real");
});

test("un monto distinto da un id distinto", () => {
  const a = withImportIds([row()]);
  const b = withImportIds([row({ amount: -4000 })]);
  if (a[0].importId === b[0].importId) throw new Error("montos distintos comparten id");
});

test("reimportar enero-febrero sobre enero no duplica enero", () => {
  const enero = [row({ date: new Date(Date.UTC(2026, 0, 5)) })];
  const eneroFebrero = [
    row({ date: new Date(Date.UTC(2026, 0, 5)) }),
    row({ date: new Date(Date.UTC(2026, 1, 8)), description: "OTRO" }),
  ];

  const first = withImportIds(enero);
  const second = withImportIds(eneroFebrero);

  eq(second[0].importId, first[0].importId, "enero conserva su id");
  if (second[1].importId === first[0].importId) throw new Error("febrero pisó a enero");
});

// ─────────── Robustez de detección (los arreglos de la fase final) ───────────

test("extracto con filas de preámbulo antes de la tabla se importa igual", () => {
  // El caso real que rompía todo: banco que pone titular/período/cuenta arriba.
  const csv = [
    "Banco Galicia S.A.",
    "Titular: Juan Perez",
    "Período: 01/06/2023 al 30/06/2023",
    "Cuenta: 1234-5678/9",
    "",
    "Fecha;Descripción;Débito;Crédito;Saldo",
    "05/06/2023;Compra supermercado;15000,00;;185000,00",
    "10/06/2023;Transferencia recibida;;50000,00;235000,00",
    "15/06/2023;Pago de servicios;8500,00;;226500,00",
  ].join("\n");
  const p = analyze(csv);
  if (p.rows.length < 3) throw new Error(`esperaba 3+ movimientos, obtuve ${p.rows.length}. notas: ${p.diagnostics.notes.join(" | ")}`);
});

test("header 'Fecha Movimiento' / 'Concepto' / 'Total' se reconocen (sinónimos)", () => {
  const csv = [
    "Fecha Movimiento;Concepto;Total",
    "01/07/2023;Sueldo;500000,00",
    "03/07/2023;Alquiler;-250000,00",
  ].join("\n");
  const p = analyze(csv);
  eq(p.rows.length, 2, "dos movimientos con sinónimos");
});

test("header 'Ingreso' / 'Egreso' se mapean a crédito/débito", () => {
  const csv = [
    "Fecha;Detalle;Egreso;Ingreso",
    "01/07/2023;Compra;3500,00;",
    "02/07/2023;Cobro;;12000,00",
  ].join("\n");
  const p = analyze(csv);
  eq(p.rows.length, 2, "dos movimientos");
  // Egreso negativo, ingreso positivo.
  const compra = p.rows.find((r) => r.description.includes("Compra"));
  const cobro = p.rows.find((r) => r.description.includes("Cobro"));
  eq(compra!.amount < 0, true, "egreso es negativo");
  eq(cobro!.amount > 0, true, "ingreso es positivo");
});

test("headers en inglés (Transaction Date / Description / Amount) funcionan", () => {
  const csv = [
    "Transaction Date,Description,Amount",
    "2023-07-01,Coffee shop,-5.50",
    "2023-07-02,Salary,3000.00",
  ].join("\n");
  const p = analyze(csv);
  eq(p.rows.length, 2, "dos movimientos en inglés");
});

test("el diagnóstico dice qué columna es cada una", () => {
  const csv = "Fecha;Detalle;Importe\n01/07/2023;Test;1000,00";
  const p = analyze(csv);
  const roles = p.diagnostics.columns.map((c) => c.role);
  eq(roles.includes("date"), true, "detectó fecha");
  eq(roles.includes("description"), true, "detectó descripción");
  eq(roles.includes("amount"), true, "detectó importe");
  eq(p.diagnostics.dateColumnFound, true, "marca fecha encontrada");
  eq(p.diagnostics.amountColumnFound, true, "marca importe encontrado");
});

test("si falta la fecha, el diagnóstico lo dice explícitamente (no error genérico)", () => {
  // Archivo sin ninguna columna de fecha.
  const csv = "Detalle;Importe\nCompra;1000,00\nVenta;2000,00";
  const p = analyze(csv);
  eq(p.rows.length, 0, "no importa nada sin fecha");
  eq(p.diagnostics.dateColumnFound, false, "marca que falta la fecha");
  if (!p.diagnostics.notes.some((n) => n.toUpperCase().includes("FECHA")))
    throw new Error("el diagnóstico debería mencionar que falta la FECHA");
});

test("una celda vacía suelta no rompe la detección de toda la columna (mayoría)", () => {
  // Antes: con .every(), una fila con importe vacío tiraba la columna entera.
  const csv = [
    "Fecha;Detalle;Importe",
    "01/07/2023;Con monto;1000,00",
    "02/07/2023;Sin monto;",
    "03/07/2023;Con monto;2000,00",
  ].join("\n");
  const p = analyze(csv);
  // La columna Importe se detecta igual; la fila sin monto se descarta con motivo.
  if (p.rows.length < 2) throw new Error(`esperaba 2 con monto, obtuve ${p.rows.length}`);
  eq(p.diagnostics.amountColumnFound, true, "importe detectado pese a la celda vacía");
});


// ─────────── El caso real de la captura (Notion export) ───────────

test("columna llamada 'Ingreso' pero con TEXTO no se trata como importe (usa Cantidad)", () => {
  // Reproduce el archivo de la captura: Fecha, Mes, Ingreso (fuente = texto), Cantidad (número).
  // Antes: "Ingreso"→crédito agarraba el texto, parseAmount fallaba, se descartaba todo.
  const csv = [
    "Fecha,Mes,Ingreso,Cantidad",
    "16/07/2026,Julio,Sueldo,500000",
    "18/07/2026,Julio,Freelance,120000",
    "20/07/2026,Julio,Venta,35000",
  ].join("\n");
  const p = analyze(csv);
  if (p.rows.length !== 3)
    throw new Error(`esperaba 3 movimientos, obtuve ${p.rows.length}. notas: ${p.diagnostics.notes.join(" | ")}`);
  // El importe salió de "Cantidad", no del texto de "Ingreso".
  // El importe salió de "Cantidad" (número), no del texto de "Ingreso". Y "Sueldo"
  // (texto de Ingreso) quedó en la descripción, no se perdió.
  const sueldo = p.rows.find((r) => r.description.includes("Sueldo"));
  eq(!!sueldo, true, "la fila de Sueldo se importó con su texto en la descripción");
  eq(sueldo?.amount, 500000, "el importe es el número de Cantidad");
});

test("fechas con nombre de mes en español: '16 de julio de 2026'", () => {
  const csv = [
    "Fecha,Concepto,Importe",
    "16 de julio de 2026,Cobro,500000",
    "3 de agosto de 2026,Gasto,-25000",
  ].join("\n");
  const p = analyze(csv);
  eq(p.rows.length, 2, "dos movimientos con fecha en texto español");
});

test("fechas con nombre de mes en inglés: 'July 16, 2026'", () => {
  const csv = [
    "Date,Description,Amount",
    '"July 16, 2026",Salary,3000',
    '"August 3, 2026",Rent,-1200',
  ].join("\n");
  const p = analyze(csv);
  eq(p.rows.length, 2, "dos movimientos con fecha en texto inglés");
});

test("fecha abreviada '16 Jul 2026' funciona", () => {
  const csv = "Fecha,Detalle,Monto\n16 Jul 2026,Test,1000\n17 Ago 2026,Test2,2000";
  const p = analyze(csv);
  eq(p.rows.length, 2, "fechas abreviadas");
});



// ─────────── CSV reales de Notion: Ingresos y Gastos (bug reportado) ───────────

test("Notion INGRESOS (Ingreso, Cantidad, Fecha, Mes, TAG) → todos INCOME", () => {
  const csv = [
    "Ingreso,Cantidad,Fecha,Mes,TAG",
    "Sueldo,500000,16/07/2026,Julio,Trabajo",
    "Freelance,120000,18/07/2026,Julio,Extra",
    "Venta usados,35000,20/07/2026,Julio,Otros",
  ].join("\n");
  const p = analyze(csv);
  eq(p.rows.length, 3, "tres ingresos");
  // Todos positivos (INCOME).
  eq(p.rows.every((r) => r.amount > 0), true, "todos los ingresos son positivos");
  // El texto de "Ingreso" (Sueldo…) quedó en la descripción.
  eq(p.rows.some((r) => r.description.includes("Sueldo")), true, "Sueldo en la descripción");
});

test("Notion GASTOS (Gasto, Cantidad, Categoria, Fecha, Mes) → todos EXPENSE", () => {
  // Este es el que rompía: la plata es positiva y entraba como ingreso.
  const csv = [
    "Gasto,Cantidad,Categoria,Fecha,Mes",
    "Supermercado,45000,Comida,05/07/2026,Julio",
    "Nafta,30000,Transporte,08/07/2026,Julio",
    "Netflix,8500,Suscripciones,15/07/2026,Julio",
  ].join("\n");
  const p = analyze(csv);
  eq(p.rows.length, 3, "tres gastos");
  // TODOS negativos (EXPENSE), aunque la Cantidad venga positiva.
  eq(p.rows.every((r) => r.amount < 0), true, "todos los gastos son negativos");
  // El texto de "Gasto" (Supermercado…) quedó en la descripción.
  eq(p.rows.some((r) => r.description.includes("Supermercado")), true, "Supermercado en la descripción");
  // El importe es el número de Cantidad (con signo negativo).
  const superm = p.rows.find((r) => r.description.includes("Supermercado"));
  eq(superm?.amount, -45000, "Supermercado = -45000");
});

test("un banco con Ingreso Y Egreso (columnas numéricas) NO se fuerza a un solo tipo", () => {
  // Caso opuesto: acá Ingreso/Egreso son montos, y cada fila es lo que corresponda.
  const csv = [
    "Fecha;Detalle;Egreso;Ingreso",
    "01/07/2026;Compra;3500,00;",
    "02/07/2026;Cobro;;12000,00",
  ].join("\n");
  const p = analyze(csv);
  eq(p.rows.length, 2, "dos movimientos");
  const compra = p.rows.find((r) => r.description.includes("Compra"));
  const cobro = p.rows.find((r) => r.description.includes("Cobro"));
  eq(compra!.amount < 0, true, "el egreso es negativo");
  eq(cobro!.amount > 0, true, "el ingreso es positivo");
});


console.log(
  failures.length
    ? `\n❌ ${failures.length} fallaron, ${passed} pasaron\n`
    : `\n${passed}/${passed} tests del importador pasaron\n`
);

if (failures.length) process.exit(1);
