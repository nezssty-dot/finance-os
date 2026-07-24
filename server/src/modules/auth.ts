import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { hashPassword, verifyPassword } from "../lib/password";
import { signAccessToken, newRefreshToken, hashToken } from "../lib/jwt";
import { config } from "../config";
import { ah } from "../utils/asyncHandler";
import { HttpError } from "../middleware/error";
import { requireAuth } from "../middleware/auth";
import { authLimiter, forgotLimiter } from "../middleware/rateLimiter";
import { applySeedRules } from "./classification";
import crypto from "crypto";

export const authRouter = Router();

const REFRESH_COOKIE = "fos_refresh";
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Mínimo 8 caracteres"),
  name: z.string().min(1).max(80),
});
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function setRefreshCookie(res: any, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.cookieSecure,
    path: "/api/auth",
    maxAge: config.jwt.refreshTtlDays * 24 * 60 * 60 * 1000,
  });
}

async function issueRefresh(userId: string, res: any) {
  const { token, hash } = newRefreshToken();
  const expiresAt = new Date(
    Date.now() + config.jwt.refreshTtlDays * 24 * 60 * 60 * 1000
  );
  await prisma.refreshToken.create({
    data: { userId, tokenHash: hash, expiresAt },
  });
  setRefreshCookie(res, token);
}

async function seedDefaults(userId: string) {
  const defaults = [
    ["COMIDA", "#9E6B4C"], ["SERVICIOS", "#A24E63"], ["TRANSPORTE", "#5B7FB1"],
    ["SALUD", "#7E8A4A"], ["PRODUCCION", "#C7A93C"], ["SONIDO", "#71717A"],
    ["DEUDA", "#8C7A3E"], ["OTROS", "#6A6A70"],
  ];
  // skipDuplicates no existe en SQLite (Prisma lo tipa como `never`). Tampoco hace
  // falta: esto corre al registrar un usuario nuevo, no hay nada con qué duplicar,
  // y @@unique([userId, name]) protege el caso igual.
  await prisma.category.createMany({
    data: defaults.map(([name, color]) => ({ userId, name, color })),
  });
  await prisma.account.create({
    data: { userId, name: "Efectivo", type: "CASH", currency: "ARS" },
  });

  // Reglas de clasificación semilla. Sin esto, el clasificador arranca sin saber nada:
  // importás 300 movimientos y salen los 300 sin categoría. Crea también las categorías
  // que le falten al set de arriba (STREAMING, COMBUSTIBLE, IA…).
  //
  // Va acá, y no en el onboarding, porque el onboarding es SALTEABLE: si el usuario lo
  // saltea, igual tiene que poder importar un extracto y que le categorice solo.
  await applySeedRules(userId);
}

// FIX S1: authLimiter on register too (prevent mass account creation)
authRouter.post(
  "/register",
  authLimiter,
  ah(async (req, res) => {
    const { email, password, name } = registerSchema.parse(req.body);
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) throw new HttpError(409, "Ese email ya está registrado");
    const user = await prisma.user.create({
      data: { email, name, passwordHash: await hashPassword(password) },
    });
    await seedDefaults(user.id);
    await issueRefresh(user.id, res);
    res.status(201).json({
      accessToken: signAccessToken(user.id),
      user: { id: user.id, email: user.email, name: user.name, currency: user.currency, onboardedAt: user.onboardedAt },
    });
  })
);

// FIX S1: authLimiter on login
authRouter.post(
  "/login",
  authLimiter,
  ah(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await verifyPassword(password, user.passwordHash)))
      throw new HttpError(401, "Email o contraseña incorrectos");
    await issueRefresh(user.id, res);
    res.json({
      accessToken: signAccessToken(user.id),
      user: { id: user.id, email: user.email, name: user.name, currency: user.currency, onboardedAt: user.onboardedAt },
    });
  })
);

authRouter.post(
  "/refresh",
  ah(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new HttpError(401, "Sin sesión");
    const record = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!record || record.revoked || record.expiresAt < new Date())
      throw new HttpError(401, "Sesión inválida");
    await prisma.refreshToken.update({
      where: { id: record.id },
      data: { revoked: true },
    });
    await issueRefresh(record.userId, res);
    res.json({ accessToken: signAccessToken(record.userId) });
  })
);

authRouter.post(
  "/logout",
  ah(async (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (token)
      await prisma.refreshToken.updateMany({
        where: { tokenHash: hashToken(token) },
        data: { revoked: true },
      });
    res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
    res.json({ ok: true });
  })
);

authRouter.get(
  "/me",
  requireAuth,
  ah(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, email: true, name: true, currency: true, onboardedAt: true, createdAt: true },
    });
    res.json(user);
  })
);

// FIX S1: forgotLimiter (3/hour)
authRouter.post(
  "/forgot-password",
  forgotLimiter,
  ah(async (req, res) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = crypto.randomBytes(32).toString("hex");
      await prisma.passwordReset.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      // A password-reset token is a live credential. It used to be printed to stdout,
      // which in a packaged desktop app goes to a console nobody reads — all of the
      // risk, none of the benefit. There is no mail transport wired up, so this flow
      // cannot actually deliver the token to anyone yet: see KNOWN-GAPS.md §2.
      // Until an email provider is configured, the token is only surfaced in dev.
      if (!config.isProd)
        console.log(`[dev] reset token para ${email}: ${token}`);
    }
    res.json({ ok: true });
  })
);

authRouter.post(
  "/reset-password",
  authLimiter,
  ah(async (req, res) => {
    const { token, password } = z
      .object({ token: z.string(), password: z.string().min(8) })
      .parse(req.body);
    const record = await prisma.passwordReset.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!record || record.used || record.expiresAt < new Date())
      throw new HttpError(400, "Token inválido o vencido");
    await prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash: await hashPassword(password) },
    });
    await prisma.passwordReset.update({
      where: { id: record.id },
      data: { used: true },
    });
    await prisma.refreshToken.updateMany({
      where: { userId: record.userId },
      data: { revoked: true },
    });
    res.json({ ok: true });
  })
);
