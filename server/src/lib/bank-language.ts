/**
 * Interpretación del lenguaje bancario. PURO: sin base, sin red.
 *
 * ─── QUÉ RESUELVE ───
 *
 * Hasta ahora el importador deducía si algo era ingreso o gasto SOLO por el signo del
 * número o por el nombre de la columna. Eso falla con la mitad de los resúmenes reales,
 * porque los bancos argentinos escriben el tipo EN LA DESCRIPCIÓN: "Acreditación haberes",
 * "Compra con débito", "Transferencia enviada", "Extracción cajero".
 *
 * Este motor lee esa descripción y deduce el tipo. Sirve para CUALQUIER origen: CSV, PDF,
 * OFX o, el día de mañana, texto sacado de una imagen.
 *
 * ─── LA REGLA QUE NO SE NEGOCIA ───
 *
 * Ante la duda, devuelve null. Un movimiento mal clasificado ensucia el balance y el
 * usuario lo arrastra sin darse cuenta; uno sin clasificar se ve y se corrige. Por eso
 * acá no se adivina: si la frase no es concluyente, se deja que decida el signo del monto
 * (que es la señal más confiable) o el usuario.
 */

export type MovementKind = "INCOME" | "EXPENSE" | "TRANSFER";

/** Normaliza: minúsculas, sin acentos, sin signos, espacios colapsados. */
export function normalizePhrase(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Frases que indican ENTRADA de plata. Ordenadas de más específica a más general: el
 * motor busca la coincidencia MÁS LARGA, así "transferencia recibida" le gana a
 * "transferencia" (que sola es ambigua).
 */
const INCOME_PHRASES = [
  "transferencia recibida",
  "transferencia a favor",
  "acreditacion de haberes",
  "acreditacion haberes",
  "acreditacion",
  "acreditado",
  "deposito en efectivo",
  "deposito",
  "cobro",
  "cobranza",
  "ingreso",
  "abono a cuenta",
  "reintegro",
  "devolucion",
  "reembolso",
  "rendimientos",
  "interes ganado",
  "intereses ganados",
  "venta",
  "pago recibido",
  "te transfirieron",
  "dinero recibido",
];

/** Frases que indican SALIDA de plata. */
const EXPENSE_PHRASES = [
  "transferencia enviada",
  "transferencia realizada",
  "compra con debito",
  "compra con tarjeta",
  "compra en cuotas",
  "compra",
  "debito automatico",
  "debito",
  "extraccion cajero",
  "extraccion",
  "retiro de efectivo",
  "retiro",
  "pago de servicios",
  "pago qr",
  "pago con qr",
  "pago a",
  "pago",
  "consumo",
  "cargo",
  "comision",
  "impuesto",
  "iva",
  "percepcion",
  "retencion",
  "sellado",
  "seguro",
  "cuota",
  "suscripcion",
  "gasto",
  "egreso",
];

/**
 * Frases que indican MOVIMIENTO INTERNO entre cuentas propias. Ojo: "transferencia" sola
 * NO entra acá, porque la mayoría de las transferencias son a terceros. Solo las que dicen
 * explícitamente que es entre cuentas del mismo titular.
 */
const TRANSFER_PHRASES = [
  "transferencia entre cuentas propias",
  "entre cuentas propias",
  "cuentas propias",
  "traspaso entre cuentas",
  "traspaso",
  "movimiento interno",
  "a mi cuenta",
  "mismo titular",
];

interface Match {
  kind: MovementKind;
  phrase: string;
}

function findLongest(text: string, phrases: string[], kind: MovementKind): Match | null {
  let best: Match | null = null;
  for (const p of phrases) {
    if (!text.includes(p)) continue;
    if (!best || p.length > best.phrase.length) best = { kind, phrase: p };
  }
  return best;
}

export interface KindDetection {
  kind: MovementKind | null;
  /** La frase que disparó la decisión, para poder mostrársela al usuario. */
  matchedPhrase: string | null;
  /** Alta cuando la frase es inequívoca; baja cuando hubo que desempatar. */
  confidence: "high" | "low" | "none";
}

/**
 * Deduce el tipo de movimiento a partir de la descripción.
 *
 * Prioridad: transferencia interna > la frase más larga entre ingreso y gasto. Si ninguna
 * frase aparece, devuelve null (y el importador se queda con el signo del monto).
 */
export function detectKind(description: string): KindDetection {
  const text = normalizePhrase(description);
  if (!text) return { kind: null, matchedPhrase: null, confidence: "none" };

  // 1) Transferencia entre cuentas propias: es lo más específico, gana siempre. Importa
  //    detectarla porque NO es ni ingreso ni gasto: la plata no sale del patrimonio.
  const transfer = findLongest(text, TRANSFER_PHRASES, "TRANSFER");
  if (transfer) return { kind: "TRANSFER", matchedPhrase: transfer.phrase, confidence: "high" };

  const income = findLongest(text, INCOME_PHRASES, "INCOME");
  const expense = findLongest(text, EXPENSE_PHRASES, "EXPENSE");

  if (income && !expense) return { kind: "INCOME", matchedPhrase: income.phrase, confidence: "high" };
  if (expense && !income) return { kind: "EXPENSE", matchedPhrase: expense.phrase, confidence: "high" };

  // 2) Aparecen las dos: gana la frase más larga (más específica). Ejemplo real:
  //    "Pago recibido de transferencia" → "pago recibido" (13) vs "pago" (4) → INCOME.
  //    Se marca confianza baja porque hubo ambigüedad y conviene que el usuario lo mire.
  if (income && expense) {
    const winner = income.phrase.length >= expense.phrase.length ? income : expense;
    return { kind: winner.kind, matchedPhrase: winner.phrase, confidence: "low" };
  }

  return { kind: null, matchedPhrase: null, confidence: "none" };
}

/**
 * Combina la señal del texto con la del signo del monto.
 *
 * El signo es la fuente MÁS confiable cuando existe (un -8500 es inequívocamente una
 * salida). El texto se usa cuando el monto viene sin signo —que es el caso de la mitad de
 * los resúmenes y de cualquier ticket— y para detectar transferencias internas, que el
 * signo no puede distinguir de un gasto común.
 */
export function resolveKind(
  description: string,
  signedAmount: number | null
): KindDetection {
  const fromText = detectKind(description);

  // La transferencia interna solo se puede saber por el texto: el signo la ve como gasto.
  if (fromText.kind === "TRANSFER") return fromText;

  if (signedAmount !== null && Number.isFinite(signedAmount) && signedAmount !== 0) {
    const bySign: MovementKind = signedAmount > 0 ? "INCOME" : "EXPENSE";
    // Si texto y signo se contradicen, MANDA EL SIGNO (la plata que se movió es un hecho;
    // la redacción del banco es interpretación), pero se marca para revisar.
    if (fromText.kind && fromText.kind !== bySign) {
      return { kind: bySign, matchedPhrase: fromText.matchedPhrase, confidence: "low" };
    }
    // Coinciden. La confianza sube a alta SOLO si el texto era inequívoco: si la frase ya
    // era ambigua ("devolución de compra" tiene señales de ingreso Y de gasto), se
    // mantiene baja aunque el signo acompañe. Preferimos que el usuario mire de más y no
    // de menos: un tipo mal puesto se arrastra en el balance sin que nadie lo note.
    if (fromText.kind) {
      return {
        kind: bySign,
        matchedPhrase: fromText.matchedPhrase,
        confidence: fromText.confidence === "low" ? "low" : "high",
      };
    }
    // Sin señal en el texto: decide el signo solo, con confianza baja.
    return { kind: bySign, matchedPhrase: null, confidence: "low" };
  }

  return fromText;
}
