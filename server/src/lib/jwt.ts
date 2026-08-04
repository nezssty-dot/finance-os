import jwt, { SignOptions } from "jsonwebtoken";
import crypto from "crypto";
import { config } from "../config";

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessTtl,
  } as SignOptions);
}

export function verifyAccessToken(token: string): { sub: string } {
  return jwt.verify(token, config.jwt.accessSecret) as { sub: string };
}

// OAuth "state": a short-lived signed token carrying the userId, so the
// Mercado Pago callback knows which user is connecting (CSRF-safe).
export function signOAuthState(userId: string): string {
  return jwt.sign({ sub: userId }, config.jwt.stateSecret, { expiresIn: "10m" });
}
export function verifyOAuthState(token: string): { sub: string } {
  return jwt.verify(token, config.jwt.stateSecret) as { sub: string };
}

// Opaque refresh tokens: a random string handed to the client, only its
// hash is stored in the DB so a DB leak can't be replayed.
export function newRefreshToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(48).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, hash };
}
export const hashToken = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");
