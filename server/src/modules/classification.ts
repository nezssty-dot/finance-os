import { prisma } from "../lib/prisma";
import { normalize, matchCategory, generateMatchers } from "../lib/classify";
import { SEED_RULES } from "../lib/seed-rules";

// Re-exportados: el resto de la app (y los tests) siguen importando desde acá.
// La lógica de verdad vive en lib/classify.ts, que es pura — ver ese archivo.
export { normalize, matchCategory };

// Suggest a category by finding the best matching rule.
// Priority: full match > partial match, then by hits (reinforcement count).
export async function suggestCategory(
  userId: string,
  text: string
): Promise<string | null> {
  const norm = normalize(text);
  if (!norm) return null;

  const rules = await prisma.classificationRule.findMany({
    where: { userId },
    orderBy: [{ hits: "desc" }],
  });

  return matchCategory(norm, rules);
}

/**
 * La misma sugerencia, para muchos textos a la vez.
 *
 * Pensada para la previsualización del importador: un extracto trae docenas de
 * filas y, con `suggestCategory`, cada una disparaba su propia vuelta a
 * `ClassificationRule`. Acá las reglas se traen una sola vez y se reusan.
 *
 * Devuelve un array del mismo largo que `texts`, en el mismo orden — `null` donde
 * no hay ninguna regla que coincida. No es IA: son las mismas reglas por
 * coincidencia de texto que ya aprende `learn()`, solo que ahora también se
 * muestran ANTES de guardar, no después.
 */
export async function suggestCategories(
  userId: string,
  texts: string[]
): Promise<(string | null)[]> {
  if (!texts.length) return [];

  const rules = await prisma.classificationRule.findMany({
    where: { userId },
    orderBy: [{ hits: "desc" }],
  });

  return texts.map((t) => matchCategory(normalize(t), rules));
}

// Learn: store the FULL normalized text as the primary matcher,
// plus shorter fragments as secondary matchers (lower initial hits).
export async function learn(
  userId: string,
  text: string,
  categoryId: string,
  field: "counterpart" | "description" = "counterpart"
) {
  const matchers = generateMatchers(text);
  for (let i = 0; i < matchers.length; i++) {
    const matcher = matchers[i];
    if (matcher.length < 2) continue;
    // Full match gets higher initial hits (stronger signal)
    const baseHits = i === 0 ? 3 : 1;
    await prisma.classificationRule.upsert({
      where: { userId_field_matcher: { userId, field, matcher } },
      update: { categoryId, hits: { increment: baseHits } },
      create: { userId, field, matcher, categoryId, hits: baseHits },
    });
  }
}

/**
 * Carga las reglas semilla del catálogo (lib/seed-rules.ts).
 *
 * IDEMPOTENTE, y con una regla que no se negocia: **nunca pisa lo que el usuario ya
 * enseñó**. Si `learn()` guardó "spotify → PRODUCCION" porque así lo categorizó él,
 * esto NO lo vuelve a STREAMING. La semilla es un punto de partida, no una corrección.
 *
 * Por eso se usa `create` dentro de un try/catch en vez de `upsert`: el upsert
 * actualizaría la fila existente, que es exactamente lo que NO queremos. El
 * `@@unique([userId, field, matcher])` hace el trabajo — si ya hay una regla para ese
 * texto, la creación falla y se saltea, sin tocarla.
 *
 * Las categorías que faltan se crean; las que ya existen se reutilizan por nombre
 * (@@unique([userId, name])). Nunca se renombra ni se recolorea una que ya estaba.
 */
export async function applySeedRules(userId: string): Promise<{
  categoriesCreated: number;
  rulesCreated: number;
  rulesSkipped: number;
}> {
  const existing = await prisma.category.findMany({
    where: { userId },
    select: { id: true, name: true },
  });
  const byName = new Map<string, string>(existing.map((c) => [c.name, c.id]));

  let categoriesCreated = 0;
  let rulesCreated = 0;
  let rulesSkipped = 0;

  for (const seed of SEED_RULES) {
    // Explícito, sin depender del narrowing: `prisma.category.create` devuelve tipos
    // generados, y este archivo no debería romperse según cómo los infiera TypeScript.
    let categoryId: string | undefined = byName.get(seed.name);

    if (!categoryId) {
      const created = await prisma.category.create({
        data: { userId, name: seed.name, color: seed.color },
        select: { id: true },
      });
      categoryId = String(created.id);
      byName.set(seed.name, categoryId);
      categoriesCreated++;
    }

    for (const merchant of seed.merchants) {
      const matcher = normalize(merchant);
      if (matcher.length < 3) continue; // el matching exige 3+; sembrar menos es basura

      try {
        await prisma.classificationRule.create({
          // `field: "counterpart"` es el mismo default de learn(): así, cuando el
          // usuario corrija, su upsert cae sobre ESTA fila y la reemplaza, en vez de
          // dejar dos reglas distintas peleando por el mismo texto.
          data: { userId, field: "counterpart", matcher, categoryId, hits: 1 },
        });
        rulesCreated++;
      } catch {
        // Ya existía: o se sembró antes, o el usuario ya enseñó algo para ese texto.
        // En los dos casos, dejarla como está es lo correcto.
        rulesSkipped++;
      }
    }
  }

  return { categoriesCreated, rulesCreated, rulesSkipped };
}
