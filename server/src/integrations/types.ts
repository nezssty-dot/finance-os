/**
 * El contrato que todo proveedor debe cumplir.
 *
 * PURO: sin imports, sin IO, sin base de datos. Es solo la forma del acuerdo.
 *
 * La regla que sostiene toda esta arquitectura: el resto de la aplicación NUNCA
 * habla con Mercado Pago ni con IOL. Habla con el IntegrationManager, y el manager
 * habla con proveedores que cumplen esta interfaz. Agregar Binance o Belo mañana no
 * debería tocar una sola línea fuera de su propia carpeta.
 */

// ─────────────────────────────────────────────────────────────
// Identidad del proveedor
// ─────────────────────────────────────────────────────────────

export type ProviderId = "MERCADO_PAGO" | "IOL";

/** Cómo se conecta un proveedor. Determina qué le pedimos al usuario. */
export type AuthKind =
  /** Redirección al proveedor. El usuario nunca nos da su contraseña. (Mercado Pago) */
  | "OAUTH2"
  /**
   * Usuario y contraseña, intercambiados UNA vez por tokens. (IOL)
   *
   * Materialmente más riesgoso que OAuth y hay que tratarlo como tal: la contraseña
   * se usa una sola vez y no se guarda nunca. Solo persisten los tokens, cifrados.
   */
  | "PASSWORD_GRANT";

/** Qué trae un proveedor. No todos traen lo mismo. */
export interface Capabilities {
  /** Movimientos de dinero: cobros, pagos, transferencias. */
  movements: boolean;
  /** Posiciones de una cartera: acciones, CEDEARs, bonos, FCI. */
  holdings: boolean;
  /** Saldo declarado por el proveedor, para conciliar contra el nuestro. */
  balance: boolean;
  /**
   * Ventana máxima hacia atrás, en días. `null` = sin límite conocido.
   *
   * Mercado Pago: /v1/payments/search solo devuelve los últimos 12 meses. No es una
   * decisión nuestra, es un límite duro de su API, y la UI tiene que decirlo en vez
   * de dejar que el usuario crea que sincronizó toda su historia.
   */
  maxHistoryDays: number | null;
}

export interface ProviderMeta {
  id: ProviderId;
  /** Nombre para mostrarle a una persona. */
  label: string;
  auth: AuthKind;
  capabilities: Capabilities;
  /**
   * Advertencia que la UI DEBE mostrar antes de conectar, si existe.
   *
   * IOL entrega un token que puede operar: comprar y vender. Finance OS jamás lo va a
   * usar para eso, pero el usuario tiene derecho a saber qué está entregando.
   */
  warning?: string;
}

// ─────────────────────────────────────────────────────────────
// Credenciales
// ─────────────────────────────────────────────────────────────

/** Lo que el usuario entrega para conectar. Nunca se persiste tal cual. */
export type Credentials =
  | { kind: "OAUTH2"; code: string; state: string }
  | { kind: "PASSWORD_GRANT"; username: string; password: string };

/**
 * Lo que guardamos después de conectar. Siempre cifrado en reposo.
 *
 * La contraseña NO está acá, a propósito: se cambia por tokens en el momento de
 * conectar y se descarta. Un token robado se revoca; una contraseña robada abre la
 * cuenta entera del usuario, en el banco y en todos lados donde la reusó.
 */
export interface Tokens {
  accessToken: string;
  refreshToken: string | null;
  /** Cuándo vence el access token. IOL: 15 minutos. */
  expiresAt: Date | null;
  scope: string | null;
  /** Id del usuario del lado del proveedor. */
  externalUser: string | null;
}

// ─────────────────────────────────────────────────────────────
// Lo que un proveedor devuelve
// ─────────────────────────────────────────────────────────────

export type MovementType = "INCOME" | "EXPENSE" | "TRANSFER" | "INTERNAL" | "INVESTMENT";

/**
 * Un movimiento normalizado, listo para el motor de sync.
 *
 * `payload` es el JSON crudo del proveedor, sin tocar. Si mañana descubrimos que
 * mapeamos mal un campo, se re-mapea desde acá sin volver a pegarle a la API — y sin
 * haber perdido nada. Nunca se descarta.
 */
export interface RawMovement {
  /** Id de la transacción del lado del proveedor. Es la clave de deduplicación. */
  providerTxId: string;
  type: MovementType;
  amount: number;
  currency: string;
  description: string;
  counterpart: string | null;
  date: Date;
  /** Estado según el proveedor (approved, refunded…). Informativo. */
  status: string | null;
  /** Cómo se pagó: tarjeta de crédito, débito, QR, transferencia, saldo… */
  method: string | null;
  /** Texto que se le pasa al clasificador. */
  classifyHint: string;
  payload: unknown;
}

/** Una posición de cartera. Mapea 1:1 con el PosicionModel de IOL. */
export interface RawHolding {
  ticker: string;
  name: string;
  /** ACCIONES, CEDEARS, BONOS, FCI, ON, OPCIONES… tal como lo llama el proveedor. */
  kind: string;
  quantity: number;
  /** Precio promedio de compra. */
  avgPrice: number;
  currentPrice: number;
  totalValue: number;
  gainAmount: number;
  gainPct: number;
  currency: string;
  market: string | null;
  payload: unknown;
}

/** Saldo declarado por el proveedor, para conciliar. */
export interface RawBalance {
  available: number;
  currency: string;
  /** Plata que el proveedor tiene retenida o comprometida. */
  reserved?: number;
  /** Plata invertida dentro del propio proveedor (rendimientos de MP, por ejemplo). */
  invested?: number;
}

export interface FetchResult {
  movements: RawMovement[];
  holdings: RawHolding[];
  balance: RawBalance | null;
  /**
   * Cosas que el proveedor no dejó traer, y por qué.
   *
   * Sincronizar "bien" pero en silencio omitiendo la mitad de los datos es peor que
   * fallar: el usuario confía en un total que está mal. Esto sube hasta la UI.
   */
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────
// Errores
// ─────────────────────────────────────────────────────────────

export type ErrorKind =
  /** Hay que volver a conectar. Reintentar no sirve. */
  | "RECONNECT"
  /** El proveedor nos está limitando. Reintentar más tarde sí sirve. */
  | "RATE_LIMIT"
  /** El proveedor está caído. */
  | "PROVIDER_DOWN"
  /** No llegamos a la red. */
  | "NETWORK"
  /** La cuenta no tiene habilitado el servicio (IOL exige activarlo a mano). */
  | "NOT_ENABLED"
  | "UNKNOWN";

export class ProviderError extends Error {
  constructor(
    message: string,
    public kind: ErrorKind = "UNKNOWN",
    public provider?: ProviderId
  ) {
    super(message);
    this.name = "ProviderError";
  }

  /** Si reintentar tiene alguna chance de funcionar. */
  get retryable(): boolean {
    return this.kind === "RATE_LIMIT" || this.kind === "PROVIDER_DOWN" || this.kind === "NETWORK";
  }
}

// ─────────────────────────────────────────────────────────────
// La interfaz
// ─────────────────────────────────────────────────────────────

export interface HealthReport {
  ok: boolean;
  /** Qué le pasa, en castellano, y qué hacer al respecto. */
  message: string;
  checkedAt: Date;
  expiresAt?: Date | null;
}

export interface Provider {
  readonly meta: ProviderMeta;

  /**
   * Para OAuth: devuelve la URL a la que mandar al usuario.
   * Para password grant: null, porque no hay a dónde mandarlo.
   */
  authUrl(userId: string): string | null;

  /** Cambia credenciales por tokens. La contraseña muere acá. */
  connect(creds: Credentials): Promise<Tokens>;

  /** Renueva el access token con el refresh token. */
  refresh(tokens: Tokens): Promise<Tokens>;

  /** Revoca lo que se pueda revocar del lado del proveedor. */
  disconnect(tokens: Tokens): Promise<void>;

  /** Trae todo lo que el proveedor deja traer desde `since`. */
  fetch(tokens: Tokens, since: Date): Promise<FetchResult>;

  /** ¿La conexión sigue viva? */
  health(tokens: Tokens): Promise<HealthReport>;
}
