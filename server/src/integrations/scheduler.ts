/**
 * El agendador de sincronizaciones.
 *
 * Un solo timer para toda la app, que cada minuto se pregunta qué integración toca.
 * NO un timer por integración: eso se llena de handles huérfanos que sobreviven a
 * desconexiones y siguen pegándole a una API con tokens que ya no existen.
 *
 * Corre dentro del proceso del server, que en la app empaquetada vive mientras la
 * ventana esté abierta. Si el usuario cierra Finance OS, no hay sync — y eso está
 * bien: es una app de escritorio, no un servicio.
 */

import { prisma } from "../lib/prisma";
import { IntegrationManager } from "./manager";
import { ProviderError } from "./types";

const TICK_MS = 60_000;

let timer: NodeJS.Timeout | null = null;
/** Evita que dos ticks se pisen si una sync tarda más de un minuto. */
let running = false;

async function tick() {
  if (running) return;
  running = true;

  try {
    const due = await prisma.integration.findMany({
      where: {
        status: "CONNECTED",
        syncIntervalMinutes: { gt: 0 },
        nextSyncAt: { lte: new Date() },
      },
      select: { userId: true, provider: true },
    });

    for (const { userId, provider } of due) {
      try {
        await IntegrationManager.sync(userId, provider);
      } catch (err) {
        // El manager ya registró el fallo y lo dejó en lastError, visible en la UI.
        // Acá solo hay que asegurarse de que una integración rota no impida que las
        // demás sincronicen.
        if (err instanceof ProviderError && err.kind === "RECONNECT") {
          // Reintentar no sirve: hace falta que el usuario reconecte. Apagamos la
          // agenda en vez de golpear la API cada 5 minutos con un token muerto.
          await prisma.integration.updateMany({
            where: { userId, provider },
            data: { syncIntervalMinutes: 0, nextSyncAt: null },
          });
        }
      }
    }
  } catch {
    // Que falle una lectura de la base no puede matar el scheduler para siempre.
  } finally {
    running = false;
  }
}

export function startScheduler() {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  // No mantiene el proceso vivo por sí solo: si el server se apaga, se apaga.
  timer.unref?.();
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
