/**
 * Tests de los parsers de formatos de intercambio bancario (OFX y QIF).
 *
 * Son funciones PURAS: texto → filas. Sin File, sin FileReader, sin red, sin DOM. Por eso
 * se pueden correr en Node y verificar con archivos de ejemplo reales (los que exportan
 * los homebanking), que es lo único que da confianza de verdad en un importador.
 *
 * Se corre con: npm test  (desde client/)
 */

import { parseOfx } from "../src/lib/import/importers/ofx.ts";
import { parseQif } from "../src/lib/import/importers/qif.ts";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failures.push(name); console.log(`  ✗ ${name}\n      ${(e as Error).message}`); }
}
function eq(a: unknown, b: unknown, what: string) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${what}: esperaba ${sb}, obtuve ${sa}`);
}

// ─── OFX ───
// Archivo real recortado: encabezado SGML (etiquetas que NO cierran) + dos movimientos.
const OFX_SAMPLE = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>ARS
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260315120000
<TRNAMT>-8500.00
<FITID>0001
<NAME>SUPERMERCADO COTO
<MEMO>Compra debito
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260316
<TRNAMT>150000.00
<FITID>0002
<NAME>TRANSFERENCIA RECIBIDA
</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

console.log("\n─── OFX ───\n");

test("encabezado conocido para que el servidor mapee las columnas", () => {
  eq(parseOfx(OFX_SAMPLE)[0], ["Fecha", "Descripción", "Monto"], "encabezado");
});

test("lee los dos movimientos", () => {
  eq(parseOfx(OFX_SAMPLE).length, 3, "encabezado + 2 filas");
});

test("la fecha YYYYMMDDHHMMSS queda ISO, sin ambigüedad", () => {
  eq(parseOfx(OFX_SAMPLE)[1][0], "2026-03-15", "fecha del débito");
  eq(parseOfx(OFX_SAMPLE)[2][0], "2026-03-16", "fecha sin hora también");
});

test("conserva el signo: débito negativo, crédito positivo", () => {
  eq(parseOfx(OFX_SAMPLE)[1][2], "-8500.00", "débito");
  eq(parseOfx(OFX_SAMPLE)[2][2], "150000.00", "crédito");
});

test("junta NAME y MEMO en la descripción", () => {
  eq(parseOfx(OFX_SAMPLE)[1][1], "SUPERMERCADO COTO · Compra debito", "descripción");
});

test("si solo hay NAME, no deja separador colgando", () => {
  eq(parseOfx(OFX_SAMPLE)[2][1], "TRANSFERENCIA RECIBIDA", "descripción");
});

test("tolera etiquetas que SÍ cierran (OFX 2.0, XML)", () => {
  const xml = `<OFX><STMTTRN><DTPOSTED>20260401</DTPOSTED><TRNAMT>-1200.50</TRNAMT><NAME>NETFLIX</NAME></STMTTRN></OFX>`;
  eq(parseOfx(xml)[1], ["2026-04-01", "NETFLIX", "-1200.50"], "fila");
});

test("un bloque sin monto se saltea (no inventa un movimiento en cero)", () => {
  const sinMonto = `<STMTTRN><DTPOSTED>20260401</DTPOSTED><NAME>ALGO</NAME></STMTTRN>`;
  eq(parseOfx(sinMonto).length, 1, "solo el encabezado");
});

test("archivo sin movimientos no rompe", () => {
  eq(parseOfx("texto cualquiera").length, 1, "solo el encabezado");
});

// ─── QIF ───
const QIF_SAMPLE = `!Type:Bank
D03/15/2026
T-8,500.00
PSUPERMERCADO COTO
MCompra changas
^
D03/16/2026
U150000.00
PTRANSFERENCIA RECIBIDA
^`;

console.log("\n─── QIF ───\n");

test("encabezado conocido", () => {
  eq(parseQif(QIF_SAMPLE)[0], ["Fecha", "Descripción", "Monto"], "encabezado");
});

test("lee las dos transacciones separadas por ^", () => {
  eq(parseQif(QIF_SAMPLE).length, 3, "encabezado + 2 filas");
});

test("saca las comas de miles y conserva el signo", () => {
  eq(parseQif(QIF_SAMPLE)[1][2], "-8500.00", "monto negativo limpio");
});

test("acepta U además de T como monto", () => {
  eq(parseQif(QIF_SAMPLE)[2][2], "150000.00", "monto con U");
});

test("junta payee y memo", () => {
  eq(parseQif(QIF_SAMPLE)[1][1], "SUPERMERCADO COTO · Compra changas", "descripción");
});

test("ignora la línea de tipo (!Type:Bank)", () => {
  eq(parseQif(QIF_SAMPLE)[1][0], "03/15/2026", "la primera fila es la transacción, no el tipo");
});

test("la última transacción cuenta aunque el archivo no termine con ^", () => {
  const sinCierre = `!Type:Bank\nD04/01/2026\nT-999.00\nPKIOSCO`;
  eq(parseQif(sinCierre).length, 2, "encabezado + 1 fila");
  eq(parseQif(sinCierre)[1][1], "KIOSCO", "descripción");
});

test("un bloque sin monto no genera fila", () => {
  eq(parseQif(`!Type:Bank\nD04/01/2026\nPSOLO PAYEE\n^`).length, 1, "solo el encabezado");
});

test("archivo vacío no rompe", () => {
  eq(parseQif("").length, 1, "solo el encabezado");
});

console.log(
  failures.length
    ? `\n❌ ${failures.length} fallaron, ${passed} pasaron\n`
    : `\n${passed}/${passed} tests de formatos de importación pasaron\n`
);
if (failures.length) process.exit(1);
