/**
 * MIGRACIONES DE LA BASE.
 *
 * ─── EL PROBLEMA QUE ESTO RESUELVE ───
 *
 * `schema.sql` usa `CREATE TABLE IF NOT EXISTS`. Sobre una base que YA existe, ve que
 * las tablas están y no hace nada. Eso funciona perfecto para tablas nuevas… y falla en
 * silencio para COLUMNAS nuevas:
 *
 *     Instalación nueva            → se crea todo, anda.
 *     Actualización que agrega una
 *     columna a una tabla existente → la columna NO se agrega. Prisma la pide, SQLite
 *                                     dice que no existe, y la app no abre.
 *
 * `prisma migrate deploy` no es una opción: la app empaquetada no tiene npx ni el
 * schema-engine (son ~20 MB de binario que no viajan en el .dmg).
 *
 * ─── CÓMO FUNCIONA ───
 *
 * SQLite guarda un entero de 32 bits en el header de cada archivo de base:
 * `PRAGMA user_version`. Es el mecanismo canónico de versionado y no requiere ninguna
 * tabla extra. Al arrancar:
 *
 *     versión actual = PRAGMA user_version   (una base nueva o vieja arranca en 0)
 *     aplicar, en orden, toda migración con version > actual
 *     grabar la nueva versión
 *
 * La v1 es el `schema.sql` que ya existía, sin tocar. Es idempotente, así que una base
 * VIEJA (la de alguien que ya tenía Finance OS instalado, con user_version = 0 y todas
 * las tablas creadas) la ejecuta sin efecto, queda marcada como v1, y a partir de ahí
 * recibe las incrementales igual que una instalación nueva. Nadie pierde datos y nadie
 * queda atrás.
 *
 * ─── EL CONTRATO, QUE NO SE NEGOCIA ───
 *
 * Si tocás `server/prisma/schema.prisma`, TENÉS que agregar acá una migración con la
 * versión siguiente. Si no, funciona en desarrollo (`prisma db push` sincroniza solo) y
 * rompe en la app instalada de todos. Es exactamente el bug que este archivo existe
 * para hacer imposible.
 *
 * Una migración ya publicada NUNCA se edita. Se agrega otra.
 *
 * ─── SQLITE Y `ALTER TABLE` ───
 *
 * SQLite solo soporta `ADD COLUMN` (no DROP, no ALTER de tipo, no agregar constraints).
 * Y `ADD COLUMN` con un DEFAULT no constante falla. Para todo lo demás hay que hacer
 * la danza de tabla nueva + copiar + renombrar, dentro de la transacción.
 */

export interface Migration {
  /** Estrictamente creciente. Nunca se reordena ni se reutiliza. */
  version: number;
  /** Qué hace, en castellano. Va al log cuando corre. */
  name: string;
  /**
   * Las sentencias. Corren en orden, dentro de UNA transacción: si una falla, no queda
   * ninguna aplicada y la versión no avanza. Una base a medio migrar es peor que una
   * sin migrar, porque no hay forma de saber en qué estado quedó.
   *
   * `null` significa "la baseline": usá el schema.sql que viene en el paquete.
   */
  statements: string[] | null;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "Baseline: el schema.sql del paquete",
    // La v1 no lleva SQL propio: es el schema.sql que ya se venía ejecutando. Se marca
    // como versión 1 para que las bases que ya existen (user_version = 0, tablas
    // creadas) entren al sistema sin que haya que detectar nada.
    statements: null,
  },
  {
    version: 2,
    name: "Servicios y suscripciones (Service + ServicePayment)",
    // Sprint 2. Las tablas también están en schema.sql (para instalaciones nuevas);
    // esta migración es la que se las da a las bases que YA existen y nunca las vieron.
    //
    // El `IF NOT EXISTS` hace que sea seguro en los dos caminos: en una instalación
    // nueva, schema.sql ya las creó como parte de la v1, así que acá no hace nada; en
    // una base vieja, schema.sql (idempotente) no las tenía y las crea recién acá.
    //
    // Es el DDL de schema.sql, palabra por palabra. Si cambia uno, cambian los dos.
    statements: [
      `CREATE TABLE IF NOT EXISTS "Service" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "categoryId" TEXT,
        "accountId" TEXT,
        "amount" REAL NOT NULL,
        "currency" TEXT NOT NULL DEFAULT 'ARS',
        "frequency" TEXT NOT NULL DEFAULT 'MONTHLY',
        "interval" INTEGER NOT NULL DEFAULT 1,
        "dueDay" INTEGER,
        "autoDebit" BOOLEAN NOT NULL DEFAULT false,
        "active" BOOLEAN NOT NULL DEFAULT true,
        "startDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "endDate" DATETIME,
        "notes" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        CONSTRAINT "Service_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "Service_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT "Service_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS "Service_userId_idx" ON "Service"("userId")`,
      `CREATE INDEX IF NOT EXISTS "Service_userId_active_idx" ON "Service"("userId", "active")`,
      `CREATE TABLE IF NOT EXISTS "ServicePayment" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "serviceId" TEXT NOT NULL,
        "dueDate" DATETIME NOT NULL,
        "paidAt" DATETIME,
        "movementId" TEXT,
        "amount" REAL NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ServicePayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "ServicePayment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "ServicePayment_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "Movement" ("id") ON DELETE SET NULL ON UPDATE CASCADE
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "ServicePayment_movementId_key" ON "ServicePayment"("movementId")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "ServicePayment_serviceId_dueDate_key" ON "ServicePayment"("serviceId", "dueDate")`,
      `CREATE INDEX IF NOT EXISTS "ServicePayment_userId_idx" ON "ServicePayment"("userId")`,
      `CREATE INDEX IF NOT EXISTS "ServicePayment_serviceId_idx" ON "ServicePayment"("serviceId")`,
    ],
  },
  {
    version: 3,
    name: "Holding.closed (posiciones cerradas, sin borrar historial)",
    // Cuando una posición desaparece de IOL (se vendió o venció), antes se BORRABA de la
    // tabla y se perdía el historial. Ahora se marca `closed = true` y queda. Este ALTER
    // le agrega la columna a las bases que ya existen; en instalaciones nuevas la crea
    // schema.sql como parte de la v1.
    //
    // SQLite: ADD COLUMN con DEFAULT constante funciona (acá `false`). Palabra por palabra
    // igual a lo que quedó en schema.sql.
    statements: [`ALTER TABLE "Holding" ADD COLUMN "closed" BOOLEAN NOT NULL DEFAULT false`],
  },
  {
    version: 4,
    name: "FxRate (cotizaciones del dólar + historial)",
    // Guarda la cotización de cada día por tipo (MEP, oficial, blue…). Con historial,
    // porque es lo que permite ver la evolución y valuar el patrimonio en su momento.
    // La clave única (date, kind) evita duplicar el mismo día.
    statements: [
      `CREATE TABLE IF NOT EXISTS "FxRate" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "kind" TEXT NOT NULL,
        "date" DATETIME NOT NULL,
        "buy" REAL,
        "sell" REAL,
        "source" TEXT,
        "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "FxRate_kind_date_key" ON "FxRate"("kind", "date")`,
      `CREATE INDEX IF NOT EXISTS "FxRate_date_idx" ON "FxRate"("date")`,
    ],
  },
  {
    version: 5,
    name: "Category.icon (un emoji por categoría)",
    // Para poder distinguir las categorías de un vistazo. Es opcional: sin icono, la
    // pantalla muestra la inicial, como hasta ahora.
    statements: [`ALTER TABLE "Category" ADD COLUMN "icon" TEXT`],
  },
];

/** La versión a la que debe llegar la base. Se deriva sola: no hay que acordarse. */
export const TARGET_VERSION = targetOf(MIGRATIONS);

export function targetOf(migrations: Migration[]): number {
  return migrations.reduce((max, m) => Math.max(max, m.version), 0);
}

type PrismaLike = {
  $executeRawUnsafe(sql: string): Promise<unknown>;
  $queryRawUnsafe<T = unknown>(sql: string): Promise<T>;
};

/** Parte un archivo .sql en sentencias, salteando comentarios y líneas vacías. */
export function splitStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((chunk) =>
      chunk
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter(Boolean);
}

async function currentVersion(prisma: PrismaLike): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ user_version: number | bigint }[]>(
    "PRAGMA user_version"
  );
  const raw = rows?.[0]?.user_version ?? 0;
  return Number(raw);
}

/**
 * ¿Ya existe una tabla o un índice con ese nombre? Consulta sqlite_master (el catálogo
 * real de la base). Junto con columnExists hace que toda migración sea idempotente.
 */
async function objectExists(
  prisma: PrismaLike,
  type: "table" | "index",
  name: string
): Promise<boolean> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type = '${type}' AND name = '${name}'`
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * ¿La tabla ya tiene esa columna? Consulta el esquema real (PRAGMA table_info). Sirve para
 * que las migraciones de ADD COLUMN sean idempotentes: no intentan agregar algo que ya está.
 */
async function columnExists(prisma: PrismaLike, table: string, column: string): Promise<boolean> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ name: string }[]>(
      `PRAGMA table_info("${table}")`
    );
    return Array.isArray(rows) && rows.some((r) => r.name === column);
  } catch {
    // Si la tabla no existe todavía, la columna tampoco: que el statement siga su curso.
    return false;
  }
}

/**
 * Lleva la base hasta la última versión.
 *
 * Devuelve qué migraciones corrió, para poder loguearlo. Si ya estaba al día, no toca
 * nada y devuelve una lista vacía — que es el caso normal en cada arranque.
 *
 * `migrations` se recibe por parámetro en vez de leer la constante del módulo: así los
 * tests pueden inyectar una migración de mentira y demostrar que un `ALTER TABLE`
 * incremental funciona, y que uno que falla revierte. Con un array global eso era
 * imposible de probar — y lo que no se puede probar, se rompe.
 */
export async function migrate(
  prisma: PrismaLike,
  baselineSql: string,
  opts: { migrations?: Migration[]; log?: (msg: string) => void } = {}
): Promise<number[]> {
  const migrations = opts.migrations ?? MIGRATIONS;
  const log = opts.log ?? (() => {});
  const target = targetOf(migrations);

  const from = await currentVersion(prisma);
  if (from >= target) return [];

  const pending = migrations
    .filter((m) => m.version > from)
    .sort((a, b) => a.version - b.version);
  const applied: number[] = [];

  for (const migration of pending) {
    const statements = migration.statements ?? splitStatements(baselineSql);

    log(`Migrando base a v${migration.version}: ${migration.name}`);

    // Todo o nada. SQLite soporta DDL transaccional (a diferencia de MySQL), así que
    // una migración a medio aplicar es un estado que sencillamente no puede existir.
    await prisma.$executeRawUnsafe("BEGIN");
    try {
      for (const statement of statements) {
        // ─── IDEMPOTENCIA ───
        // Una migración NUNCA puede romper una base que ya existe. SQLite no tiene
        // "ADD COLUMN IF NOT EXISTS", así que antes de tocar el esquema se consulta el
        // esquema REAL y, si el objeto ya está, se saltea la sentencia.
        //
        // Cubre los tres casos: columnas, tablas e índices. Así da igual si la base viene
        // de una instalación vieja, de una migración que corrió a medias, o de un
        // schema.sql fresco que ya trae el objeto: nunca tira "duplicate column name" ni
        // "table already exists".
        const addCol = statement.match(/ALTER\s+TABLE\s+"?(\w+)"?\s+ADD\s+COLUMN\s+"?(\w+)"?/i);
        if (addCol) {
          const [, table, column] = addCol;
          if (await columnExists(prisma, table, column)) {
            log(`  · columna ${table}.${column} ya existe, se saltea`);
            continue;
          }
        }

        const createTable = statement.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/i);
        if (createTable && await objectExists(prisma, "table", createTable[1])) {
          log(`  · tabla ${createTable[1]} ya existe, se saltea`);
          continue;
        }

        const createIndex = statement.match(
          /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/i
        );
        if (createIndex && await objectExists(prisma, "index", createIndex[1])) {
          log(`  · índice ${createIndex[1]} ya existe, se saltea`);
          continue;
        }

        await prisma.$executeRawUnsafe(statement);
      }
      // `user_version` no acepta parámetros bindeados; el valor es un entero nuestro,
      // de un literal en este archivo, así que la interpolación es segura.
      await prisma.$executeRawUnsafe(`PRAGMA user_version = ${migration.version}`);
      await prisma.$executeRawUnsafe("COMMIT");
    } catch (err) {
      await prisma.$executeRawUnsafe("ROLLBACK").catch(() => {});
      throw new Error(
        `Falló la migración v${migration.version} (${migration.name}). ` +
          `La base quedó intacta en v${from}. Detalle: ${(err as Error).message}`
      );
    }

    applied.push(migration.version);
  }

  return applied;
}
