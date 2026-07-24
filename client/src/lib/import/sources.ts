import type { DetectedSource } from "./types";

/**
 * ¿De dónde salió este archivo?
 *
 * ─── ESTO ES UNA PISTA, NO UNA REGLA ───
 *
 * Detectar "esto parece de Mercado Pago" sirve para dos cosas:
 *   1. Mostrárselo al usuario, para que confíe en que la app entendió su archivo.
 *   2. Que en el futuro un importer específico pueda afinar el parseo si hace falta.
 *
 * Lo que NO hace —y es deliberado— es CAMBIAR cómo se parsea.
 *
 * El motor genérico del servidor ya funciona con formatos reales de Galicia, Santander,
 * Macro y Brubank, y está cubierto por 31 tests. Meter una rama por banco es la forma
 * más rápida de terminar con un if de 400 líneas que nadie se anima a tocar, y donde
 * agregar el banco 12 rompe el 3.
 *
 * Si algún día un banco necesita parseo especial de verdad, se escribe un Importer
 * propio. No un `if (banco === 'X')` adentro del motor.
 */

interface Signature {
  id: string;
  name: string;
  /** Todas tienen que aparecer. Una sola coincidencia es una casualidad. */
  required: RegExp[];
  /** Suman confianza, pero no son obligatorias. */
  hints?: RegExp[];
}

const SIGNATURES: Signature[] = [
  {
    id: "mercadopago",
    name: "Mercado Pago",
    required: [/mercado\s*pago/i],
    hints: [/dinero disponible/i, /cvu/i, /rendimientos/i],
  },
  {
    id: "galicia",
    name: "Banco Galicia",
    required: [/galicia/i],
    hints: [/movimientos de la cuenta/i, /caja de ahorro/i],
  },
  {
    id: "santander",
    name: "Santander",
    required: [/santander/i],
    hints: [/supercuenta/i, /movimientos/i],
  },
  {
    id: "bbva",
    name: "BBVA",
    required: [/bbva|banco franc[eé]s/i],
    hints: [/movimientos/i],
  },
  {
    id: "iol",
    name: "InvertirOnline",
    required: [/invertironline|\biol\b/i],
    hints: [/tenencia/i, /especie/i, /nominales/i],
  },
  {
    id: "brubank",
    name: "Brubank",
    required: [/brubank/i],
  },
  {
    id: "visa",
    name: "Visa",
    // "visa" suelto matchea "visado", "revisar"… Se exige que venga con contexto de
    // tarjeta, o el detector dice Visa para cualquier archivo que mencione una revisión.
    required: [/\bvisa\b/i, /(resumen|tarjeta|cr[eé]dito|cuenta)/i],
    hints: [/l[ií]mite de compra/i, /pago m[ií]nimo/i, /vencimiento/i],
  },
  {
    id: "mastercard",
    name: "Mastercard",
    required: [/master\s*card/i],
    hints: [/l[ií]mite de compra/i, /pago m[ií]nimo/i],
  },
  {
    id: "amex",
    name: "American Express",
    required: [/american\s*express|\bamex\b/i],
  },
  {
    id: "macro",
    name: "Banco Macro",
    required: [/banco\s*macro|\bmacro\b/i],
  },
  {
    id: "nacion",
    name: "Banco Nación",
    required: [/banco\s*(de\s*la\s*)?naci[oó]n|\bbna\b/i],
  },
  {
    id: "naranjax",
    name: "Naranja X",
    required: [/naranja\s*x/i],
  },
  {
    id: "uala",
    name: "Ualá",
    required: [/\bual[aá]\b/i],
  },
];

/**
 * Devuelve el origen más probable, o null.
 *
 * `null` es una respuesta legítima y frecuente: la mayoría de los CSV exportados no
 * dicen de dónde salieron. Inventar un origen para llenar el campo sería mentirle al
 * usuario, y la app no necesita saberlo para importar bien.
 */
export function detectSource(text: string): DetectedSource | null {
  // Solo el arranque: el nombre del banco está en el encabezado. Escanear un resumen de
  // 40 páginas para buscar "visa" garantiza encontrarlo en la descripción de algún
  // movimiento, y detectar mal.
  const head = text.slice(0, 4000);

  let best: DetectedSource | null = null;

  for (const sig of SIGNATURES) {
    if (!sig.required.every((r) => r.test(head))) continue;

    const hits = (sig.hints ?? []).filter((h) => h.test(head)).length;
    const total = sig.hints?.length ?? 0;

    // Base 0.6 por cumplir lo obligatorio, y hasta 0.4 más por las pistas.
    const confidence = 0.6 + (total ? (hits / total) * 0.4 : 0.2);

    if (!best || confidence > best.confidence) {
      best = { id: sig.id, name: sig.name, confidence: Math.min(1, confidence) };
    }
  }

  // Abajo de 0.5 no se muestra. Una corazonada presentada como un dato es peor que
  // no decir nada: el usuario la cree.
  return best && best.confidence >= 0.5 ? best : null;
}
