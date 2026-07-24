/**
 * El motor de sincronización.
 *
 * Es el único lugar del sistema que escribe movimientos importados. Los proveedores
 * solo TRAEN datos; acá se deciden tres cosas, y ninguna es negociable:
 *
 *   1. NUNCA duplicar.        (provider + providerTxId es la clave)
 *   2. Si el dato CAMBIÓ, actualizar.  (el hash lo detecta)
 *   3. NUNCA perder el payload original.
 */

import { prisma } from "../lib/prisma";
import { suggestCategory } from "../modules/classification";
import type { RawMovement, RawHolding, ProviderId } from "./types";
import { contentHash } from "./hash";

export interface SyncCounts {
  imported: number;
  updated: number;
  skipped: number;
  holdings: number;
  failed: number;
}


/**
 * Guarda los movimientos que trajo un proveedor.
 *
 * Un movimiento que falla no tira abajo la sync entera: se cuenta y se sigue. Perder
 * 300 movimientos buenos porque uno vino raro sería la peor manera de fallar.
 */
export async function persistMovements(
  userId: string,
  provider: ProviderId,
  movements: RawMovement[],
  accountId: string | null
): Promise<SyncCounts> {
  const counts: SyncCounts = { imported: 0, updated: 0, skipped: 0, holdings: 0, failed: 0 };

  for (const m of movements) {
    try {
      const hash = contentHash(m);

      const existing = await prisma.movement.findUnique({
        where: {
          userId_source_externalId: { userId, source: provider, externalId: m.providerTxId },
        },
      });

      if (existing) {
        if (existing.hash === hash) {
          counts.skipped++;
          continue;
        }

        // Cambió. Se actualiza — pero NO se toca la categoría: si el usuario la
        // corrigió a mano, pisársela porque el proveedor reenvió el pago sería
        // borrarle el trabajo y romper la promesa de que corregir enseña.
        await prisma.movement.update({
          where: { id: existing.id },
          data: {
            type: m.type,
            amount: m.amount,
            currency: m.currency,
            description: m.description,
            counterpart: m.counterpart,
            date: m.date,
            status: m.status,
            method: m.method,
            hash,
            raw: JSON.stringify(m.payload),
          },
        });
        counts.updated++;
        continue;
      }

      const categoryId = await suggestCategory(userId, m.classifyHint || m.description);

      await prisma.movement.create({
        data: {
          userId,
          source: provider,
          externalId: m.providerTxId,
          hash,
          type: m.type,
          amount: m.amount,
          currency: m.currency,
          description: m.description,
          counterpart: m.counterpart,
          date: m.date,
          status: m.status,
          method: m.method,
          categoryId,
          accountId,
          // El payload crudo, intacto. Si mañana descubrimos que mapeamos mal un
          // campo, se re-mapea desde acá sin volver a pegarle a la API.
          raw: JSON.stringify(m.payload),
        },
      });
      counts.imported++;
    } catch {
      counts.failed++;
    }
  }

  return counts;
}

/**
 * Guarda las posiciones de cartera.
 *
 * Una cartera es una FOTO, no un historial: reemplaza, no acumula. Y las posiciones
 * que ya no están se borran — si vendiste todas tus GGAL, no pueden seguir contando
 * en tu patrimonio.
 */
export async function persistHoldings(
  userId: string,
  provider: ProviderId,
  holdings: RawHolding[]
): Promise<{ received: number; created: number; updated: number; closed: number }> {
  const seen = new Set<string>();

  // Qué posiciones ABIERTAS había antes, para distinguir nuevas de actualizadas y para
  // saber cuáles cerrar. Una sola consulta.
  const before = await prisma.holding.findMany({
    where: { userId, provider, closed: false },
    select: { ticker: true },
  });
  const openBefore = new Set(before.map((h) => h.ticker));

  let created = 0;
  let updated = 0;

  for (const h of holdings) {
    seen.add(h.ticker);
    const data = {
      name: h.name,
      kind: h.kind,
      quantity: h.quantity,
      avgPrice: h.avgPrice,
      currentPrice: h.currentPrice,
      totalValue: h.totalValue,
      gainAmount: h.gainAmount,
      gainPct: h.gainPct,
      currency: h.currency,
      market: h.market,
      // Si la posición estaba cerrada y volvió a aparecer (la recompraste), se reabre.
      closed: false,
      raw: JSON.stringify(h.payload),
    };

    await prisma.holding.upsert({
      where: { userId_provider_ticker: { userId, provider, ticker: h.ticker } },
      update: data,
      create: { userId, provider, ticker: h.ticker, ...data },
    });

    if (openBefore.has(h.ticker)) updated++;
    else created++;
  }

  // Lo que ya no reporta el proveedor se CIERRA (no se borra): se conserva el historial.
  const closedResult = await prisma.holding.updateMany({
    where: { userId, provider, closed: false, ticker: { notIn: [...seen] } },
    data: { closed: true },
  });

  return { received: holdings.length, created, updated, closed: closedResult.count };
}
