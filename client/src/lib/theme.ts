/**
 * Gestión del tema claro/oscuro. La lógica pura (resolver, alternar) se separa del DOM
 * para poder testearla; las funciones que tocan document/localStorage son finas envolturas.
 */

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'fos-theme';

/** Normaliza cualquier valor guardado a un tema válido. Ante la duda, oscuro (el default). */
export function resolveTheme(stored: string | null | undefined): Theme {
  return stored === 'light' ? 'light' : 'dark';
}

/** El tema opuesto, para el toggle. */
export function toggleTheme(current: Theme): Theme {
  return current === 'dark' ? 'light' : 'dark';
}

/** Lee el tema actual del almacenamiento (o el default). Seguro si no hay localStorage. */
export function getStoredTheme(): Theme {
  try {
    return resolveTheme(localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'dark';
  }
}

/** Aplica el tema al documento y lo persiste. */
export function applyTheme(theme: Theme): void {
  try {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Entorno sin DOM/almacenamiento: no hace nada, no rompe.
  }
}
