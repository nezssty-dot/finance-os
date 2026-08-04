/**
 * La puerta de entrada. El resto de Finance OS importa de acá y de ningún otro lado.
 *
 * Fijate que NO se exportan los proveedores. Es a propósito: si alguien puede hacer
 * `import { MercadoPagoProvider }`, en tres sprints alguien lo va a hacer, y la
 * arquitectura se muere ahí.
 */

export { IntegrationManager } from "./manager";
export { startScheduler, stopScheduler } from "./scheduler";
export { recentLogs } from "./logs";
export { ProviderError } from "./types";
export type {
  ProviderId, ProviderMeta, Credentials, Capabilities, AuthKind, ErrorKind, HealthReport,
} from "./types";
export type { SyncOutcome } from "./manager";
