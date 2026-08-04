/**
 * El registro de proveedores.
 *
 * Agregar Binance, Belo o Lemon mañana es: escribir su carpeta bajo providers/, que
 * implemente Provider, y sumar una línea acá. Ni una sola línea del resto de la
 * aplicación se entera.
 */

import type { Provider, ProviderId } from "./types";
import { ProviderError } from "./types";
import { MercadoPagoProvider } from "./providers/mercadopago";
import { IolProvider } from "./providers/iol";

const REGISTRY = new Map<ProviderId, Provider>([
  ["MERCADO_PAGO", new MercadoPagoProvider()],
  ["IOL", new IolProvider()],
]);

export function getProvider(id: string): Provider {
  const p = REGISTRY.get(id as ProviderId);
  if (!p) throw new ProviderError(`Proveedor desconocido: ${id}`, "UNKNOWN");
  return p;
}

export function listProviders(): Provider[] {
  return [...REGISTRY.values()];
}

export function providerExists(id: string): id is ProviderId {
  return REGISTRY.has(id as ProviderId);
}
