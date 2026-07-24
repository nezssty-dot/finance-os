/**
 * Historial de sincronizaciones.
 *
 * Incluye las que fallaron — que son justamente las que hay que poder ver. Una sync
 * que falla en silencio es un usuario que confía en números que dejaron de actualizarse.
 */

import { prisma } from "../lib/prisma";

export interface LogEntry {
  id: string;
  provider: string;
  status: string;
  imported: number;
  updated: number;
  skipped: number;
  durationMs: number;
  error: string | null;
  createdAt: Date;
}

export async function recentLogs(userId: string, limit = 30): Promise<LogEntry[]> {
  const rows = await prisma.syncLog.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 100),
  });

  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    status: r.status,
    imported: r.imported,
    updated: r.fees, // la columna `fees` guarda los actualizados desde esta versión
    skipped: r.skipped,
    durationMs: r.durationMs,
    error: r.error,
    createdAt: r.createdAt,
  }));
}
