/**
 * IntegrationManager.
 *
 * LA REGLA: el resto de Finance OS habla ÚNICAMENTE con esta clase. Nadie importa
 * MercadoPagoProvider ni IolProvider directamente — ni el router, ni el dashboard,
 * ni el scheduler. Si mañana Mercado Pago cambia su API entera, cambia una carpeta.
 *
 * Acá vive todo lo que es igual para cualquier proveedor:
 *   · cifrado de tokens en reposo
 *   · renovación automática antes de que venzan
 *   · ejecución de la sync
 *   · registro de cada intento, incluidos los que fallan
 */

import { prisma } from "../lib/prisma";
import { encrypt, decrypt } from "../lib/crypto";
import { getProvider, listProviders } from "./registry";
import { persistMovements, persistHoldings } from "./sync";
import { ProviderError } from "./types";
import type { Credentials, Provider, ProviderId, Tokens, HealthReport } from "./types";

/** Renovamos con margen: un token que vence en 2 minutos ya es un token vencido. */
const REFRESH_MARGIN_MS = 2 * 60 * 1000;

export interface SyncOutcome {
  provider: ProviderId;
  imported: number;
  updated: number;
  skipped: number;
  holdings: number;
  failed: number;
  balance: number | null;
  warnings: string[];
  durationMs: number;
}

export class IntegrationManager {
  /** Los proveedores que existen, con sus capacidades y advertencias. */
  static catalog() {
    return listProviders().map((p) => p.meta);
  }

  // ─── Tokens (siempre cifrados en reposo) ───

  private static pack(t: Tokens) {
    return {
      accessToken: encrypt(t.accessToken),
      refreshToken: t.refreshToken ? encrypt(t.refreshToken) : null,
      expiresAt: t.expiresAt,
      scope: t.scope,
      externalUser: t.externalUser,
    };
  }

  private static unpack(row: {
    accessToken: string | null;
    refreshToken: string | null;
    expiresAt: Date | null;
    scope: string | null;
    externalUser: string | null;
  }): Tokens | null {
    if (!row.accessToken) return null;
    try {
      return {
        accessToken: decrypt(row.accessToken),
        refreshToken: row.refreshToken ? decrypt(row.refreshToken) : null,
        expiresAt: row.expiresAt,
        scope: row.scope,
        externalUser: row.externalUser,
      };
    } catch {
      // No se pudieron descifrar: la clave cambió, o la fila está corrupta. Un token
      // que no se puede leer es un token que no existe.
      return null;
    }
  }

  /**
   * Devuelve tokens vivos, renovándolos si hace falta.
   *
   * El bearer de IOL dura 15 minutos, así que esto se ejecuta prácticamente en cada
   * sync. Tiene que ser barato y silencioso.
   */
  private static async live(userId: string, providerId: ProviderId, provider: Provider): Promise<Tokens> {
    const row = await prisma.integration.findUnique({
      where: { userId_provider: { userId, provider: providerId } },
    });
    if (!row) throw new ProviderError(`${provider.meta.label} no está conectado.`, "RECONNECT", providerId);

    const tokens = this.unpack(row);
    if (!tokens) throw new ProviderError(`${provider.meta.label} no está conectado.`, "RECONNECT", providerId);

    const expiring =
      tokens.expiresAt && tokens.expiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS;
    if (!expiring) return tokens;

    const fresh = await provider.refresh(tokens);
    await prisma.integration.update({
      where: { id: row.id },
      data: { ...this.pack(fresh), status: "CONNECTED", lastError: null },
    });
    return fresh;
  }

  // ─── Conectar / desconectar ───

  static authUrl(userId: string, providerId: string): string | null {
    return getProvider(providerId).authUrl(userId);
  }

  static async connect(userId: string, providerId: string, creds: Credentials) {
    const provider = getProvider(providerId);
    const tokens = await provider.connect(creds);

    const row = await prisma.integration.upsert({
      where: { userId_provider: { userId, provider: provider.meta.id } },
      update: { ...this.pack(tokens), status: "CONNECTED", lastError: null },
      create: {
        userId,
        provider: provider.meta.id,
        status: "CONNECTED",
        importFrom: new Date(Date.now() - 90 * 864e5),
        ...this.pack(tokens),
      },
    });

    // Toda cuenta que trae movimientos necesita una cuenta donde ponerlos.
    if (provider.meta.capabilities.movements) {
      const slug = provider.meta.id.toLowerCase();
      const exists = await prisma.account.findFirst({ where: { userId, provider: slug } });
      if (!exists)
        await prisma.account.create({
          data: {
            userId,
            name: provider.meta.label,
            type: provider.meta.id === "MERCADO_PAGO" ? "MERCADO_PAGO" : "BROKER",
            currency: "ARS",
            provider: slug,
          },
        });
    }

    return row.id;
  }

  static async disconnect(userId: string, providerId: string) {
    const provider = getProvider(providerId);
    const row = await prisma.integration.findUnique({
      where: { userId_provider: { userId, provider: provider.meta.id } },
    });
    if (!row) return;

    const tokens = this.unpack(row);
    if (tokens) {
      try {
        await provider.disconnect(tokens);
      } catch {
        // Que el proveedor no acepte la revocación no puede impedir que borremos
        // los tokens de nuestro lado. Lo segundo es lo que de verdad protege al usuario.
      }
    }

    await prisma.integration.update({
      where: { id: row.id },
      data: {
        status: "DISCONNECTED",
        accessToken: null,
        refreshToken: null,
        expiresAt: null,
        scope: null,
        reportedBalance: null,
        balanceAt: null,
        lastError: null,
        syncIntervalMinutes: 0,
        nextSyncAt: null,
      },
    });

    // Los movimientos importados se quedan: son plata que de verdad se movió.
    // Desconectar revoca un permiso, no reescribe la historia.
  }

  // ─── Salud ───

  static async health(userId: string, providerId: string): Promise<HealthReport> {
    const provider = getProvider(providerId);
    try {
      const tokens = await this.live(userId, provider.meta.id, provider);
      return await provider.health(tokens);
    } catch (e) {
      return {
        ok: false,
        message: e instanceof ProviderError ? e.message : "No se pudo verificar la conexión.",
        checkedAt: new Date(),
      };
    }
  }

  // ─── Sincronizar ───

  static async sync(userId: string, providerId: string): Promise<SyncOutcome> {
    const provider = getProvider(providerId);
    const id = provider.meta.id;
    const startedAt = Date.now();

    const row = await prisma.integration.findUnique({
      where: { userId_provider: { userId, provider: id } },
    });
    if (!row) throw new ProviderError(`${provider.meta.label} no está conectado.`, "RECONNECT", id);

    try {
      const tokens = await this.live(userId, id, provider);
      const since = row.importFrom ?? row.lastSyncAt ?? new Date(Date.now() - 90 * 864e5);

      const result = await provider.fetch(tokens, since);

      const account = provider.meta.capabilities.movements
        ? await prisma.account.findFirst({ where: { userId, provider: id.toLowerCase() } })
        : null;

      const counts = await persistMovements(userId, id, result.movements, account?.id ?? null);
      const holdingSync = result.holdings.length
        ? await persistHoldings(userId, id, result.holdings)
        : { received: 0, created: 0, updated: 0, closed: 0 };

      // Logs completos de la sincronización de posiciones. Quedan en el server (visibles
      // en la consola de la app) para poder auditar exactamente qué pasó en cada sync.
      if (result.holdings.length || holdingSync.closed) {
        console.log(
          `[sync ${id}] posiciones: recibidas=${holdingSync.received} ` +
            `nuevas=${holdingSync.created} actualizadas=${holdingSync.updated} ` +
            `cerradas=${holdingSync.closed}` +
            (result.warnings.length ? ` · avisos: ${result.warnings.join(" · ")}` : "")
        );
      }
      const holdings = holdingSync.received;

      const durationMs = Date.now() - startedAt;
      const next = row.syncIntervalMinutes > 0
        ? new Date(Date.now() + row.syncIntervalMinutes * 60_000)
        : null;

      await prisma.$transaction([
        prisma.integration.update({
          where: { id: row.id },
          data: {
            lastSyncAt: new Date(),
            nextSyncAt: next,
            lastDurationMs: durationMs,
            importedCount: { increment: counts.imported },
            reportedBalance: result.balance?.available ?? null,
            balanceAt: result.balance ? new Date() : null,
            lastError: null,
            status: "CONNECTED",
          },
        }),
        prisma.syncLog.create({
          data: {
            userId,
            integrationId: row.id,
            provider: id,
            status: counts.failed > 0 ? "PARTIAL" : "OK",
            imported: counts.imported,
            skipped: counts.skipped,
            fees: counts.updated, // reutilizamos la columna para "actualizados"
            durationMs,
            error: result.warnings.length ? result.warnings.join(" · ") : null,
          },
        }),
      ]);

      return {
        provider: id,
        ...counts,
        holdings,
        balance: result.balance?.available ?? null,
        warnings: result.warnings,
        durationMs,
      };
    } catch (err) {
      const message =
        err instanceof ProviderError ? err.message : `Falló la sincronización con ${provider.meta.label}.`;

      // Una sync que falla sigue siendo una sync. Si no queda registrada, el usuario
      // no tiene forma de entender por qué sus números dejaron de moverse.
      await prisma.$transaction([
        prisma.integration.update({
          where: { id: row.id },
          data: {
            lastError: message,
            ...(err instanceof ProviderError && err.kind === "RECONNECT"
              ? { status: "EXPIRED" }
              : {}),
          },
        }),
        prisma.syncLog.create({
          data: {
            userId,
            integrationId: row.id,
            provider: id,
            status: "FAILED",
            durationMs: Date.now() - startedAt,
            error: message,
          },
        }),
      ]);

      throw err instanceof ProviderError ? err : new ProviderError(message, "UNKNOWN", id);
    }
  }

  // ─── Agenda ───

  static async setSchedule(userId: string, providerId: string, minutes: number) {
    const provider = getProvider(providerId);
    const valid = [0, 5, 15, 30, 60];
    if (!valid.includes(minutes))
      throw new ProviderError("Intervalo no válido.", "UNKNOWN", provider.meta.id);

    await prisma.integration.update({
      where: { userId_provider: { userId, provider: provider.meta.id } },
      data: {
        syncIntervalMinutes: minutes,
        nextSyncAt: minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null,
      },
    });
  }

  /** Estado completo de las integraciones de un usuario, sin exponer un solo token. */
  static async list(userId: string) {
    const rows = await prisma.integration.findMany({
      where: { userId },
      select: {
        id: true, provider: true, status: true, externalUser: true,
        lastSyncAt: true, nextSyncAt: true, syncIntervalMinutes: true,
        lastDurationMs: true, importedCount: true, importFrom: true,
        reportedBalance: true, balanceAt: true, lastError: true,
        expiresAt: true, createdAt: true,
      },
    });

    return rows.map((r) => {
      const meta = listProviders().find((p) => p.meta.id === r.provider)?.meta;
      return { ...r, meta };
    });
  }
}
