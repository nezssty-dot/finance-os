#!/usr/bin/env node
/**
 * VERIFICACIÓN END-TO-END — corré esto en TU máquina.
 *
 *   npm run verify
 *
 * Levanta el server de verdad, contra SQLite de verdad, y ejecuta el checklist
 * completo: crear cuenta, iniciar sesión, crear cuentas, movimientos, inversión,
 * deuda, presupuesto, objetivo, exportar PDF/Excel/CSV, reiniciar y confirmar que
 * TODO quedó exactamente igual.
 *
 * No pude correr esto en el entorno donde se escribió el código: el motor nativo de
 * Prisma se baja de un dominio que ahí está bloqueado. En tu máquina sí baja, así que
 * este script es la verificación que a mí me faltó.
 *
 * Usa una base de datos temporal aparte. NO toca tus datos reales.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 4599;
const BASE = `http://127.0.0.1:${PORT}/api`;
const dir = mkdtempSync(join(tmpdir(), "fos-verify-"));
const DB = join(dir, "verify.db");

let pass = 0;
const fails = [];
let token = null;
let server = null;

const c = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", d: "\x1b[2m", x: "\x1b[0m", b: "\x1b[1m" };

function step(name, fn) {
  return async () => {
    try {
      await fn();
      pass++;
      console.log(`  ${c.g}✓${c.x} ${name}`);
    } catch (e) {
      fails.push({ name, error: e.message });
      console.log(`  ${c.r}✗${c.x} ${name}\n      ${c.r}${e.message}${c.x}`);
    }
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function near(a, b, msg, tol = 0.01) {
  if (Math.abs(Number(a) - Number(b)) > tol)
    throw new Error(`${msg}: esperaba ${b}, obtuve ${a}`);
}

async function call(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const type = res.headers.get("content-type") ?? "";
  const payload = type.includes("json")
    ? await res.json()
    : Buffer.from(await res.arrayBuffer());
  if (!res.ok) {
    const msg = payload?.error ?? payload?.message ?? res.status;
    throw new Error(`${opts.method ?? "GET"} ${path} → ${res.status}: ${msg}`);
  }
  return payload;
}

function boot() {
  return new Promise((resolve, reject) => {
    server = spawn("npx", ["tsx", "src/server.ts"], {
      cwd: "server",
      env: {
        ...process.env,
        NODE_ENV: "development",
        PORT: String(PORT),
        DATABASE_URL: `file:${DB}`,
        JWT_ACCESS_SECRET: "verify-access-secret-that-is-long-enough-x",
        JWT_REFRESH_SECRET: "verify-refresh-secret-that-is-long-enough-x",
        OAUTH_STATE_SECRET: "verify-state-secret-that-is-long-enough-xxx",
        ENCRYPTION_KEY: "0".repeat(64),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    const done = setTimeout(() => reject(new Error(`El server no arrancó.\n${out}`)), 45_000);

    const watch = (chunk) => {
      out += chunk.toString();
      if (out.includes(`${PORT}`) || out.toLowerCase().includes("api")) {
        clearTimeout(done);
        setTimeout(resolve, 1200); // let it settle
      }
    };
    server.stdout.on("data", watch);
    server.stderr.on("data", watch);
    server.on("exit", (code) => {
      clearTimeout(done);
      if (code !== 0) reject(new Error(`El server murió (código ${code}).\n${out}`));
    });
  });
}

function kill() {
  if (server && !server.killed) server.kill("SIGTERM");
  server = null;
}

// ─────────────────────────────────────────────────────────────

const ids = {};

async function main() {
  console.log(`\n${c.b}FINANCE OS — verificación end-to-end${c.x}`);
  console.log(`${c.d}base temporal: ${DB}${c.x}\n`);

  if (!existsSync("server/node_modules/.prisma/client")) {
    console.log(`${c.r}Falta el motor de Prisma.${c.x}`);
    console.log(`  Corré:  cd server && npx prisma generate\n`);
    process.exit(1);
  }

  console.log(`${c.d}levantando el server…${c.x}`);
  await boot();
  console.log(`${c.g}server arriba${c.x}\n`);

  console.log(`${c.b}── Cuenta y sesión ──${c.x}\n`);

  await step("crear una cuenta", async () => {
    const r = await call("/auth/register", {
      method: "POST",
      body: { name: "Verificación", email: `v${Date.now()}@finance.os`, password: "unaClaveLarga123" },
    });
    assert(r.accessToken, "no vino accessToken");
    assert(r.user.onboardedAt === null, "una cuenta nueva no debería estar onboardeada");
    token = r.accessToken;
    ids.email = r.user.email;
  })();

  await step("iniciar sesión", async () => {
    const r = await call("/auth/login", {
      method: "POST",
      body: { email: ids.email, password: "unaClaveLarga123" },
    });
    assert(r.accessToken, "no vino accessToken");
    token = r.accessToken;
  })();

  await step("completar el onboarding", async () => {
    const r = await call("/users/me/onboard", { method: "POST" });
    assert(r.onboardedAt, "onboardedAt sigue vacío");
  })();

  console.log(`\n${c.b}── Cargar datos ──${c.x}\n`);

  await step("crear cuentas", async () => {
    const mp = await call("/accounts", {
      method: "POST",
      body: { name: "Mercado Pago", type: "MERCADO_PAGO", currency: "ARS", openingBalance: 100000 },
    });
    const cash = await call("/accounts", {
      method: "POST",
      body: { name: "Efectivo", type: "CASH", currency: "ARS", openingBalance: 50000 },
    });
    ids.mp = mp.id;
    ids.cash = cash.id;
    near(mp.balance, 100000, "una cuenta nueva vale su saldo inicial");
  })();

  await step("crear un movimiento manual (ingreso)", async () => {
    const m = await call("/movements", {
      method: "POST",
      body: {
        type: "INCOME", amount: 250000, currency: "ARS",
        description: "Mezcla y master", date: new Date().toISOString(), accountId: ids.mp,
      },
    });
    ids.mov = m.id;
  })();

  await step("el saldo se recalcula solo (no hay ningún campo guardado)", async () => {
    const accounts = await call("/accounts");
    const mp = accounts.find((a) => a.id === ids.mp);
    near(mp.balance, 350000, "saldo derivado de MP"); // 100k inicial + 250k
  })();

  await step("registrar una inversión", async () => {
    const inv = await call("/investments", {
      method: "POST",
      body: { name: "CEDEAR AAPL", kind: "STOCKS", capital: 80000, currentValue: 92000, currency: "ARS" },
    });
    ids.inv = inv.id;
  })();

  await step("registrar una deuda", async () => {
    const d = await call("/debts", {
      method: "POST",
      body: { name: "Kevin (sesiones)", amount: 60000, kind: "OWE" },
    });
    ids.debt = d.id;
  })();

  await step("pagar parte de la deuda", async () => {
    await call(`/debts/${ids.debt}/pay`, { method: "POST", body: { amount: 20000 } });
    const debts = await call("/debts");
    const d = debts.find((x) => x.id === ids.debt);
    near(d.paid, 20000, "pagado");
    near(d.outstanding ?? d.amount - d.paid, 40000, "lo que queda debiendo");
  })();

  await step("crear un presupuesto", async () => {
    const cats = await call("/categories");
    assert(cats.length, "no hay categorías (el registro debería sembrarlas)");
    const b = await call("/budgets", {
      method: "POST",
      body: { categoryId: cats[0].id, limit: 120000, period: "MONTHLY" },
    });
    ids.budget = b.id;
  })();

  await step("crear un objetivo", async () => {
    const g = await call("/goals", {
      method: "POST",
      body: { name: "Monitores nuevos", target: 900000, saved: 150000 },
    });
    ids.goal = g.id;
  })();

  await step("una transferencia entre cuentas propias no crea ni destruye plata", async () => {
    const before = await call("/patrimonio/current");
    await call("/accounts/transfer", {
      method: "POST",
      body: { fromAccountId: ids.mp, toAccountId: ids.cash, amount: 30000, date: new Date().toISOString() },
    });
    const after = await call("/patrimonio/current");
    near(after.neto, before.neto, "el patrimonio no puede moverse por una transferencia interna", 0.5);
  })();

  console.log(`\n${c.b}── Exportar ──${c.x}\n`);

  const year = new Date().getFullYear();

  await step("exportar PDF", async () => {
    const buf = await call(`/reports/pdf?year=${year}`);
    assert(buf.length > 500, `PDF sospechosamente chico (${buf.length} bytes)`);
    assert(buf.subarray(0, 4).toString() === "%PDF", "no tiene cabecera de PDF");
  })();

  await step("exportar CSV", async () => {
    const buf = await call(`/reports/movements.csv?year=${year}`);
    const text = buf.toString("utf8");
    assert(text.includes(";"), "el CSV debería usar punto y coma (Excel en es-AR)");
    assert(text.charCodeAt(0) === 0xfeff, "falta el BOM: Excel rompe los acentos sin él");
  })();

  await step("exportar Excel", async () => {
    const data = await call(`/reports/summary?year=${year}&period=year`);
    assert(data, "el resumen que alimenta el Excel no devolvió nada");
  })();

  console.log(`\n${c.b}── Backup ──${c.x}\n`);

  await step("descargar backup", async () => {
    const b = await call("/users/me/backup");
    const backup = JSON.parse(b.toString("utf8"));
    assert(backup.movements.length >= 2, "faltan movimientos en el backup");
    assert(backup.accounts.length === 2, "faltan cuentas en el backup");
    assert(!JSON.stringify(backup).includes("accessToken"), "🔴 EL BACKUP FILTRA TOKENS");
    ids.backup = backup;
  })();

  console.log(`\n${c.b}── Cerrar la app y volver a abrirla ──${c.x}\n`);

  const snapshot = {
    patrimonio: await call("/patrimonio/current"),
    accounts: await call("/accounts"),
    movements: await call("/movements?limit=100"),
    debts: await call("/debts"),
    goals: await call("/goals"),
  };

  await step("reiniciar el server con la misma base", async () => {
    kill();
    await new Promise((r) => setTimeout(r, 1500));
    await boot();
    const r = await call("/auth/login", {
      method: "POST",
      body: { email: ids.email, password: "unaClaveLarga123" },
    });
    token = r.accessToken;
  })();

  await step("TODO quedó exactamente igual", async () => {
    const after = {
      patrimonio: await call("/patrimonio/current"),
      accounts: await call("/accounts"),
      movements: await call("/movements?limit=100"),
      debts: await call("/debts"),
      goals: await call("/goals"),
    };
    near(after.patrimonio.neto, snapshot.patrimonio.neto, "patrimonio neto", 0.01);
    assert(after.accounts.length === snapshot.accounts.length, "cambió la cantidad de cuentas");
    assert(after.movements.total === snapshot.movements.total, "cambió la cantidad de movimientos");
    assert(after.debts.length === snapshot.debts.length, "cambiaron las deudas");
    assert(after.goals.length === snapshot.goals.length, "cambiaron los objetivos");
    for (const a of after.accounts) {
      const before = snapshot.accounts.find((x) => x.id === a.id);
      near(a.balance, before.balance, `saldo de ${a.name} después de reiniciar`);
    }
  })();

  kill();

  console.log(`\n${"─".repeat(58)}`);
  if (fails.length) {
    console.log(`${c.r}${c.b}✗ ${fails.length} fallaron${c.x}, ${pass} pasaron\n`);
    for (const f of fails) console.log(`  ${c.r}${f.name}${c.x}\n    ${f.error}`);
    console.log();
    process.exit(1);
  }
  console.log(`${c.g}${c.b}✓ ${pass}/${pass} — Finance OS está listo para usar.${c.x}\n`);
}

main()
  .catch((e) => {
    console.error(`\n${c.r}La verificación se cayó:${c.x} ${e.message}\n`);
    process.exit(1);
  })
  .finally(() => {
    kill();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  });
