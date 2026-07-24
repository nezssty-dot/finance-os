/**
 * Tests del sistema de migraciones. Contra SQLite DE VERDAD, no un mock.
 *
 * Un mock acá no probaría nada: lo que hay que demostrar es que `PRAGMA user_version`
 * persiste, que una transacción de DDL revierte de verdad, y que una base VIEJA (con
 * tablas ya creadas y user_version = 0 — o sea, la de cualquiera que ya tenga Finance OS
 * instalado) se pone al día sin perder un solo dato.
 *
 * Eso último es el test que importa. Es el bug de KNOWN-GAPS §1: "la primera
 * actualización rompe la base de datos de todos".
 *
 * Usa sql.js: SQLite REAL compilado a WebAssembly. Es JS puro —cero binarios nativos, un
 * solo paquete— así que corre igual en cualquier versión de Node (el CI usa 20, Electron
 * 32 embebe 20) sin depender de `node:sqlite`, que existe recién en Node 22.5. Y como es
 * SQLite de verdad, la idempotencia se valida contra el motor real, no contra un mock.
 */

import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import { migrate, splitStatements, MIGRATIONS, TARGET_VERSION, type Migration } from "../src/migrations";

// Se inicializa dentro de main() (el proyecto compila a CommonJS, sin top-level await).
let SQL: SqlJsStatic;

let passed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void | Promise<void>) {
  const run = async () => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e: any) {
      failures.push(name);
      console.log(`  ✗ ${name}\n      ${e.message}`);
    }
  };
  return run();
}

function eq(actual: any, expected: any, what: string) {
  if (actual !== expected)
    throw new Error(`${what}: esperaba ${JSON.stringify(expected)}, obtuve ${JSON.stringify(actual)}`);
}

/**
 * Adapta sql.js al contrato PrismaLike que espera `migrate()`.
 * Es el mismo contrato que cumple el PrismaClient real en main.ts.
 */
function adapter(db: Database) {
  return {
    async $executeRawUnsafe(sql: string) {
      db.run(sql);
      return 0;
    },
    async $queryRawUnsafe<T>(sql: string): Promise<T> {
      const stmt = db.prepare(sql);
      const rows: Record<string, unknown>[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows as T;
    },
  };
}

const BASELINE = `
CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "email" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "Movement" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "amount" REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS "Holding" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "ticker" TEXT NOT NULL,
  "totalValue" REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS "Category" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL
);
`;

function queryRows(db: Database, sql: string): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  const rows: Record<string, unknown>[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

const version = (db: Database) =>
  Number(queryRows(db, "PRAGMA user_version")[0].user_version);

const tables = (db: Database) =>
  queryRows(db, "SELECT name FROM sqlite_master WHERE type='table'")
    .map((r) => String(r.name))
    .filter((n) => !n.startsWith("sqlite_"))
    .sort();

async function main() {
  SQL = await initSqlJs();

  console.log("\n─── El parser de sentencias ───\n");

  await test("saltea comentarios y líneas vacías", () => {
    const out = splitStatements("-- un comentario\nCREATE TABLE a (x INT);\n\n-- otro\nCREATE TABLE b (y INT);");
    eq(out.length, 2, "cantidad de sentencias");
  });

  await test("no devuelve sentencias vacías por el punto y coma final", () => {
    const out = splitStatements("CREATE TABLE a (x INT);\n");
    eq(out.length, 1, "cantidad de sentencias");
  });

  console.log("\n─── Instalación NUEVA ───\n");

  await test("una base vacía queda en la versión target con todas las tablas", async () => {
    const db = new SQL.Database();
    const applied = await migrate(adapter(db), BASELINE);

    eq(applied.length, MIGRATIONS.length, "migraciones aplicadas");
    eq(version(db), TARGET_VERSION, "user_version");
    // El BASELINE de prueba trae User + Movement; la migración v2 (real) agrega las
    // tablas de servicios encima. Por eso el set final las incluye.
    const t = tables(db);
    eq(t.includes("User") && t.includes("Movement"), true, "tablas del baseline");
    eq(t.includes("Service") && t.includes("ServicePayment"), true, "tablas de la v2");
    db.close();
  });

  await test("arrancar la app de nuevo no vuelve a migrar (es el caso normal)", async () => {
    const db = new SQL.Database();
    await migrate(adapter(db), BASELINE);
    const second = await migrate(adapter(db), BASELINE);

    eq(second.length, 0, "migraciones en el segundo arranque");
    eq(version(db), TARGET_VERSION, "user_version");
    db.close();
  });

  console.log("\n─── El caso que rompía todo: una base VIEJA que ya existe ───\n");

  await test("una base con tablas y user_version=0 se adopta sin perder datos", async () => {
    // Esto es exactamente la base de alguien que ya tiene Finance OS instalado: las
    // tablas existen (las creó el viejo `CREATE TABLE IF NOT EXISTS`), tiene datos
    // adentro, y nunca vio un `user_version` en su vida.
    const db = new SQL.Database();
    db.run(BASELINE);
    db.run(`INSERT INTO "User" VALUES ('u1', 'gabi@nezsty.com')`);
    db.run(`INSERT INTO "Movement" VALUES ('m1', 15000.50)`);
    eq(version(db), 0, "user_version antes de migrar");

    await migrate(adapter(db), BASELINE);

    eq(version(db), TARGET_VERSION, "user_version después");
    // Lo único que de verdad importa: los datos siguen ahí.
    const user = queryRows(db, `SELECT email FROM "User" WHERE id = 'u1'`)[0] as any;
    eq(user?.email, "gabi@nezsty.com", "el usuario sobrevivió");
    const mov = queryRows(db, `SELECT amount FROM "Movement" WHERE id = 'm1'`)[0] as any;
    eq(mov?.amount, 15000.5, "el movimiento sobrevivió, con su monto exacto");
    db.close();
  });

  console.log("\n─── Una migración incremental (el caso del sprint que viene) ───\n");

  await test("agregar una columna a una tabla existente SÍ funciona", async () => {
    const db = new SQL.Database();
    await migrate(adapter(db), BASELINE);
    db.run(`INSERT INTO "Movement" VALUES ('m1', 999)`);

    // Así se va a ver la migración del sprint que viene (§5: tags, notas, subcategoría).
    const next: Migration[] = [
      ...MIGRATIONS,
      {
        version: TARGET_VERSION + 1,
        name: "tags en Movement",
        statements: [`ALTER TABLE "Movement" ADD COLUMN "tags" TEXT`],
      },
    ];

    const applied = await migrate(adapter(db), BASELINE, { migrations: next });
    eq(applied.join(","), String(TARGET_VERSION + 1), "migración aplicada");
    eq(version(db), TARGET_VERSION + 1, "user_version avanzó");

    db.run(`UPDATE "Movement" SET tags = 'fijo,suscripcion' WHERE id = 'm1'`);
    const row = queryRows(db, `SELECT tags, amount FROM "Movement" WHERE id = 'm1'`)[0] as any;
    eq(row?.tags, "fijo,suscripcion", "la columna nueva existe y guarda");
    eq(row?.amount, 999, "el dato viejo no se tocó");
    db.close();
  });

  await test("una migración que agrega una columna que YA existe se saltea (idempotente)", async () => {
    // Replica EXACTO el error de Windows: la base ya tenía "closed" (porque la creó fresca
    // el schema.sql que ya la trae) y la migración intenta agregarla otra vez.
    const db = new SQL.Database();
    await migrate(adapter(db), BASELINE); // acá Holding ya queda con "closed" (v3)

    const dup: Migration[] = [
      ...MIGRATIONS,
      {
        version: TARGET_VERSION + 1,
        name: "intenta agregar closed de nuevo",
        statements: [`ALTER TABLE "Holding" ADD COLUMN "closed" BOOLEAN NOT NULL DEFAULT false`],
      },
    ];

    let threw = false;
    let applied: number[] = [];
    try {
      applied = await migrate(adapter(db), BASELINE, { migrations: dup });
    } catch {
      threw = true;
    }
    eq(threw, false, "NO tira 'duplicate column': la columna ya existe y se saltea");
    eq(applied.join(","), String(TARGET_VERSION + 1), "la migración corrió igual");
    eq(version(db), TARGET_VERSION + 1, "la versión avanzó");
    db.close();
  });


  await test("una migración que crea una tabla o índice que YA existe se saltea", async () => {
    // Mismo criterio que con las columnas: una actualización nunca puede romper una base
    // que ya tiene el objeto (pasa si la base salió de un schema.sql fresco).
    const db = new SQL.Database();
    await migrate(adapter(db), BASELINE);

    const dup: Migration[] = [
      ...MIGRATIONS,
      {
        version: TARGET_VERSION + 1,
        name: "recrea tabla e índice existentes",
        statements: [
          // Sin "IF NOT EXISTS" a propósito: el guard tiene que atajarlo igual.
          `CREATE TABLE "FxRate" ("id" TEXT NOT NULL PRIMARY KEY)`,
          `CREATE UNIQUE INDEX "FxRate_kind_date_key" ON "FxRate"("kind", "date")`,
        ],
      },
    ];

    let threw = false;
    try {
      await migrate(adapter(db), BASELINE, { migrations: dup });
    } catch {
      threw = true;
    }
    eq(threw, false, "NO tira 'table already exists': se saltea");
    eq(version(db), TARGET_VERSION + 1, "la versión avanzó igual");
    db.close();
  });

  await test("si una migración falla, NO queda a medio aplicar y la versión no avanza", async () => {
    const db = new SQL.Database();
    await migrate(adapter(db), BASELINE);
    const before = version(db);

    const broken: Migration[] = [
      ...MIGRATIONS,
      {
        version: TARGET_VERSION + 1,
        name: "una que se rompe en la segunda sentencia",
        statements: [
          `ALTER TABLE "Movement" ADD COLUMN "notas" TEXT`,
          `ALTER TABLE "TablaQueNoExiste" ADD COLUMN "x" TEXT`, // 💥
        ],
      },
    ];

    let threw = false;
    try {
      await migrate(adapter(db), BASELINE, { migrations: broken });
    } catch {
      threw = true;
    }
    eq(threw, true, "la migración tiró error");
    eq(version(db), before, "la versión NO avanzó");

    // Y la primera sentencia tampoco quedó aplicada: o entra todo, o no entra nada.
    const cols = queryRows(db, `PRAGMA table_info("Movement")`).map((c) => c.name);
    eq(cols.includes("notas"), false, "la columna a medio agregar se revirtió");
    db.close();
  });

  console.log(
    failures.length
      ? `\n❌ ${failures.length} fallaron, ${passed} pasaron\n`
      : `\n${passed}/${passed} tests de migraciones pasaron\n`
  );

  if (failures.length) process.exit(1);
}

main();
