/**
 * Mapeo Invertir Online → Finance OS. PURO: sin imports, sin IO, sin base de datos.
 *
 * ─── Fuente: modelo oficial PosicionModel de la API de IOL ───
 *   Activos[].PosicionModel {
 *     Cantidad, Comprometido, GananciaDinero, GananciaPorcentaje, PPC,
 *     PuntosVariacion, UltimoPrecio, Valorizado, VariacionDiaria,
 *     Titulo { Simbolo, Descripcion, Tipo, Mercado, Moneda, Pais, Plazo }
 *   }
 *
 * Mapea uno a uno con lo que hace falta: PPC es el precio promedio de compra,
 * Valorizado el valor total, GananciaDinero y GananciaPorcentaje la ganancia.
 * Nada de esto está inventado.
 */

import type { RawHolding, RawBalance } from "../../types";

/** Los `Tipo` que devuelve IOL, normalizados a algo mostrable. */
const KIND: Record<string, string> = {
  ACCIONES: "Acciones",
  CEDEARS: "CEDEARs",
  TITULOSPUBLICOS: "Bonos",
  BONOS: "Bonos",
  OBLIGACIONESNEGOCIABLES: "Obligaciones Negociables",
  ON: "Obligaciones Negociables",
  FONDOCOMUNDEINVERSION: "Fondos Comunes",
  FCI: "Fondos Comunes",
  OPCIONES: "Opciones",
  LETRAS: "Letras",
  CAUCIONES: "Cauciones",
};

/** La `Moneda` de IOL viene como enum con guiones bajos, no como código ISO. */
const CURRENCY: Record<string, string> = {
  PESO_ARGENTINO: "ARS",
  DOLAR_ESTADOUNIDENSE: "USD",
  DOLAR_ESTADOUNIDENSE_MEP: "USD",
  DOLAR_ESTADOUNIDENSE_CABLE: "USD",
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function normalizeKind(tipo: unknown): string {
  const raw = String(tipo ?? "").toUpperCase().replace(/[\s_-]/g, "");
  return KIND[raw] ?? String(tipo ?? "Otro");
}

export function normalizeCurrency(moneda: unknown): string {
  const raw = String(moneda ?? "").toUpperCase().replace(/\s/g, "_");
  return CURRENCY[raw] ?? "ARS";
}

/**
 * Una posición de la cartera.
 *
 * IOL ya calcula la ganancia por nosotros (GananciaDinero / GananciaPorcentaje).
 * Usamos SUS números en vez de recalcularlos: si nuestro cálculo difiere del que el
 * usuario ve en la app de IOL, el que está mal somos nosotros — y discutirle a su
 * broker sobre cuánto ganó es una pelea que no queremos y no podemos ganar.
 */
export function mapPosition(pos: any): RawHolding | null {
  const titulo = pos?.titulo ?? pos?.Titulo ?? {};
  const ticker = String(titulo?.simbolo ?? titulo?.Simbolo ?? "").trim();
  if (!ticker) return null;

  const quantity = num(pos?.cantidad ?? pos?.Cantidad);
  if (!quantity) return null; // posición cerrada

  const avgPrice = num(pos?.ppc ?? pos?.PPC);
  const currentPrice = num(pos?.ultimoPrecio ?? pos?.UltimoPrecio);
  const totalValue = num(pos?.valorizado ?? pos?.Valorizado);

  return {
    ticker,
    name: String(titulo?.descripcion ?? titulo?.Descripcion ?? ticker).slice(0, 160),
    kind: normalizeKind(titulo?.tipo ?? titulo?.Tipo),
    quantity,
    avgPrice,
    currentPrice,
    // Si IOL no valorizó (puede pasar fuera de rueda), lo derivamos.
    totalValue: totalValue || quantity * currentPrice,
    gainAmount: num(pos?.gananciaDinero ?? pos?.GananciaDinero),
    gainPct: num(pos?.gananciaPorcentaje ?? pos?.GananciaPorcentaje),
    currency: normalizeCurrency(titulo?.moneda ?? titulo?.Moneda),
    market: String(titulo?.mercado ?? titulo?.Mercado ?? "") || null,
    payload: pos,
  };
}

export function mapPortfolio(data: any): RawHolding[] {
  const activos: any[] = data?.activos ?? data?.Activos ?? [];
  if (!Array.isArray(activos)) return [];
  return activos.map(mapPosition).filter((h): h is RawHolding => h !== null);
}

/**
 * Saldo de la cuenta comitente.
 *
 * `estadocuenta` devuelve varias cuentas (pesos, dólares, y sus variantes). Nos
 * quedamos con la de pesos para conciliar, y reportamos el resto como advertencia
 * en vez de sumarlo a ciegas: sumar pesos y dólares como si fueran lo mismo es
 * exactamente el error que una app de finanzas no puede cometer.
 */
export function mapAccountStatus(data: any): { balance: RawBalance | null; warnings: string[] } {
  const cuentas: any[] = data?.cuentas ?? data?.Cuentas ?? [];
  const warnings: string[] = [];

  if (!Array.isArray(cuentas) || !cuentas.length) return { balance: null, warnings };

  const isArs = (c: any) =>
    String(c?.moneda ?? c?.Moneda ?? "").toLowerCase().includes("peso");

  const ars = cuentas.filter(isArs);
  const otras = cuentas.filter((c) => !isArs(c));

  if (otras.length) {
    const monedas = [...new Set(otras.map((c) => normalizeCurrency(c?.moneda ?? c?.Moneda)))];
    warnings.push(
      `IOL reporta saldo también en ${monedas.join(", ")}. Finance OS concilia solo la cuenta en pesos; el resto no se convierte automáticamente.`
    );
  }

  if (!ars.length) return { balance: null, warnings };

  const available = ars.reduce((s, c) => s + num(c?.disponible ?? c?.Disponible), 0);
  const committed = ars.reduce((s, c) => s + num(c?.comprometido ?? c?.Comprometido), 0);
  const total = ars.reduce(
    (s, c) => s + num(c?.total ?? c?.Total ?? c?.saldo ?? c?.Saldo),
    0
  );

  return {
    balance: {
      available,
      currency: "ARS",
      reserved: committed,
      invested: Math.max(total - available - committed, 0),
    },
    warnings,
  };
}

// ─────────────────────── Operaciones (historial) ───────────────────────
//
// ⚠️ VERIFICAR CONTRA RESPUESTA REAL DE IOL ⚠️
// Esto mapea GET /api/v2/operaciones a operaciones normalizadas. Los nombres de campo
// (numero, tipo, fechaOperada, simbolo, cantidad, precio, montoOperado, moneda) salen
// de la documentación de IOL, pero la API a veces varía en mayúsculas o nombres. Por eso
// cada campo se lee con varios alias posibles y `num()` tolera strings. Cuando conectes
// tu cuenta real, si algún dato sale en cero o vacío, es acá donde se ajusta el nombre.

import type { Operation, OperationType } from "../../../lib/portfolio";

/** Clasifica el `tipo` de IOL (texto en español) a un OperationType normalizado. */
export function classifyOperation(tipo: unknown): OperationType {
  const t = String(tipo ?? "").toLowerCase();
  if (t.includes("suscrip")) return "SUBSCRIPTION"; // FCI
  if (t.includes("rescate")) return "REDEMPTION"; // FCI
  if (t.includes("compra")) return "BUY";
  if (t.includes("venta")) return "SELL";
  if (t.includes("dividendo")) return "DIVIDEND";
  if (t.includes("amortiz") || t.includes("cupon") || t.includes("cupón")) return "COUPON";
  if (t.includes("interes") || t.includes("interés") || t.includes("renta")) return "INTEREST";
  if (t.includes("transfer")) return "TRANSFER";
  if (t.includes("ajuste")) return "ADJUSTMENT";
  return "OTHER";
}

/** Primer valor definido entre varios alias de un campo (IOL varía las mayúsculas). */
function pick(obj: unknown, ...keys: string[]): unknown {
  const o = obj as Record<string, unknown> | null | undefined;
  for (const k of keys) {
    if (o && o[k] !== undefined && o[k] !== null) return o[k];
  }
  return undefined;
}

/**
 * GET /api/v2/operaciones → Operation[] normalizadas.
 *
 * Solo se toman las operaciones TERMINADAS (las canceladas o pendientes no movieron
 * plata y no deben entrar al Ledger). El `numero` de IOL es el identificador único que
 * usa la sincronización para no duplicar.
 */
export function mapOperations(raw: unknown): Operation[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: Operation[] = [];

  for (const item of list) {
    // Estado: solo las terminadas. IOL usa "terminada"/"terminado"/"operada".
    const estado = String(pick(item, "estado", "Estado") ?? "").toLowerCase();
    if (estado && !(estado.includes("termin") || estado.includes("operad") || estado.includes("cumplid")))
      continue;

    const id = pick(item, "numero", "numeroOperacion", "Numero", "id");
    if (id === undefined) continue; // sin identificador no se puede deduplicar

    const rawDate = pick(item, "fechaOperada", "fechaOrden", "fecha", "FechaOperada", "fechaAlta");
    const date = rawDate ? new Date(String(rawDate)) : null;
    if (!date || Number.isNaN(date.getTime())) continue; // sin fecha válida, no entra

    const type = classifyOperation(pick(item, "tipo", "Tipo"));
    const symbolRaw = pick(item, "simbolo", "Simbolo", "titulo", "ticker");
    const symbol = symbolRaw ? String(symbolRaw).toUpperCase() : null;

    const quantity = num(pick(item, "cantidad", "Cantidad", "cantidadOperada"));
    const price = num(pick(item, "precio", "Precio", "precioOperado", "precioPromedio"));
    // El monto puede venir con distintos nombres; si no viene, se deriva de cant×precio.
    const amountRaw = pick(item, "montoOperado", "monto", "Monto", "importe", "neto");
    const amount = amountRaw !== undefined ? Math.abs(num(amountRaw)) : Math.abs(quantity * price);

    const currency = CURRENCY[String(pick(item, "moneda", "Moneda") ?? "").toUpperCase()] ?? "ARS";

    out.push({ id: String(id), type, date, symbol, quantity, price, amount, currency });
  }

  return out;
}
