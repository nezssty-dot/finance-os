/**
 * Herramientas de categorías. PURO: sin base, sin red.
 *
 * Cuando se importan meses de movimientos, es normal terminar con categorías que son la
 * misma cosa escrita distinto: "COMIDA", "Comidas", "comida ". Este motor las detecta para
 * poder fusionarlas y dejar el reporte ordenado de verdad.
 *
 * La fusión es una operación DELICADA —mueve movimientos de una categoría a otra y borra
 * la vieja—, así que se valida acá, con reglas explícitas y testeadas, antes de tocar nada.
 */

/** Normaliza para comparar: minúsculas, sin acentos, sin signos, sin espacios de más. */
export function normalizeName(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Raíz para comparar variantes: además de normalizar, saca el plural simple. Así "comida"
 * y "comidas" caen en la misma raíz, que es lo que hace que se detecten como duplicadas.
 */
export function nameRoot(name: string): string {
  const n = normalizeName(name);
  if (n.length > 3 && n.endsWith("es")) return n.slice(0, -2);
  if (n.length > 3 && n.endsWith("s")) return n.slice(0, -1);
  return n;
}

export interface CategoryLike {
  id: string;
  name: string;
  /** Cuántos movimientos la usan. Se usa para sugerir cuál conservar. */
  count?: number;
}

export interface DuplicateGroup {
  /** La que conviene conservar: la más usada (a igualdad, la primera). */
  keep: CategoryLike;
  /** Las que convendría fusionar en `keep`. */
  merge: CategoryLike[];
}

/**
 * Agrupa categorías que son la misma cosa escrita distinto. Solo devuelve los grupos con
 * más de un integrante — si no hay duplicados, devuelve vacío y la pantalla no molesta.
 */
export function findDuplicates(categories: CategoryLike[]): DuplicateGroup[] {
  const byRoot = new Map<string, CategoryLike[]>();

  for (const c of categories) {
    const root = nameRoot(c.name);
    if (!root) continue; // un nombre que queda vacío al normalizar no agrupa nada
    const list = byRoot.get(root) ?? [];
    list.push(c);
    byRoot.set(root, list);
  }

  const groups: DuplicateGroup[] = [];
  for (const list of byRoot.values()) {
    if (list.length < 2) continue;
    // Se conserva la más usada: mover 3 movimientos es más barato y menos riesgoso que
    // mover 300, y además suele ser la que el usuario considera "la buena".
    const sorted = [...list].sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
    groups.push({ keep: sorted[0], merge: sorted.slice(1) });
  }
  return groups;
}

export interface MergeCheck {
  ok: boolean;
  error?: string;
}

/**
 * Valida una fusión ANTES de ejecutarla. Que una categoría no exista, o fusionar una
 * consigo misma, tiene que fallar con un mensaje claro y no dejar la base a medio camino.
 */
export function validateMerge(
  sourceId: string,
  targetId: string,
  categories: CategoryLike[]
): MergeCheck {
  if (!sourceId || !targetId) return { ok: false, error: "Faltan las categorías a fusionar." };
  if (sourceId === targetId) return { ok: false, error: "No se puede fusionar una categoría consigo misma." };

  const source = categories.find((c) => c.id === sourceId);
  const target = categories.find((c) => c.id === targetId);
  if (!source) return { ok: false, error: "La categoría de origen no existe." };
  if (!target) return { ok: false, error: "La categoría de destino no existe." };

  return { ok: true };
}
