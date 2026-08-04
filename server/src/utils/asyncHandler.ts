import { Request, Response, NextFunction, RequestHandler } from "express";
// Wraps async route handlers so thrown errors reach the error middleware.
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);
