// Collects everything the packaged app needs into the electron/ folder:
//   ../server/dist        -> build/server     (compiled API)
//   ../client/dist        -> build/renderer   (built React app)
//   ../server/prisma/*    -> prisma/          (schema + bootstrap DDL)
//
// Written in Node (not `cp -r`) so it behaves identically on Windows, macOS and Linux.
import { existsSync, mkdirSync, rmSync, cpSync, copyFileSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const repo = join(root, "..");

const SERVER_DIST = join(repo, "server", "dist");
const CLIENT_DIST = join(repo, "client", "dist");
const PRISMA_SRC = join(repo, "server", "prisma");

// ─── ESTE SCRIPT NO SE LLAMA A MANO ───
//
// prepare.mjs COPIA server/dist y client/dist adentro de electron/. Si no existen, no
// hay nada que copiar. El mensaje viejo decía "Falta: server/dist → compilá el backend",
// que describe el síntoma pero no el problema: el problema es que este script se estaba
// ejecutando ANTES de tiempo.
//
// Ahora el orden lo garantiza scripts/build.mjs, que compila server y client primero.
// Si igual llegás acá sin ellos, es porque alguien saltó el pipeline.
function need(path, what) {
  if (existsSync(path)) return;

  console.error(`\n✗ Falta ${what}:  ${path}`);
  console.error(`\n  prepare.mjs se ejecutó ANTES de tiempo: falta compilar el ${what.replace(" compilado", "")}.`);
  console.error(`  No lo llames directo: el orden lo maneja el pipeline.\n`);
  console.error(`  Usá uno de estos, y hace todo solo:`);
  console.error(`      npm run dist:win`);
  console.error(`      npm run dist:mac:intel`);
  console.error(`      npm run dist:mac:arm`);
  console.error(`      npm run build:electron     (sin empaquetar)\n`);
  process.exit(1);
}

need(SERVER_DIST, "backend compilado");
need(CLIENT_DIST, "frontend compilado");

// Compiled API
const serverOut = join(root, "build", "server");
rmSync(serverOut, { recursive: true, force: true });
mkdirSync(serverOut, { recursive: true });
cpSync(SERVER_DIST, serverOut, { recursive: true });

// Built React app
const rendererOut = join(root, "build", "renderer");
rmSync(rendererOut, { recursive: true, force: true });
mkdirSync(rendererOut, { recursive: true });
cpSync(CLIENT_DIST, rendererOut, { recursive: true });

// Prisma schema (para `prisma generate`) + DDL (se ejecuta en el primer arranque)
//
// ─── UN MOTOR POR BUILD. NI UNO MÁS. ───
//
// El motor de consultas de Prisma es un binario NATIVO: distinto por sistema y por
// arquitectura. Cada build se lleva exactamente el suyo:
//
//   --target=mac-intel  → libquery_engine-darwin.dylib.node
//   --target=mac-arm    → libquery_engine-darwin-arm64.dylib.node
//   --target=win        → query_engine-windows.dll.node
//   (sin target)        → el nativo de esta máquina, para desarrollo
//
// Ya NO se construye un binario universal. Son dos .dmg independientes, y cada uno
// lleva solo el motor que le corresponde.
//
// El CÓDIGO no cambia entre plataformas. Cambia lo que se baja, y lo decide esto.
const TARGETS = {
  "mac-intel": '["darwin"]',
  "mac-arm": '["darwin-arm64"]',
  win: '["windows"]',
  linux: '["native"]',
};

// Por ARGUMENTO, no por variable de entorno: `FOS_TARGET=x npm run ...` es sintaxis
// de shell Unix y en cmd.exe de Windows no existe. Un argumento anda en los cuatro shells.
const arg = process.argv.find((a) => a.startsWith("--target="));
const platform = arg ? arg.split("=")[1] : "native";

if (arg && !TARGETS[platform]) {
  console.error(`\n✗ Target desconocido: "${platform}"`);
  console.error(`  Válidos: ${Object.keys(TARGETS).join(", ")}\n`);
  process.exit(1);
}

const binaryTargets = TARGETS[platform] ?? '["native"]';

// ─── PURGA LOS MOTORES VIEJOS ───
//
// `prisma generate` AGREGA los motores de binaryTargets, pero NO borra los que ya
// estaban. Si compilás Intel y después Apple Silicon, el paquete de ARM se lleva LOS
// DOS: uno inútil, ~15 MB muertos, y —peor— el chequeo de plataforma podría dar verde
// con el motor equivocado adentro.
//
// Borrar antes de generar es la única forma de garantizar que quede exactamente uno.
const engineDir = join(root, "node_modules", ".prisma", "client");
let purged = 0;
if (existsSync(engineDir)) {
  for (const f of readdirSync(engineDir)) {
    if (f.endsWith(".node")) {
      rmSync(join(engineDir, f), { force: true });
      purged++;
    }
  }
}

const prismaOut = join(root, "prisma");
mkdirSync(prismaOut, { recursive: true });

const schema = readFileSync(join(PRISMA_SRC, "schema.prisma"), "utf8").replace(
  /generator client \{/,
  `generator client {\n  binaryTargets = ${binaryTargets}`
);
writeFileSync(join(prismaOut, "schema.prisma"), schema);
copyFileSync(join(PRISMA_SRC, "schema.sql"), join(prismaOut, "schema.sql"));

console.log("✓ build/server    (API compilada)");
console.log("✓ build/renderer  (React compilado)");
if (purged) console.log(`✓ motores viejos  (${purged} borrado${purged > 1 ? "s" : ""})`);
console.log(`✓ prisma/         binaryTargets=${binaryTargets}  ("${platform}")`);
