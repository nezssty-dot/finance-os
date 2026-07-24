import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { crudRouter } from "../utils/crud";
import { requireAuth } from "../middleware/auth";
import { ah } from "../utils/asyncHandler";
import { applySeedRules } from "./classification";
import { findDuplicates, validateMerge } from "../lib/category-tools";
import { HttpError } from "../middleware/error";

const create = z.object({
  name: z.string().min(1).transform((s) => s.toUpperCase()),
  color: z.string().default("#71717A"),
  icon: z.string().max(8).optional(),
});
const update = z.object({
  name: z.string().min(1).transform((s) => s.toUpperCase()).optional(),
  color: z.string().optional(),
  icon: z.string().max(8).nullable().optional(),
});

export const categoriesRouter: Router = crudRouter("category", { create, update }, {
  orderBy: { name: "asc" },
  /**
   * Al borrar una categoría, la base ya deja los movimientos intactos (quedan sin
   * categoría) y borra sus presupuestos. Lo que NO limpia sola son las reglas de
   * clasificación: guardan el id de la categoría pero sin clave foránea, así que
   * quedarían huérfanas apuntando a algo que ya no existe y el importador intentaría
   * asignar una categoría inválida. Se borran acá.
   */
  beforeDelete: async (id, userId) => {
    await prisma.classificationRule.deleteMany({ where: { userId, categoryId: id } });
  },
  // Estas rutas se montan ANTES que la genérica /:id (si no, "/stats" caería en "/:id" y
  // daría 404 — que es exactamente el bug que rompía la pantalla de Categorías).
  extend: (r) => {
    /**
     * Uso de cada categoría + sugerencias de fusión.
     *
     * Sirve para dos cosas: saber qué se pierde antes de borrar (cuántos movimientos y
     * presupuestos la usan) y detectar categorías que son la misma escrita distinto
     * ("COMIDA" y "Comidas"), típicas después de importar varios meses.
     */
    r.get("/stats", ah(async (req, res) => {
      const userId = req.userId!;
      const [categories, movementCounts, budgets] = await Promise.all([
        prisma.category.findMany({ where: { userId }, orderBy: { name: "asc" } }),
        prisma.movement.groupBy({
          by: ["categoryId"],
          where: { userId, categoryId: { not: null } },
          _count: { _all: true },
        }),
        prisma.budget.findMany({ where: { userId }, select: { categoryId: true } }),
      ]);

      const movementsBy = new Map(movementCounts.map((r) => [r.categoryId, r._count._all]));
      const budgetsBy = new Map<string, number>();
      for (const b of budgets) budgetsBy.set(b.categoryId, (budgetsBy.get(b.categoryId) ?? 0) + 1);

      const items = categories.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        icon: c.icon ?? null,
        movements: movementsBy.get(c.id) ?? 0,
        budgets: budgetsBy.get(c.id) ?? 0,
      }));

      // Sin categoría: no es una categoría, pero el usuario necesita verlo para ordenarlo.
      const uncategorized = await prisma.movement.count({ where: { userId, categoryId: null } });

      res.json({
        items,
        uncategorized,
        duplicates: findDuplicates(items.map((c) => ({ id: c.id, name: c.name, count: c.movements }))),
      });
    }));

    /**
     * Fusiona una categoría en otra: los movimientos, servicios y reglas de la de origen
     * pasan a la de destino, y la de origen se elimina.
     *
     * Todo en UNA transacción: o se mueve todo y se borra, o no pasa nada. Una fusión a
     * medias dejaría movimientos apuntando a una categoría borrada, peor que no fusionar.
     */
    r.post("/:id/merge", ah(async (req, res) => {
      const userId = req.userId!;
      const sourceId = req.params.id;
      const targetId = String(req.body?.targetId ?? "");

      const categories = await prisma.category.findMany({ where: { userId }, select: { id: true, name: true } });
      const check = validateMerge(sourceId, targetId, categories);
      if (!check.ok) throw new HttpError(400, check.error ?? "Fusión inválida");

      const result = await prisma.$transaction(async (tx) => {
        const moved = await tx.movement.updateMany({
          where: { userId, categoryId: sourceId },
          data: { categoryId: targetId },
        });
        await tx.service.updateMany({
          where: { userId, categoryId: sourceId },
          data: { categoryId: targetId },
        });
        // Las reglas aprendidas se repuntan al destino: lo que enseñó el usuario no se pierde.
        await tx.classificationRule.updateMany({
          where: { userId, categoryId: sourceId },
          data: { categoryId: targetId },
        });
        // Los presupuestos de la de origen se borran (el destino tiene los suyos). Explícito
        // acá en vez de dejar que el borrado en cascada lo haga en silencio.
        const budgets = await tx.budget.deleteMany({ where: { userId, categoryId: sourceId } });
        await tx.category.delete({ where: { id: sourceId } });
        return { movements: moved.count, budgetsRemoved: budgets.count };
      });

      res.json({ ok: true, ...result });
    }));
  },
});

/**
 * Carga las reglas de clasificación semilla (Spotify → STREAMING, YPF → COMBUSTIBLE…).
 *
 * Es IDEMPOTENTE a propósito. Se llama sola al registrarse, pero tiene que poder
 * llamarse a mano después: quien ya tenía la app instalada antes de que existieran las
 * semillas nunca las recibió, y sin esto el clasificador le sigue arrancando vacío para
 * siempre. Correrla dos veces no duplica nada ni pisa lo que el usuario ya enseñó.
 */
categoriesRouter.post("/seed-rules", requireAuth, ah(async (req, res) => {
  res.json(await applySeedRules(req.userId!));
}));

/** Cuántas reglas tiene hoy el usuario. La UI lo usa para saber si ofrecer sembrar. */
categoriesRouter.get("/rules/count", requireAuth, ah(async (req, res) => {
  const rules = await prisma.classificationRule.count({ where: { userId: req.userId } });
  res.json({ rules });
}));
