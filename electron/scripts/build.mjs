// EL pipeline de compilación. El único. Para las tres plataformas.
//
// ─── POR QUÉ EXISTE ESTE ARCHIVO ───
//
// Antes el orden vivía repartido en cadenas de `&&` dentro de package.json, y había
// DOS puertas de entrada que hacían cosas distintas:
//
//   raíz/dist:win      → npm run build && npm --prefix electron run dist:win   ✅
//   electron/dist:win  → prepare.mjs && ...                                    ❌
//
// La segunda saltaba la compilación del backend y el frontend. Andaba si entrabas por
// la raíz, y explotaba si entrabas por electron — que es exactamente lo que hacía el
// CI. Resultado:
//
//     ✗ Falta: server/dist
//
// El orden de un build no puede ser una CONVENCIÓN que hay que recordar en cinco
// scripts distintos. Tiene que ser una ESTRUCTURA. Está acá, una sola vez, y no hay
// forma de invocarlo mal.
//
// ─── EL ORDEN ───
//
//   1. server build      → server/dist
//   2. client build      → client/dist
//   3. prepare.mjs       → copia los dos anteriores a electron/build/ y fija el
//                          binaryTarget de Prisma según la plataforma
//   4. prisma generate   → baja el motor nativo que corresponde
//   5. tsc               → compila el main y el preload
//   6. validate          → ¿las rutas de electron-builder.yml están adentro?
//                          ¿existe todo lo que declara?
//                          ¿el motor de Prisma es el del target?
//                          (esto absorbió al viejo preflight: chequeaban lo mismo)
//
// Después de esto, electron-builder solo empaqueta. No compila nada.
//
// Uso:
//   node scripts/build.mjs --target=win
//   node scripts/build.mjs --target=mac-intel
//   node scripts/build.mjs --target=mac-arm
//   node scripts/build.mjs                    (dev: motor nativo de esta máquina)

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ELECTRON = join(HERE, "..");
const REPO = join(ELECTRON, "..");
const SERVER = join(REPO, "server");
const CLIENT = join(REPO, "client");

// ─── LANZAR PROCESOS EN WINDOWS: HAY DOS CASOS Y NO SON IGUALES ───
//
// npm en Windows es `npm.cmd`, un archivo por lotes. Desde Node 18.20, spawn necesita
// `shell: true` para ejecutar un .cmd.
//
// PERO `shell: true` manda el comando por cmd.exe, que PARTE EN LOS ESPACIOS. Y
// process.execPath en Windows es:
//
//     C:\Program Files\nodejs\node.exe          ← tiene un espacio
//
// cmd.exe lo corta en "C:\Program" y falla:
//
//     'C:\Program' is not recognized as an internal or external command
//
// Ese era el error del build de Windows. Un .exe REAL no necesita shell — se ejecuta
// directo. Por eso hay dos funciones y no una.
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const NPM_NEEDS_SHELL = process.platform === "win32";

const VALID = ["win", "mac-intel", "mac-arm"];

const arg = process.argv.find((a) => a.startsWith("--target="));
const target = arg ? arg.split("=")[1] : null;

if (arg && !VALID.includes(target)) {
  console.error(`\n✗ Target desconocido: "${target}"`);
  console.error(`  Válidos: ${VALID.join(", ")}  (o sin --target para desarrollo)\n`);
  process.exit(1);
}

/** Corre un comando y aborta TODO el build si falla. Nada de seguir "por las dudas". */
function spawn(label, cmd, args, cwd, useShell) {
  process.stdout.write(`\n▸ ${label}\n`);

  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: useShell });

  if (r.error) {
    console.error(`\n✗ No se pudo ejecutar ${cmd}\n  ${r.error.message}\n`);
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(`\n✗ Falló: ${label}\n`);
    process.exit(r.status ?? 1);
  }
}

/** npm.cmd necesita shell en Windows. Sus argumentos nunca tienen espacios. */
const npm = (label, args, cwd) => spawn(label, NPM, args, cwd, NPM_NEEDS_SHELL);

/** node.exe es un binario real: se ejecuta DIRECTO, sin shell.
 *  Con shell, cmd.exe partiría "C:\Program Files\nodejs\node.exe" en el espacio. */
const node = (label, args, cwd) => spawn(label, process.execPath, args, cwd, false);

// Sin node_modules no hay nada que hacer, y el error de npm sería críptico.
for (const [name, dir] of [["server", SERVER], ["client", CLIENT], ["electron", ELECTRON]]) {
  if (!existsSync(join(dir, "node_modules"))) {
    console.error(`\n✗ Falta ${name}/node_modules\n  → Corré:  npm run install:all\n`);
    process.exit(1);
  }
}

const label = target ?? "desarrollo (motor nativo)";
console.log(`\n╔══════════════════════════════════════════════╗`);
console.log(`║  Finance OS — build: ${label.padEnd(23)}║`);
console.log(`╚══════════════════════════════════════════════╝`);

// ─── 1 y 2. Backend y frontend. ANTES de prepare.mjs, siempre. ───
//
// Este es el punto entero de este archivo. prepare.mjs COPIA server/dist y client/dist
// adentro de electron/. Si no existen todavía, se muere — y el mensaje ("Falta:
// server/dist") no dice qué hacer, porque el problema no es prepare.mjs: es el orden.
npm("Backend  (server → dist)", ["run", "build"], SERVER);
npm("Frontend (client → dist)", ["run", "build"], CLIENT);

// ─── 3. Recursos + binaryTarget de Prisma ───
node(
  "Recursos (dist → electron/build)",
  ["scripts/prepare.mjs", ...(target ? [`--target=${target}`] : [])],
  ELECTRON
);

// ─── 4 a 7. Prisma, TypeScript, y las dos verificaciones ───
//
// Se llaman por npm a propósito: así cada paso queda DEFINIDO UNA SOLA VEZ, en
// electron/package.json. Este archivo decide el ORDEN, no cómo se hace cada cosa.
npm("Prisma   (motor del target)", ["run", "prisma:generate"], ELECTRON);
npm("TypeScript (main + preload)", ["run", "compile"], ELECTRON);
npm("Verificación (rutas · artefactos · motor)", ["run", "validate"], ELECTRON);

console.log(`\n✓ Listo para empaquetar${target ? ` (${target})` : ""}\n`);
