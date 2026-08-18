import { prisma } from "./prisma";
import {
  deriveBalances,
  netWorth,
  outstanding,
  balancesByCurrency,
  ASSET_CLASS,
  type MovementLike,
} from "./balance-math";

export * from "./balance-math";

/**
 * The one place in the codebase that decides what money is worth.
 *
 * Balances are DERIVED from movements, never stored. A stored balance has to be
 * updated by every code path that touches money (manual movement, edit, delete,
 * Mercado Pago sync, debt payment...) and the day one path forgets, the number is
 * silently wrong forever. Deriving it means it cannot drift: there is no "recalc"
 * button because there is nothing to recalculate.
 */

export interface AccountWithBalance {
  id: string;
  name: string;
  type: string;
  currency: string;
  provider: string | null;
  openingBalance: number;
  balance: number;
  movements: number;
}

/** Current balance of every active account, derived from its movements. */
export async function accountBalances(userId: string): Promise<AccountWithBalance[]> {
  const [accounts, movements] = await Promise.all([
    prisma.account.findMany({
      where: { userId, archived: false },
      orderBy: { createdAt: "asc" },
    }),
    prisma.movement.findMany({
      where: { userId },
      select: { accountId: true, transferAccountId: true, type: true, amount: true },
    }),
  ]);

  const { balance, count } = deriveBalances(
    accounts.map((a: any) => ({ id: a.id, openingBalance: Number(a.openingBalance) })),
    movements as MovementLike[]
  );

  return accounts.map((a: any) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    currency: a.currency,
    provider: a.provider,
    openingBalance: Number(a.openingBalance),
    balance: balance[a.id] ?? Number(a.openingBalance),
    movements: count[a.id] ?? 0,
  }));
}

export interface Patrimonio {
  neto: number;
  disponible: number;
  /**
   * Disponible desglosado por moneda: { ARS: 1000000, USD: 500 }. `disponible` (arriba)
   * es solo la moneda principal (ARS) — sumar pesos con dólares daría un número sin
   * sentido, así que las monedas nunca se mezclan. Ver por qué en patrimonio().
   */
  disponibleByCurrency: Record<string, number>;
  /** Invertido desglosado por moneda: { ARS: 800000, USD: 1500 }. Nunca se mezclan. */
  invertidoByCurrency: Record<string, number>;
  invertido: number;
  deudas: number;
  porCobrar: number;
  breakdown: { pesos: number; usd: number; crypto: number; stocks: number; funds: number };
  accounts: AccountWithBalance[];
  investments: any[];
  debts: any[];
}

/** Net worth, always current. Nothing here is cached or stored. */
export async function patrimonio(userId: string): Promise<Patrimonio> {
  const [accounts, investments, holdings, debts] = await Promise.all([
    accountBalances(userId),
    prisma.investment.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    // Tenencias sincronizadas de brokers (IOL). Se guardan en Holding vía upsert; acá se
    // LEEN para que impacten en el patrimonio y en Inversiones. Antes se guardaban pero
    // nadie las leía, así que el patrimonio no cambiaba y la sección quedaba vacía. Solo
    // las abiertas (las cerradas quedan de historial, no suman).
    prisma.holding.findMany({ where: { userId, closed: false }, orderBy: { totalValue: "desc" } }),
    prisma.debt.findMany({ where: { userId, settled: false } }),
  ]);

  const breakdown = { pesos: 0, usd: 0, crypto: 0, stocks: 0, funds: 0 };
  const investmentRows = investments.map((i: any) => {
    const value = Number(i.currentValue);
    const capital = Number(i.capital);
    breakdown[ASSET_CLASS[i.kind] ?? "pesos"] += value;
    return {
      id: i.id,
      name: i.name,
      kind: i.kind,
      currency: i.currency,
      quantity: i.quantity === null ? null : Number(i.quantity),
      capital,
      currentValue: value,
      gain: value - capital,
      pct: capital > 0 ? Math.round(((value - capital) / capital) * 1000) / 10 : 0,
      source: "MANUAL" as const,
    };
  });

  // Las tenencias de IOL, con la misma forma que las inversiones manuales, para que la
  // sección Inversiones las muestre sin distinguir de dónde vienen.
  const holdingRows = holdings.map((h) => {
    const value = Number(h.totalValue);
    const capital = Number(h.avgPrice) * Number(h.quantity);
    breakdown[ASSET_CLASS[h.kind] ?? "stocks"] += value;
    return {
      id: h.id,
      ticker: h.ticker,
      name: h.name,
      kind: h.kind,
      currency: h.currency,
      quantity: Number(h.quantity),
      capital,
      currentValue: value,
      gain: Number(h.gainAmount),
      pct: Number(h.gainPct),
      source: "IOL" as const,
    };
  });

  const allInvestments = [...investmentRows, ...holdingRows];

  // Invertido por moneda: ARS y USD nunca se mezclan (mismo criterio que el disponible).
  const invertidoByCurrency: Record<string, number> = {};
  for (const r of allInvestments) {
    invertidoByCurrency[r.currency] = (invertidoByCurrency[r.currency] ?? 0) + r.currentValue;
  }

  const disponibleByCurrency = balancesByCurrency(accounts);

  // Only the part still outstanding counts — a debt half paid is half a debt.
  const left = (d: any) => outstanding(Number(d.amount), Number(d.paid));
  const totals = netWorth({
    // El neto principal se lleva en ARS: entran las cuentas y las inversiones en pesos.
    // Lo que está en dólares (efectivo o invertido) se muestra por separado, para no
    // sumar peras con manzanas.
    balances: accounts.filter((a) => a.currency === "ARS").map((a) => a.balance),
    investmentValues: allInvestments.filter((r) => r.currency === "ARS").map((r) => r.currentValue),
    owe: debts.filter((d: any) => d.kind === "OWE").map(left),
    owed: debts.filter((d: any) => d.kind === "OWED").map(left),
  });

  return {
    ...totals,
    disponibleByCurrency,
    invertidoByCurrency,
    breakdown,
    accounts,
    investments: allInvestments,
    debts: debts.map((d: any) => ({
      id: d.id,
      name: d.name,
      kind: d.kind,
      amount: Number(d.amount),
      paid: Number(d.paid),
      outstanding: left(d),
      dueDate: d.dueDate,
    })),
  };
}
