import { Router } from "express";
import { z, ZodTypeAny } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";
import { ah } from "./asyncHandler";
import { HttpError } from "../middleware/error";

// Generic per-user CRUD router for simple owned resources.
// Every query is scoped to req.userId so users can only touch their own rows.
export function crudRouter(
  model: string,
  schemas: { create: ZodTypeAny; update: ZodTypeAny },
  opts: {
    orderBy?: Record<string, "asc" | "desc">;
    /**
     * Se ejecuta ANTES de borrar la fila. Sirve para limpiar lo que la base no limpia
     * sola: por ejemplo, reglas de clasificación que apuntan a una categoría por id pero
     * no tienen clave foránea, y quedarían huérfanas apuntando a algo que ya no existe.
     */
    beforeDelete?: (id: string, userId: string) => Promise<void>;
    /**
     * Rutas propias que se montan ANTES de las genéricas. Es importante el orden: Express
     * matchea en secuencia, así que una ruta como `/stats` DEBE registrarse antes que la
     * genérica `/:id`; si no, "stats" se interpreta como un id, no se encuentra y devuelve
     * 404. Todo lo que agregue el consumidor va acá para quedar por delante de `/:id`.
     */
    extend?: (r: Router) => void;
  } = {}
) {
  const r = Router();
  r.use(requireAuth);
  const delegate = () => (prisma as any)[model];

  // Primero las rutas propias del consumidor (p. ej. /stats, /:id/merge), para que no las
  // tape la genérica /:id de más abajo.
  if (opts.extend) opts.extend(r);

  r.get(
    "/",
    ah(async (req, res) => {
      const rows = await delegate().findMany({
        where: { userId: req.userId },
        orderBy: opts.orderBy ?? { createdAt: "desc" },
      });
      res.json(rows);
    })
  );

  r.get(
    "/:id",
    ah(async (req, res) => {
      const row = await delegate().findFirst({
        where: { id: req.params.id, userId: req.userId },
      });
      if (!row) throw new HttpError(404, "No encontrado");
      res.json(row);
    })
  );

  r.post(
    "/",
    ah(async (req, res) => {
      const data = schemas.create.parse(req.body);
      const row = await delegate().create({
        data: { ...data, userId: req.userId },
      });
      res.status(201).json(row);
    })
  );

  r.patch(
    "/:id",
    ah(async (req, res) => {
      const data = schemas.update.parse(req.body);
      const found = await delegate().findFirst({
        where: { id: req.params.id, userId: req.userId },
      });
      if (!found) throw new HttpError(404, "No encontrado");
      const row = await delegate().update({
        where: { id: req.params.id },
        data,
      });
      res.json(row);
    })
  );

  r.delete(
    "/:id",
    ah(async (req, res) => {
      const found = await delegate().findFirst({
        where: { id: req.params.id, userId: req.userId },
      });
      if (!found) throw new HttpError(404, "No encontrado");
      if (opts.beforeDelete) await opts.beforeDelete(req.params.id, req.userId!);
      await delegate().delete({ where: { id: req.params.id } });
      res.status(204).end();
    })
  );

  return r;
}

export const money = () =>
  z.union([z.number(), z.string()]).transform((v) => String(v));
