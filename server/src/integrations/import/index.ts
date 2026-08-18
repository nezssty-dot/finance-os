import { prisma } from "../../lib/prisma";
import { suggestCategory } from "../../modules/classification";
import { resolveKind } from "../../lib/bank-language";
import { detectServicePayments } from "../../modules/service-detection";
import { analyze, withImportIds, type ColumnMapping } from "./statement";

export { analyze, type ColumnMapping, type ImportPreview } from "./statement";

export interface ImportResult {
  imported: number;
  skipped: number;
  rejected: number;
  // Pagos de servicios detectados automáticamente entre lo que se importó. Se informa
  // para que el usuario sepa qué se marcó pagado, en vez de que aparezca por arte de magia.
  servicePaymentsDetected: number;
}

/**
 * Escribe en la base lo que el usuario YA vio y confirmó.
 *
 * Se llama después de analyze(), nunca antes. Un importador que escribe sin mostrar
 * es un importador que te ensucia el historial financiero, y limpiarlo después es
 * peor que haber cargado todo a mano.
 */
export async function commitImport(
  userId: string,
  accountId: string,
  text: string,
  mapping?: Partial<ColumnMapping>
): Promise<ImportResult> {
  const preview = analyze(text, mapping);
  const rows = withImportIds(preview.rows);

  // La moneda de lo importado la define la cuenta destino: si importás un extracto en
  // una cuenta en dólares, los movimientos son en dólares. Antes clavaba ARS, lo que
  // dejaba el saldo de la cuenta (USD) sin cerrar con sus movimientos (marcados ARS).
  const account = await prisma.account.findFirst({
    where: { id: accountId, userId },
    select: { currency: true },
  });
  const currency = account?.currency ?? "ARS";

  let imported = 0;
  let skipped = 0;
  const createdIds: string[] = [];

  // Deduplicación en bloque: UNA query trae todos los IDs ya importados de este usuario,
  // en vez de un findUnique por fila. Con 10.000 filas eso pasa de 10.000 consultas a 1.
  // La lógica de "no duplicar" es idéntica (misma comparación por importId), solo que la
  // fuente es un Set en memoria. Se filtran por source IMPORT porque el importId solo se
  // usa acá.
  const already = await prisma.movement.findMany({
    where: { userId, source: "IMPORT" },
    select: { externalId: true },
  });
  const existingIds = new Set(already.map((m) => m.externalId));

  for (const row of rows) {
    if (existingIds.has(row.importId)) {
      skipped++; // ya estaba: reimportar el mismo extracto no duplica
      continue;
    }
    // Se agrega al Set sobre la marcha: si el mismo archivo trae dos filas con idéntico
    // importId (raro, pero posible), la segunda no se duplica dentro de la misma corrida.
    existingIds.add(row.importId);

    const categoryId = await suggestCategory(userId, row.description);

    // El tipo sale de combinar lo que DICE el banco con el signo del monto, no solo del
    // signo. Sin esto, una "Transferencia entre cuentas propias" entra como gasto y le
    // baja el patrimonio al usuario, cuando la plata nunca salió de su bolsillo.
    const detected = resolveKind(row.description, row.amount);
    const type = detected.kind ?? (row.amount >= 0 ? "INCOME" : "EXPENSE");

    const created = await prisma.movement.create({
      data: {
        userId,
        source: "IMPORT",
        externalId: row.importId,
        type,
        amount: Math.abs(row.amount),
        currency,
        description: row.description,
        date: row.date,
        accountId,
        categoryId,
        // La fila original, sin tocar. Si mañana mejoramos el parseo, se re-procesa
        // desde acá sin pedirle al usuario que vuelva a bajar el extracto.
        raw: JSON.stringify({ csv: row.raw, mapping: preview.mapping }),
      },
    });
    createdIds.push(created.id);
    imported++;
  }

  // Recién ahora, con los movimientos ya en la base, se buscan pagos de servicios.
  // Va acá y no dentro del loop porque el matcher necesita el movimiento persistido y
  // conviene hacerlo en bloque. Si algo falla, no se cae la importación entera: los
  // movimientos ya están guardados, que es lo que de verdad importa.
  let servicePaymentsDetected = 0;
  try {
    const detected = await detectServicePayments(userId, createdIds);
    servicePaymentsDetected = detected.length;
  } catch {
    // La detección es un extra: si falla, el import fue exitoso igual.
  }

  return { imported, skipped, rejected: preview.rejected.length, servicePaymentsDetected };
}
