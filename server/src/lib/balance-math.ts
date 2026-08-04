/**
 * Pure money math. No database, no imports, no side effects.
 *
 * Balances are DERIVED from movements, never stored. A stored balance must be
 * updated by every code path that touches money — manual movement, edit, delete,
 * Mercado Pago sync, debt payment — and the day one path forgets, the number is
 * silently wrong forever. Deriving it means it cannot drift: there is no "recalc"
 * button because there is nothing to recalculate.
 */

/** What each movement type does to the balance of the account it belongs to. */
export const SIGN: Record<string, number> = {
  INCOME: 1,
  COLLECTION: 1,      // someone paid back a debt they owed us
  EXPENSE: -1,
  DEBT_PAYMENT: -1,   // we paid back a debt we owed
  INVESTMENT: -1,     // money left the account and became an investment
  TRANSFER: -1,       // leaves this account; lands on transferAccountId
  INTERNAL: 0,        // stays put (e.g. MP marking its own reserve)
};

/** Investment kinds grouped into the asset classes shown on the Patrimonio screen. */
export const ASSET_CLASS: Record<string, "pesos" | "usd" | "crypto" | "stocks" | "funds"> = {
  PESOS: "pesos",
  FIXED_TERM: "pesos",
  USD: "usd",
  USDT: "crypto",
  BTC: "crypto",
  ETH: "crypto",
  STOCK: "stocks",
  FUND: "funds",
};

export interface MovementLike {
  accountId: string | null;
  transferAccountId: string | null;
  type: string;
  amount: number;
}

export interface AccountLike {
  id: string;
  openingBalance: number;
}

export function deriveBalances(
  accounts: AccountLike[],
  movements: MovementLike[]
): { delta: Record<string, number>; count: Record<string, number>; balance: Record<string, number> } {
  const delta: Record<string, number> = {};
  const count: Record<string, number> = {};

  for (const m of movements) {
    const amount = Number(m.amount);
    const sign = SIGN[m.type] ?? 0;

    if (m.accountId) {
      count[m.accountId] = (count[m.accountId] ?? 0) + 1;
      if (sign !== 0) delta[m.accountId] = (delta[m.accountId] ?? 0) + sign * amount;
    }
    // A transfer credits the destination exactly what it debited from the origin,
    // so money moves between accounts without net worth changing by a single peso.
    if (m.type === "TRANSFER" && m.transferAccountId) {
      delta[m.transferAccountId] = (delta[m.transferAccountId] ?? 0) + amount;
      count[m.transferAccountId] = (count[m.transferAccountId] ?? 0) + 1;
    }
  }

  const balance: Record<string, number> = {};
  for (const a of accounts) balance[a.id] = Number(a.openingBalance) + (delta[a.id] ?? 0);

  return { delta, count, balance };
}

/** Only the part still outstanding counts — a debt half paid is half a debt. */
export const outstanding = (amount: number, paid: number) => Math.max(amount - paid, 0);

/**
 * Agrupa saldos de cuentas por moneda: { ARS: 1000000, USD: 500 }.
 *
 * Existe como función aparte —y testeada— porque sumar dos monedas en un solo número
 * es un error silencioso: el patrimonio diría "1.000.500" mezclando pesos y dólares.
 * Acá cada moneda queda en su propio total, siempre. El que consume decide cuál mostrar
 * como titular (los pesos) y cuáles al costado.
 */
export function balancesByCurrency(
  accounts: { currency: string; balance: number }[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of accounts) {
    out[a.currency] = (out[a.currency] ?? 0) + a.balance;
  }
  return out;
}

export function netWorth(input: {
  balances: number[];
  investmentValues: number[];
  owe: number[];
  owed: number[];
}): { neto: number; disponible: number; invertido: number; deudas: number; porCobrar: number } {
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const disponible = sum(input.balances);
  const invertido = sum(input.investmentValues);
  const deudas = sum(input.owe);
  const porCobrar = sum(input.owed);
  return { neto: disponible + invertido + porCobrar - deudas, disponible, invertido, deudas, porCobrar };
}
