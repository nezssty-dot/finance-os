/**
 * Instituciones sin conector propio.
 *
 * Mercado Pago e IOL viven en el catálogo real (`/integrations/catalog`): tienen
 * `Provider`, OAuth o usuario/contraseña, sincronizan solas. Todo lo demás en esta
 * lista NO tiene conector — por diseño, no por que falte escribirlo:
 *
 *   · Bancos y billeteras (Galicia, Santander, BBVA, Nación, Brubank, Naranja X,
 *     Ualá): Argentina no tiene Open Banking. La integración real ya existe y es
 *     el importador de extractos — funciona con cualquiera de estos hoy mismo.
 *
 *   · Exchanges (Binance, Nexo, Lemon, Belo): estos sí podrían tener conector de
 *     verdad (Binance y Nexo exponen API). Todavía no se escribió. Es roadmap
 *     real, no relleno — ver README → Roadmap.
 *
 * Esta lista es puramente de exhibición (Conexiones, Dashboard) y de etiquetado:
 * `id` coincide con `Account.provider` cuando alguien vincula una cuenta manual
 * desde Cuentas. El día que alguna de estas pase a tener conector de verdad, sale
 * de acá y se muda a `server/src/integrations/providers/` — nada más se entera.
 */

export type InstitutionKind = "IMPORT" | "SOON";
export type InstitutionCategory = "BANCO" | "FINTECH" | "EXCHANGE";

export interface Institution {
  /** Coincide con `Account.provider` cuando el usuario vincula una cuenta manual. */
  id: string;
  name: string;
  category: InstitutionCategory;
  kind: InstitutionKind;
  /** Por qué está en ese estado. Se le muestra al usuario, no se esconde. */
  note: string;
}

export const INSTITUTIONS: Institution[] = [
  { id: "galicia", name: "Banco Galicia", category: "BANCO", kind: "IMPORT",
    note: "Sin Open Banking en Argentina: exportá el extracto y lo importás acá." },
  { id: "santander", name: "Santander", category: "BANCO", kind: "IMPORT",
    note: "Sin Open Banking en Argentina: exportá el extracto y lo importás acá." },
  { id: "bbva", name: "BBVA", category: "BANCO", kind: "IMPORT",
    note: "Sin Open Banking en Argentina: exportá el extracto y lo importás acá." },
  { id: "nacion", name: "Banco Nación", category: "BANCO", kind: "IMPORT",
    note: "Sin Open Banking en Argentina: exportá el extracto y lo importás acá." },
  { id: "brubank", name: "Brubank", category: "BANCO", kind: "IMPORT",
    note: "Sin Open Banking en Argentina: exportá el extracto y lo importás acá." },
  { id: "naranjax", name: "Naranja X", category: "FINTECH", kind: "IMPORT",
    note: "Exportá el resumen desde la app y lo importás acá." },
  { id: "uala", name: "Ualá", category: "FINTECH", kind: "IMPORT",
    note: "Exportá el resumen desde la app y lo importás acá." },
  { id: "binance", name: "Binance", category: "EXCHANGE", kind: "SOON",
    note: "Tiene API real. El conector todavía no se escribió." },
  { id: "nexo", name: "Nexo", category: "EXCHANGE", kind: "SOON",
    note: "A confirmar si su API lo permite. Todavía no se escribió." },
  { id: "lemon", name: "Lemon", category: "EXCHANGE", kind: "SOON",
    note: "En el roadmap. Todavía no tiene conector." },
  { id: "belo", name: "Belo", category: "EXCHANGE", kind: "SOON",
    note: "En el roadmap. Todavía no tiene conector." },
];

export function institutionById(id: string | null | undefined): Institution | undefined {
  if (!id) return undefined;
  return INSTITUTIONS.find((i) => i.id === id);
}

/** Los dos proveedores reales. No viven en INSTITUTIONS: tienen su propia tarjeta
 *  con estado en vivo, esto es solo para poder mostrar su nombre en otros lugares
 *  (Cuentas, Dashboard) a partir del slug guardado en `Account.provider`. */
const REAL_PROVIDER_NAMES: Record<string, string> = {
  mercado_pago: "Mercado Pago",
  iol: "InvertirOnline",
};

/** Nombre para mostrar de cualquier `provider` guardado en una cuenta, real o no. */
export function providerLabel(provider: string | null | undefined): string | null {
  if (!provider) return null;
  return REAL_PROVIDER_NAMES[provider] ?? institutionById(provider)?.name ?? provider;
}
