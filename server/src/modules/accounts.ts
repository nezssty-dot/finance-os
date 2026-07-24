import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { accountBalances } from "../lib/finance";
import { requireAuth } from "../middleware/auth";
import { ah } from "../utils/asyncHandler";
import { HttpError } from "../middleware/error";

export const accountsRouter = Router();
accountsRouter.use(requireAuth);

const TYPES = ["MERCADO_PAGO", "BANK", "CASH", "RESERVE", "WALLET", "BROKER", "OTHER"] as const;

const createSchema = z.object({
  name: z.string().min(1).max(60),
  type: z.enum(TYPES).default("OTHER"),
  currency: z.string().default("ARS"),
  openingBalance: z.coerce.number().default(0),
  // Institución a la que corresponde, cuando el usuario la carga a mano (ej:
  // "binance", "galicia" — ver client/src/lib/institutions.ts). NUNCA los slugs de
  // los conectores reales ("mercado_pago", "iol"): esos los asigna únicamente
  // IntegrationManager.connect() al conectar de verdad, no este endpoint.
  provider: z.string().trim().toLowerCase().max(40).nullable().optional(),
});
const updateSchema = createSchema.partial();

const MANAGED_PROVIDERS = new Set(["mercado_pago", "iol"]);

/** Que alguien escriba a mano "mercado_pago" no la convierte en una cuenta sincronizada
 *  de verdad — solo confundiría a IntegrationManager, que busca la cuenta por ese
 *  mismo slug al conectar. Esos dos los asigna únicamente el conector real. */
function assertAssignableProvider(provider?: string | null) {
  if (provider && MANAGED_PROVIDERS.has(provider))
    throw new HttpError(400, "Esa institución se conecta desde Integraciones, no se asigna a mano.");
}

// Every account with its live balance (derived, never stored).
accountsRouter.get("/", ah(async (req, res) => {
  res.json(await accountBalances(req.userId!));
}));

accountsRouter.post("/", ah(async (req, res) => {
  const data = createSchema.parse(req.body);
  assertAssignableProvider(data.provider);
  const row = await prisma.account.create({ data: { ...data, userId: req.userId! } });
  res.status(201).json(row);
}));

accountsRouter.patch("/:id", ah(async (req, res) => {
  const data = updateSchema.parse(req.body);
  assertAssignableProvider(data.provider);
  const found = await prisma.account.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!found) throw new HttpError(404, "Cuenta no encontrada");
  res.json(await prisma.account.update({ where: { id: req.params.id }, data }));
}));

accountsRouter.delete("/:id", ah(async (req, res) => {
  const found = await prisma.account.findFirst({ where: { id: req.params.id, userId: req.userId } });
  if (!found) throw new HttpError(404, "Cuenta no encontrada");
  const movements = await prisma.movement.count({ where: { accountId: req.params.id } });
  // Deleting an account with history would orphan the movements and silently change
  // the numbers. Archive it instead: it disappears from the UI, the history survives.
  if (movements > 0) {
    await prisma.account.update({ where: { id: req.params.id }, data: { archived: true } });
    return res.json({ archived: true, movements });
  }
  await prisma.account.delete({ where: { id: req.params.id } });
  res.status(204).end();
}));

// Move money between two of your own accounts. This must NEVER change net worth,
// so it is recorded as a single TRANSFER movement that debits one account and
// credits the other — not as an expense plus an income.
accountsRouter.post("/transfer", ah(async (req, res) => {
  const { fromAccountId, toAccountId, amount, date, description } = z.object({
    fromAccountId: z.string(),
    toAccountId: z.string(),
    amount: z.coerce.number().positive(),
    date: z.coerce.date().default(() => new Date()),
    description: z.string().max(120).optional(),
  }).parse(req.body);

  if (fromAccountId === toAccountId)
    throw new HttpError(400, "El origen y el destino no pueden ser la misma cuenta");

  const accounts = await prisma.account.findMany({
    where: { id: { in: [fromAccountId, toAccountId] }, userId: req.userId },
  });
  if (accounts.length !== 2) throw new HttpError(404, "Alguna de las cuentas no existe");

  const from = accounts.find((a) => a.id === fromAccountId)!;
  const to = accounts.find((a) => a.id === toAccountId)!;

  // Transferir entre monedas distintas necesitaría una cotización, y una transferencia
  // credita al destino EXACTAMENTE lo que sale del origen (así el patrimonio no se
  // mueve). Sin conversión, pasar $500 de una cuenta en pesos a una en dólares
  // registraría "US$ 500" — plata inventada. Se bloquea en vez de adivinar un tipo de
  // cambio: mejor pedir que lo cargues como un gasto y un ingreso a mano, con los
  // montos reales de cada lado.
  if (from.currency !== to.currency)
    throw new HttpError(
      400,
      `No se puede transferir directo entre ${from.currency} y ${to.currency}. Cargá el cambio como un gasto en ${from.currency} y un ingreso en ${to.currency} con los montos reales.`
    );

  const movement = await prisma.movement.create({
    data: {
      userId: req.userId!,
      type: "TRANSFER",
      amount,
      currency: from.currency,
      description: description || `${from.name} → ${to.name}`,
      date,
      accountId: fromAccountId,
      transferAccountId: toAccountId,
      source: "MANUAL",
    },
  });
  res.status(201).json(movement);
}));
