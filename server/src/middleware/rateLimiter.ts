import rateLimit from "express-rate-limit";

// Strict limiter for auth endpoints (login, forgot-password).
// 5 attempts per minute per IP. Prevents brute-force attacks.
export const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Esperá un minuto." },
});

// Moderate limiter for password reset requests.
// 3 per hour per IP.
export const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados pedidos de reset. Intentá en una hora." },
});

// General API limiter — 200 requests per minute per IP.
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas peticiones. Esperá un momento." },
});
