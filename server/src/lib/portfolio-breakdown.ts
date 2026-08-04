/**
 * Desglose de inversiones por tipo de activo. PURO: sin red, sin base.
 *
 * Agrupa las inversiones (manuales + tenencias de IOL) en categorías entendibles —
 * Acciones, CEDEARs, Bonos, Renta fija, ETF, Crypto, Efectivo— y calcula qué porcentaje
 * de la cartera es cada una. Los `kind` vienen de dos fuentes con nombres distintos (IOL
 * usa "Acciones"/"CEDEARs"/"Fondos Comunes"…, las manuales usan STOCK/BTC/FIXED_TERM…),
 * así que acá se unifican.
 *
 * Sobre monedas: los porcentajes se calculan sobre el total de los ítems que se pasan.
 * Como ARS y USD no se pueden sumar sin un tipo de cambio, quien llama pasa los ítems de
 * UNA moneda (por eso el desglose es coherente y no mezcla peras con manzanas).
 */

export type AssetType =
  | "Acciones"
  | "CEDEARs"
  | "Bonos"
  | "Renta fija"
  | "ETF"
  | "Crypto"
  | "Efectivo"
  | "Otro";

/** Normaliza un `kind` cualquiera (de IOL o manual) a una categoría de activo. */
export function assetType(kind: string): AssetType {
  const k = String(kind ?? "").toUpperCase().replace(/[\s_-]/g, "");

  if (k.includes("CEDEAR")) return "CEDEARs";
  if (k.includes("ACCION") || k === "STOCK") return "Acciones";
  if (k.includes("ETF")) return "ETF";
  if (k.includes("BONO")) return "Bonos";
  // Renta fija: ON, FCI/fondos, cauciones, plazo fijo. Instrumentos de renta previsible.
  if (
    k.includes("OBLIGacionesNEGOCIABLES".toUpperCase()) ||
    k.includes("OBLIGACION") ||
    k === "ON" ||
    k.includes("FONDO") ||
    k === "FCI" ||
    k === "FUND" ||
    k.includes("CAUCION") ||
    k.includes("PLAZOFIJO") ||
    k === "FIXEDTERM" ||
    k.includes("LETRA")
  )
    return "Renta fija";
  if (k === "BTC" || k === "ETH" || k === "USDT" || k.includes("CRYPTO") || k.includes("CRIPTO"))
    return "Crypto";
  if (k === "USD" || k === "PESOS" || k === "ARS" || k.includes("EFECTIVO") || k.includes("CASH"))
    return "Efectivo";
  return "Otro";
}

export interface TypeGroup {
  type: AssetType;
  value: number;
  /** Porcentaje del total de la cartera (0-100), redondeado a un decimal. */
  pct: number;
  count: number;
}

/**
 * Agrupa por tipo de activo y calcula porcentajes. Devuelve las categorías con valor,
 * ordenadas de mayor a menor. Las que suman 0 no aparecen.
 */
export function groupByAssetType(items: { kind: string; currentValue: number }[]): TypeGroup[] {
  const acc = new Map<AssetType, { value: number; count: number }>();
  let total = 0;

  for (const it of items) {
    const value = Number(it.currentValue) || 0;
    const type = assetType(it.kind);
    const cur = acc.get(type) ?? { value: 0, count: 0 };
    cur.value += value;
    cur.count += 1;
    acc.set(type, cur);
    total += value;
  }

  const groups: TypeGroup[] = [];
  for (const [type, { value, count }] of acc) {
    if (value === 0 && count === 0) continue;
    groups.push({
      type,
      value: Math.round(value * 100) / 100,
      pct: total > 0 ? Math.round((value / total) * 1000) / 10 : 0,
      count,
    });
  }

  groups.sort((a, b) => b.value - a.value);
  return groups;
}
