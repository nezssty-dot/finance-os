/**
 * Reconstrucción de cartera desde el historial de operaciones. PURO: sin red, sin base.
 *
 * ─── QUÉ RESUELVE ───
 *
 * IOL te da la foto ACTUAL de tu cartera (posiciones + PPC). Pero para saber cuánto
 * ganaste realizado, qué cobraste de dividendos, y cómo evolucionó tu patrimonio, hace
 * falta el HISTORIAL de operaciones. Esta función toma esa lista de operaciones y
 * reconstruye, paso a paso y en orden cronológico, el estado de cada activo.
 *
 * ─── EL MÉTODO DE COSTO: PROMEDIO PONDERADO ───
 *
 * Es el mismo que usa IOL (PPC = precio promedio de compra) y el estándar para cartera
 * en Argentina:
 *
 *   - COMPRA: el costo promedio se recalcula ponderando lo que ya tenías con lo nuevo.
 *       nuevoPPC = (cantidadVieja×PPCviejo + cantidadComprada×precioCompra) / cantidadTotal
 *   - VENTA: el costo promedio NO cambia. Se realiza la ganancia:
 *       gananciaRealizada += (precioVenta − PPC) × cantidadVendida
 *     y la cantidad baja. Si vendés todo, el PPC vuelve a cero.
 *
 * Esto es deterministico: las mismas operaciones dan siempre el mismo resultado. Por eso
 * se puede testear de verdad, que en algo que toca tu patrimonio no es negociable.
 *
 * ─── LO QUE NO HACE (a propósito) ───
 *
 * No inventa precios de mercado. La ganancia NO realizada necesita el precio ACTUAL, que
 * viene de la foto de la cartera (portafolio), no del historial. Para eso está
 * `unrealizedPnL()`, que combina el PPC reconstruido acá con el precio actual de afuera.
 *
 * Tampoco maneja splits ni canjes por sí solo: si IOL los reporta como operaciones
 * (ajustes), entran como tales; si no, el PPC podría diferir del de IOL. Por eso la foto
 * de IOL sigue siendo la autoridad para las posiciones actuales, y esto reconstruye el
 * FLUJO y lo realizado.
 */

/** Los tipos de operación que nos importan, ya normalizados desde IOL. */
export type OperationType =
  | "BUY" // Compra de acciones, CEDEARs, bonos, ON
  | "SELL" // Venta
  | "SUBSCRIPTION" // Suscripción de FCI (equivale a comprar)
  | "REDEMPTION" // Rescate de FCI (equivale a vender)
  | "DIVIDEND" // Dividendos (plata que entra)
  | "INTEREST" // Intereses / renta (plata que entra)
  | "COUPON" // Cupón / amortización de bono (plata que entra)
  | "ADJUSTMENT" // Ajuste
  | "TRANSFER" // Transferencia de efectivo
  | "OTHER"; // Cualquier otra cosa que reporte la API

/** Una operación normalizada. `id` es el identificador único de IOL (para deduplicar). */
export interface Operation {
  id: string;
  type: OperationType;
  date: Date;
  /** Ticker del activo. `null` para movimientos de efectivo (transferencias, ajustes). */
  symbol: string | null;
  /** Cantidad de nominales. 0 para operaciones de efectivo. */
  quantity: number;
  /** Precio por nominal. 0 para operaciones de efectivo. */
  price: number;
  /** Monto total en efectivo de la operación (siempre positivo; el signo lo da el tipo). */
  amount: number;
  currency: string; // "ARS" | "USD"
}

/** El estado reconstruido de un activo. */
export interface AssetPosition {
  symbol: string;
  currency: string;
  quantity: number;
  /** Precio promedio de compra (PPC). 0 si la posición está cerrada. */
  avgCost: number;
  /** Costo de las tenencias actuales: quantity × avgCost. */
  costBasis: number;
  /** Ganancia/pérdida REALIZADA acumulada (de las ventas). */
  realizedPnL: number;
  /** Dividendos + intereses + cupones cobrados de este activo. */
  incomeReceived: number;
}

/** Una entrada para el Ledger: cómo se registra la operación como movimiento. */
export interface LedgerEntry {
  operationId: string;
  date: Date;
  /** Tipo de movimiento del Ledger (respeta el modelo existente). */
  kind: "INVESTMENT" | "INCOME";
  /** Monto con signo: negativo = sale plata (compra), positivo = entra (venta, renta). */
  signedAmount: number;
  currency: string;
  description: string;
}

export interface ReconstructionResult {
  /** Posiciones abiertas (cantidad > 0), ordenadas por costo descendente. */
  positions: AssetPosition[];
  /** Posiciones cerradas (se vendió todo), con su ganancia realizada. */
  closedPositions: AssetPosition[];
  /** Costo invertido actual por moneda: { ARS: 500000, USD: 1200 }. */
  investedByCurrency: Record<string, number>;
  /** Ganancia realizada total por moneda. */
  realizedByCurrency: Record<string, number>;
  /** Renta cobrada (dividendos+intereses+cupones) por moneda. */
  incomeByCurrency: Record<string, number>;
  /** Cada operación como movimiento del Ledger, en orden cronológico. */
  ledger: LedgerEntry[];
}

const BUY_TYPES = new Set<OperationType>(["BUY", "SUBSCRIPTION"]);
const SELL_TYPES = new Set<OperationType>(["SELL", "REDEMPTION"]);
const INCOME_TYPES = new Set<OperationType>(["DIVIDEND", "INTEREST", "COUPON"]);

const LABEL: Record<OperationType, string> = {
  BUY: "Compra",
  SELL: "Venta",
  SUBSCRIPTION: "Suscripción FCI",
  REDEMPTION: "Rescate FCI",
  DIVIDEND: "Dividendos",
  INTEREST: "Intereses",
  COUPON: "Cupón/Amortización",
  ADJUSTMENT: "Ajuste",
  TRANSFER: "Transferencia",
  OTHER: "Movimiento",
};

/** Clave de un activo: el mismo ticker en distinta moneda es una posición distinta. */
function key(symbol: string, currency: string): string {
  return `${symbol}|${currency}`;
}

export function reconstructPortfolio(operations: Operation[]): ReconstructionResult {
  // Cronológico y estable: el orden de las operaciones define el PPC, así que hay que
  // procesarlas en el orden en que ocurrieron. Ante misma fecha, se respeta el orden de
  // entrada (que IOL suele dar por número de operación).
  const ordered = [...operations].sort((a, b) => a.date.getTime() - b.date.getTime());

  const book = new Map<string, AssetPosition>();
  const ledger: LedgerEntry[] = [];

  const ensure = (symbol: string, currency: string): AssetPosition => {
    const k = key(symbol, currency);
    let pos = book.get(k);
    if (!pos) {
      pos = {
        symbol,
        currency,
        quantity: 0,
        avgCost: 0,
        costBasis: 0,
        realizedPnL: 0,
        incomeReceived: 0,
      };
      book.set(k, pos);
    }
    return pos;
  };

  for (const op of ordered) {
    // Movimientos de efectivo sin activo: van al ledger, no tocan posiciones.
    if (BUY_TYPES.has(op.type) && op.symbol) {
      const pos = ensure(op.symbol, op.currency);
      const newQty = pos.quantity + op.quantity;
      // Costo total viejo + costo de lo comprado, sobre la cantidad total.
      const totalCost = pos.quantity * pos.avgCost + op.quantity * op.price;
      pos.quantity = newQty;
      pos.avgCost = newQty > 0 ? totalCost / newQty : 0;
      pos.costBasis = pos.quantity * pos.avgCost;
      ledger.push({
        operationId: op.id,
        date: op.date,
        kind: "INVESTMENT",
        signedAmount: -Math.abs(op.amount), // sale plata para comprar
        currency: op.currency,
        description: `${LABEL[op.type]} ${op.quantity} ${op.symbol}`,
      });
    } else if (SELL_TYPES.has(op.type) && op.symbol) {
      const pos = ensure(op.symbol, op.currency);
      // No se puede vender más de lo que hay; si el historial viene incompleto, se acota
      // para no inventar cantidades negativas.
      const soldQty = Math.min(op.quantity, pos.quantity);
      // La ganancia realizada usa el PPC vigente (el costo promedio no cambia al vender).
      pos.realizedPnL += (op.price - pos.avgCost) * soldQty;
      pos.quantity -= soldQty;
      if (pos.quantity <= 0.0000001) {
        pos.quantity = 0;
        pos.avgCost = 0;
      }
      pos.costBasis = pos.quantity * pos.avgCost;
      ledger.push({
        operationId: op.id,
        date: op.date,
        kind: "INVESTMENT",
        signedAmount: Math.abs(op.amount), // entra plata por vender
        currency: op.currency,
        description: `${LABEL[op.type]} ${op.quantity} ${op.symbol}`,
      });
    } else if (INCOME_TYPES.has(op.type)) {
      // Renta: entra plata de verdad. Si tiene activo asociado, se le imputa.
      if (op.symbol) {
        const pos = ensure(op.symbol, op.currency);
        pos.incomeReceived += Math.abs(op.amount);
      }
      ledger.push({
        operationId: op.id,
        date: op.date,
        kind: "INCOME",
        signedAmount: Math.abs(op.amount),
        currency: op.currency,
        description: op.symbol ? `${LABEL[op.type]} ${op.symbol}` : LABEL[op.type],
      });
    } else {
      // Ajustes, transferencias, otros: al ledger como movimiento de inversión neutro.
      // No sabemos el signo con certeza para todos, así que se respeta el que venga: si
      // el monto ya trae signo, se usa; si no, se asume entrada. La descripción deja
      // claro qué es, para que el usuario lo revise.
      ledger.push({
        operationId: op.id,
        date: op.date,
        kind: "INVESTMENT",
        signedAmount: op.amount, // tal cual viene (puede ser + o −)
        currency: op.currency,
        description: op.symbol ? `${LABEL[op.type]} ${op.symbol}` : LABEL[op.type],
      });
    }
  }

  const positions: AssetPosition[] = [];
  const closedPositions: AssetPosition[] = [];
  const investedByCurrency: Record<string, number> = {};
  const realizedByCurrency: Record<string, number> = {};
  const incomeByCurrency: Record<string, number> = {};

  for (const pos of book.values()) {
    const round2 = (n: number) => Math.round(n * 100) / 100;
    pos.avgCost = round2(pos.avgCost);
    pos.costBasis = round2(pos.costBasis);
    pos.realizedPnL = round2(pos.realizedPnL);
    pos.incomeReceived = round2(pos.incomeReceived);

    realizedByCurrency[pos.currency] = round2(
      (realizedByCurrency[pos.currency] ?? 0) + pos.realizedPnL
    );
    incomeByCurrency[pos.currency] = round2(
      (incomeByCurrency[pos.currency] ?? 0) + pos.incomeReceived
    );

    if (pos.quantity > 0) {
      positions.push(pos);
      investedByCurrency[pos.currency] = round2(
        (investedByCurrency[pos.currency] ?? 0) + pos.costBasis
      );
    } else {
      closedPositions.push(pos);
    }
  }

  positions.sort((a, b) => b.costBasis - a.costBasis);
  closedPositions.sort((a, b) => b.realizedPnL - a.realizedPnL);

  return {
    positions,
    closedPositions,
    investedByCurrency,
    realizedByCurrency,
    incomeByCurrency,
    ledger,
  };
}

/**
 * Ganancia NO realizada de una posición: lo que ganarías (o perderías) si vendieras hoy.
 * Necesita el precio ACTUAL de mercado, que viene de la foto de la cartera (no del
 * historial). Por eso es una función aparte que combina las dos fuentes.
 */
export function unrealizedPnL(position: { quantity: number; avgCost: number }, currentPrice: number): number {
  return Math.round((currentPrice - position.avgCost) * position.quantity * 100) / 100;
}
