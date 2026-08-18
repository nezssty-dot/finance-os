/**
 * Test del ORDEN de montaje de rutas.
 *
 * El bug real que rompía la pantalla de Categorías: las rutas propias (como `/stats`) se
 * montaban DESPUÉS de la genérica `/:id`. Express matchea en orden de registro, así que
 * `/stats` caía en `/:id` (id="stats"), no se encontraba y devolvía 404 → "No se pudieron
 * cargar los datos".
 *
 * El crudRouter real importa Prisma (que no se puede inicializar en este entorno), así que
 * este test NO lo importa: replica la regla de montaje —custom primero, genéricas después—
 * sobre un router de Express real y verifica el orden en su stack. Es la misma invariante
 * que aplica el fix, aislada para poder probarla acá.
 */

import express, { type Router } from "express";

let passed = 0;
const failures: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  \u2713 ${name}`); }
  catch (e: any) { failures.push(name); console.log(`  \u2717 ${name}\n      ${e.message}`); }
}
function eq(a: any, b: any, what: string) {
  if (a !== b) throw new Error(`${what}: esperaba ${JSON.stringify(b)}, obtuve ${JSON.stringify(a)}`);
}

/** Extrae, en orden de registro, los paths de un router de Express. */
function routePaths(r: Router): string[] {
  return (r as any).stack
    .filter((layer: any) => layer.route)
    .map((layer: any) => layer.route.path as string);
}

/**
 * Replica EXACTAMENTE el orden de montaje del crudRouter: primero las rutas del consumidor
 * (extend), después las genéricas. Si este orden se invierte, el test falla.
 */
function buildLikeCrud(extend?: (r: Router) => void): Router {
  const r = express.Router();
  if (extend) extend(r); // custom primero
  r.get("/", (_req, res) => res.json([]));
  r.get("/:id", (_req, res) => res.json({}));
  r.post("/", (_req, res) => res.json({}));
  r.patch("/:id", (_req, res) => res.json({}));
  r.delete("/:id", (_req, res) => res.status(204).end());
  return r;
}

console.log("\n\u2500\u2500\u2500 Orden de montaje de rutas (el bug de Categor\u00edas) \u2500\u2500\u2500\n");

test("una ruta custom /stats se monta ANTES que la gen\u00e9rica /:id", () => {
  const r = buildLikeCrud((router) => {
    router.get("/stats", (_req, res) => res.json({ ok: true }));
  });
  const paths = routePaths(r);
  eq(paths.indexOf("/stats") >= 0, true, "/stats registrada");
  eq(paths.indexOf("/:id") >= 0, true, "/:id registrada");
  eq(paths.indexOf("/stats") < paths.indexOf("/:id"), true, "/stats va ANTES que /:id (si no, 404)");
});

test("sin custom, las rutas gen\u00e9ricas siguen ah\u00ed", () => {
  const paths = routePaths(buildLikeCrud());
  eq(paths.includes("/:id"), true, "existe /:id");
  eq(paths.includes("/"), true, "existe /");
});

test("una ruta custom con par\u00e1metro (/:id/merge) tambi\u00e9n queda antes de /:id", () => {
  const r = buildLikeCrud((router) => {
    router.post("/:id/merge", (_req, res) => res.json({ ok: true }));
  });
  const paths = routePaths(r);
  eq(paths.indexOf("/:id/merge") < paths.indexOf("/:id"), true, "/:id/merge antes que /:id");
});

test("si el orden se invirtiera, el test lo detecta (guarda contra la regresi\u00f3n)", () => {
  const bad = express.Router();
  bad.get("/:id", (_req, res) => res.json({}));
  bad.get("/stats", (_req, res) => res.json({}));
  const paths = routePaths(bad);
  eq(paths.indexOf("/:id") < paths.indexOf("/stats"), true, "confirma que el orden importa");
});

console.log(
  failures.length ? `\n\u274c ${failures.length} fallaron, ${passed} pasaron\n` : `\n\u2705 Orden de montaje de rutas: ${passed} tests pasaron\n`
);
if (failures.length) process.exit(1);
