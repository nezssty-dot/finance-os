import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { User } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { ah } from "../utils/asyncHandler";
import { HttpError } from "../middleware/error";

export const usersRouter = Router();
usersRouter.use(requireAuth);

const CURRENCIES = ["ARS", "USD", "EUR", "BRL", "CLP", "UYU", "MXN"] as const;

const publicUser = (u: User) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  currency: u.currency,
  onboardedAt: u.onboardedAt,
  createdAt: u.createdAt,
});

// ─── Perfil ───

usersRouter.get("/me", ah(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) throw new HttpError(404, "Usuario no encontrado");
  res.json(publicUser(user));
}));

usersRouter.patch("/me", ah(async (req, res) => {
  const data = z.object({
    name: z.string().min(1).max(80).optional(),
    email: z.string().email().optional(),
    currency: z.enum(CURRENCIES).optional(),
  }).parse(req.body);

  if (data.email) {
    data.email = data.email.toLowerCase();
    const taken = await prisma.user.findFirst({
      where: { email: data.email, NOT: { id: req.userId } },
    });
    if (taken) throw new HttpError(409, "Ese email ya está en uso");
  }

  const user = await prisma.user.update({ where: { id: req.userId }, data });
  res.json(publicUser(user));
}));

// Changing the password requires proving you know the current one. Otherwise a
// stolen access token would be enough to lock the real owner out of their account.
usersRouter.post("/me/password", ah(async (req, res) => {
  const { currentPassword, newPassword } = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8, "La contraseña nueva necesita al menos 8 caracteres"),
  }).parse(req.body);

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) throw new HttpError(404, "Usuario no encontrado");

  if (!(await bcrypt.compare(currentPassword, user.passwordHash)))
    throw new HttpError(401, "La contraseña actual no es correcta");

  if (await bcrypt.compare(newPassword, user.passwordHash))
    throw new HttpError(400, "La contraseña nueva tiene que ser distinta de la actual");

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 12) },
    }),
    // Every other session dies. If someone else had the old password, they're out.
    prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
  ]);

  res.json({ ok: true, message: "Contraseña actualizada. Se cerraron las demás sesiones." });
}));

usersRouter.post("/me/onboard", ah(async (req, res) => {
  const user = await prisma.user.update({
    where: { id: req.userId },
    data: { onboardedAt: new Date() },
  });
  res.json(publicUser(user));
}));

// ─── Backup ───

const BACKUP_VERSION = 1;

/**
 * Everything the user owns, in one JSON file.
 *
 * Tokens are deliberately excluded: a backup file sitting in a Downloads folder must
 * not be a way to take over someone's Mercado Pago account. Reconnecting is two
 * clicks; a leaked token is forever.
 */
usersRouter.get("/me/backup", ah(async (req, res) => {
  const userId = req.userId!;

  const [user, accounts, categories, movements, investments, goals, debts, budgets, rules] =
    await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.account.findMany({ where: { userId } }),
      prisma.category.findMany({ where: { userId } }),
      prisma.movement.findMany({ where: { userId }, orderBy: { date: "asc" } }),
      prisma.investment.findMany({ where: { userId } }),
      prisma.goal.findMany({ where: { userId } }),
      prisma.debt.findMany({ where: { userId } }),
      prisma.budget.findMany({ where: { userId } }),
      prisma.classificationRule.findMany({ where: { userId } }),
    ]);

  if (!user) throw new HttpError(404, "Usuario no encontrado");

  const backup = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    app: "Finance OS",
    user: { name: user.name, email: user.email, currency: user.currency },
    accounts, categories, movements, investments, goals, debts, budgets,
    classificationRules: rules,
    counts: {
      accounts: accounts.length,
      categories: categories.length,
      movements: movements.length,
      investments: investments.length,
      goals: goals.length,
      debts: debts.length,
      budgets: budgets.length,
    },
  };

  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="finance-os-backup-${stamp}.json"`);
  res.send(JSON.stringify(backup, null, 2));
}));

const backupSchema = z.object({
  version: z.number(),
  accounts: z.array(z.any()).default([]),
  categories: z.array(z.any()).default([]),
  movements: z.array(z.any()).default([]),
  investments: z.array(z.any()).default([]),
  goals: z.array(z.any()).default([]),
  debts: z.array(z.any()).default([]),
  budgets: z.array(z.any()).default([]),
  classificationRules: z.array(z.any()).default([]),
  user: z.object({ currency: z.string().optional() }).optional(),
});

/**
 * Restore: wipes current data and rebuilds it from the file.
 *
 * The whole thing runs in ONE transaction. If any row fails, nothing is deleted and
 * nothing is written — a half-restored ledger is worse than no restore at all.
 *
 * IDs are remapped rather than reused, so a backup restores cleanly into any account.
 */
usersRouter.post("/me/restore", ah(async (req, res) => {
  const userId = req.userId!;
  const backup = backupSchema.parse(req.body);

  if (backup.version > BACKUP_VERSION)
    throw new HttpError(400, "Ese backup viene de una versión más nueva de Finance OS");

  const remap = new Map<string, string>();
  const newId = (oldId: string | null | undefined) => (oldId ? (remap.get(oldId) ?? null) : null);

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Movements first: they reference everything else.
    await tx.movement.deleteMany({ where: { userId } });
    await tx.budget.deleteMany({ where: { userId } });
    await tx.classificationRule.deleteMany({ where: { userId } });
    await tx.goal.deleteMany({ where: { userId } });
    await tx.debt.deleteMany({ where: { userId } });
    await tx.investment.deleteMany({ where: { userId } });
    await tx.account.deleteMany({ where: { userId } });
    await tx.category.deleteMany({ where: { userId } });

    for (const c of backup.categories) {
      const row = await tx.category.create({
        data: {
          userId,
          name: c.name,
          color: c.color ?? "#71717A",
        },
      });
      remap.set(c.id, row.id);
    }

    for (const a of backup.accounts) {
      const row = await tx.account.create({
        data: {
          userId, name: a.name,
          type: a.type ?? "OTHER",
          currency: a.currency ?? "ARS",
          openingBalance: Number(a.openingBalance ?? 0),
          provider: a.provider ?? null,
          archived: Boolean(a.archived),
        },
      });
      remap.set(a.id, row.id);
    }

    for (const m of backup.movements) {
      await tx.movement.create({
        data: {
          userId,
          type: m.type,
          amount: Number(m.amount),
          currency: m.currency ?? "ARS",
          description: m.description,
          counterpart: m.counterpart ?? null,
          date: new Date(m.date),
          accountId: newId(m.accountId),
          transferAccountId: newId(m.transferAccountId),
          categoryId: newId(m.categoryId),
          source: m.source ?? "MANUAL",
          // Keep the original Mercado Pago id so a later sync still deduplicates
          // against these rows instead of importing everything a second time.
          externalId: m.externalId ?? null,
          raw: m.raw ?? undefined,
        },
      });
    }

    for (const i of backup.investments)
      await tx.investment.create({
        data: {
          userId, name: i.name, kind: i.kind,
          capital: Number(i.capital),
          currentValue: Number(i.currentValue),
          quantity: i.quantity === null || i.quantity === undefined ? null : Number(i.quantity),
          currency: i.currency ?? "ARS",
        },
      });

    for (const g of backup.goals)
      await tx.goal.create({
        data: {
          userId, name: g.name,
          target: Number(g.target),
          saved: Number(g.saved ?? 0),
          deadline: g.deadline ? new Date(g.deadline) : null,
        },
      });

    for (const d of backup.debts)
      await tx.debt.create({
        data: {
          userId, name: d.name,
          amount: Number(d.amount),
          paid: Number(d.paid ?? 0),
          kind: d.kind ?? "OWE",
          dueDate: d.dueDate ? new Date(d.dueDate) : null,
          settled: Boolean(d.settled),
        },
      });

    for (const b of backup.budgets) {
      const categoryId = newId(b.categoryId);
      if (!categoryId) continue; // its category didn't survive; skip rather than crash
      await tx.budget.create({
        data: { userId, categoryId, limit: Number(b.limit), period: b.period ?? "MONTHLY" },
      });
    }

    for (const r of backup.classificationRules) {
      const categoryId = newId(r.categoryId);
      if (!categoryId) continue;
      await tx.classificationRule.create({
        data: {
          userId,
          categoryId,
          field: r.field ?? "counterpart",
          matcher: r.matcher,
          hits: Number(r.hits ?? 1),
        },
      });
    }

    if (backup.user?.currency)
      await tx.user.update({ where: { id: userId }, data: { currency: backup.user.currency } });
  }, { timeout: 120_000 }); // a year of movements is thousands of rows

  res.json({
    ok: true,
    restored: {
      accounts: backup.accounts.length,
      categories: backup.categories.length,
      movements: backup.movements.length,
      investments: backup.investments.length,
      goals: backup.goals.length,
      debts: backup.debts.length,
      budgets: backup.budgets.length,
    },
  });
}));
