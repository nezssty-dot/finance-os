// La ÚNICA verificación previa al empaquetado.
//
// Antes esto eran DOS scripts —preflight.mjs y validate-config.mjs— que chequeaban casi
// lo mismo (que existieran build/main.js, build/preload.js, el schema…) y abortaban el
// mismo build en el mismo momento. Dos scripts que fallan juntos son ceremonia, no
// seguridad. Quedó uno.
//
// Corre DESPUÉS de compilar y ANTES de que electron-builder toque un archivo:
//
//   1. Ninguna ruta de electron-builder.yml se escapa de electron/ ni es absoluta.
//   2. Todo lo que la config declara existe de verdad.
//   3. El motor de Prisma en disco es EL QUE PIDIÓ EL TARGET.
//
// El punto 3 es nuevo. Evita el peor bug de todos: `prisma generate` deja el motor de
// otra plataforma, el instalador sale igual, instala perfecto, y no abre. Antes eso
// recién se detectaba en afterPack — después de empaquetar. Ahora, antes.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve, isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ELECTRON = resolve(join(HERE, ".."));
const CONFIG = join(ELECTRON, "electron-builder.yml");

const problems = [];

// ─── 1. Las rutas de electron-builder.yml ───
//
// electron-builder falla con un mensaje que no ayuda:
//     Error: /ruta/BUILD.md must be under /ruta/electron/
// Sale de una función interna del copiador, a mitad del empaquetado, y no dice QUÉ
// opción lo causó. Esto lo convierte en un error de un segundo, con línea y ruta.
//
// LA REGLA: toda ruta relativa, y dentro de electron/. Si hace falta un archivo de
// afuera, se COPIA adentro primero (eso hace prepare.mjs con el backend y el frontend
// compilados). El empaquetado nunca alcanza hacia afuera.

/** YAML mínimo, sin dependencias: un validador que necesita `npm install` para correr
 *  es un validador que alguien saltea justo el día que el install falla. */
function configPaths(yaml) {
  const KEYS = ["app", "output", "buildResources", "from", "to", "afterPack", "afterSign", "beforeBuild", "icon"];
  const found = [];

  yaml.split("\n").forEach((raw, i) => {
    const line = raw.split("#")[0];
    if (!line.trim()) return;

    const kv = line.match(/^\s*-?\s*([a-zA-Z]+):\s*(.+)$/);
    if (kv) {
      const [, key, rawValue] = kv;
      if (!KEYS.includes(key)) return;
      const value = rawValue.trim().replace(/^["']|["']$/g, "");
      if (!value || value === "null" || value.startsWith("${")) return;
      found.push({ line: i + 1, key, value });
      return;
    }

    const item = line.match(/^\s*-\s+(.+)$/);
    if (item) {
      const value = item[1].trim().replace(/^["']|["']$/g, "");
      if (!value || value.startsWith("!") || value.includes(":")) return; // exclusiones no copian
      found.push({ line: i + 1, key: "files", value });
    }
  });

  return found;
}

if (!existsSync(CONFIG)) {
  console.error(`\n✗ No se encontró ${CONFIG}\n`);
  process.exit(1);
}

for (const { line, key, value } of configPaths(readFileSync(CONFIG, "utf8"))) {
  if (key === "to") continue; // destino DENTRO del paquete, no ruta de disco

  if (isAbsolute(value)) {
    problems.push(
      `electron-builder.yml línea ${line} · ${key}: ${value}\n` +
        "    Es una ruta ABSOLUTA. No va a existir en otra máquina, ni en CI."
    );
    continue;
  }

  const literal = value.split(/[*?[]/)[0]; // el glob importa desde dónde ARRANCA
  const abs = resolve(ELECTRON, literal);
  const rel = relative(ELECTRON, abs);

  if (rel.startsWith("..") || (rel && isAbsolute(rel))) {
    problems.push(
      `electron-builder.yml línea ${line} · ${key}: ${value}\n` +
        `    Se ESCAPA de electron/ → apunta a ${abs}\n` +
        "    Esto es lo que produce el error «must be under».\n" +
        "    Si necesitás ese archivo, copialo adentro desde prepare.mjs."
    );
  }
}

// ─── 2. Todo lo que la config declara tiene que existir ───
const REQUIRED = [
  ["build/main.js", "El proceso principal no está compilado."],
  ["build/preload.js", "El preload no está compilado."],
  ["build/renderer/index.html", "El frontend no se copió."],
  ["build/server", "El backend no se copió."],
  ["prisma/schema.prisma", "Falta el schema."],
  ["prisma/schema.sql", "Falta el DDL que crea la base en el primer arranque."],
  ["package.json", ""],
  ["scripts/after-pack.cjs", ""],
  ["assets/icon.icns", "Generá los íconos:  npm run icons"],
  ["assets/icon.ico", "Generá los íconos:  npm run icons"],
];

for (const [rel, hint] of REQUIRED) {
  if (!existsSync(join(ELECTRON, rel)))
    problems.push(`Falta ${rel}${hint ? `\n    → ${hint}` : ""}`);
}

// ─── 3. El motor de Prisma tiene que ser EL DEL TARGET ───
//
// prepare.mjs escribe binaryTargets según la plataforma que se empaqueta. `prisma
// generate` debería bajar ESE motor y ninguno más. Si no coinciden, el instalador sale
// con el motor equivocado: instala perfecto y no abre.
const ENGINE_FOR = {
  windows: "query_engine-windows.dll.node",
  darwin: "libquery_engine-darwin.dylib.node",
  "darwin-arm64": "libquery_engine-darwin-arm64.dylib.node",
};

const schemaPath = join(ELECTRON, "prisma", "schema.prisma");
const engineDir = join(ELECTRON, "node_modules", ".prisma", "client");

if (existsSync(schemaPath)) {
  const declared = readFileSync(schemaPath, "utf8").match(/binaryTargets\s*=\s*\[([^\]]+)\]/)?.[1] ?? "";
  const targets = [...declared.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

  const engines = existsSync(engineDir)
    ? readdirSync(engineDir).filter((f) => f.endsWith(".node"))
    : [];

  if (!engines.length) {
    problems.push(
      "No hay ningún motor de Prisma en node_modules/.prisma/client\n" +
        "    Se empaquetaría sin driver de base de datos: instala y no abre.\n" +
        "    → `prisma generate` no corrió, o falló."
    );
  } else if (engines.length > 1) {
    problems.push(
      `Hay ${engines.length} motores de Prisma. Tiene que haber UNO.\n` +
        `    ${engines.join(", ")}\n` +
        "    → prepare.mjs los purga antes de generar. Si quedaron, borrá\n" +
        "      electron/node_modules/.prisma y volvé a compilar."
    );
  } else {
    // Solo se puede exigir el nombre exacto en un target de empaquetado. En desarrollo
    // binaryTargets es "native" y el nombre depende de la máquina.
    const expected = targets.map((t) => ENGINE_FOR[t]).filter(Boolean);

    if (expected.length && !expected.includes(engines[0])) {
      problems.push(
        "El motor de Prisma no es el del target.\n" +
          `    El schema pide: ${targets.join(", ")}  →  "${expected.join(" o ")}"\n` +
          `    En disco hay:   ${engines[0]}\n` +
          "    Ese instalador instalaría bien y NO abriría."
      );
    }
  }
}

// ─── 4. Las dependencias de electron TIENEN que ser las del server ───
//
// El paquete de Electron lleva el SERVER COMPILADO adentro (build/server/), y ese
// código hace `require("express")`, `require("helmet")`, etc. en tiempo de ejecución.
//
// electron-builder incluye las `dependencies` declaradas en electron/package.json —
// NO las de server/package.json, que ni mira. O sea que las del server están
// duplicadas a mano acá, y pueden separarse sin que nadie se entere.
//
// Ya pasó: express-rate-limit estaba en ^8.5.2 en el server (la versión testeada) y
// en ^7.4.1 en electron (la que se EMPAQUETABA). Dos majors distintas, APIs
// incompatibles: el server tira al importar y Electron abre una ventana en blanco.
//
// Invisible, salvo que compares los dos archivos a mano. Ahora lo compara el build.
const serverPkg = join(ELECTRON, "..", "server", "package.json");

if (existsSync(serverPkg)) {
  const serverDeps = JSON.parse(readFileSync(serverPkg, "utf8")).dependencies ?? {};
  const electronDeps = JSON.parse(readFileSync(join(ELECTRON, "package.json"), "utf8")).dependencies ?? {};

  const missing = [];
  const drifted = [];

  for (const [dep, version] of Object.entries(serverDeps)) {
    if (!electronDeps[dep]) missing.push(`${dep}@${version}`);
    else if (electronDeps[dep] !== version)
      drifted.push(`${dep}  server=${version}  electron=${electronDeps[dep]}`);
  }

  if (missing.length) {
    problems.push(
      "Faltan dependencias del server en electron/package.json:\n" +
        missing.map((m) => `      ${m}`).join("\n") +
        "\n    El server compilado las requiere en runtime. Sin ellas, la app instala\n" +
        "    y muere al abrir con «Cannot find module».\n" +
        "    → Copialas a electron/package.json con la MISMA versión."
    );
  }

  if (drifted.length) {
    problems.push(
      "Las versiones no coinciden entre server y electron:\n" +
        drifted.map((d) => `      ${d}`).join("\n") +
        "\n    Se EMPAQUETARÍA una versión distinta a la que testeaste.\n" +
        "    → Igualalas en electron/package.json."
    );
  }
}

// ─── 5. El lockfile tiene que coincidir con su package.json ───
//
// `npm ci` en el CI ya falla si no coinciden. Pero LOCALMENTE nadie corre `npm ci`:
// se corre `npm install`, que ARREGLA el lockfile en silencio y sigue. Entonces un
// desarrollador puede empaquetar un instalador con versiones que no son las del
// lockfile, y no enterarse nunca.
//
// Así se coló express-rate-limit: el lockfile decía ^7.4.1, el package.json ^8.5.2,
// y node_modules tenía 7.5.1 instalado. El instalador se llevaba una MAJOR distinta
// a la testeada.
for (const proj of ["", "../server", "../client"]) {
  const dir = proj ? join(ELECTRON, proj) : ELECTRON;
  const pkgPath = join(dir, "package.json");
  const lockPath = join(dir, "package-lock.json");
  if (!existsSync(pkgPath) || !existsSync(lockPath)) continue;

  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const root = lock.packages?.[""] ?? {};

  const drift = [];
  for (const kind of ["dependencies", "devDependencies"]) {
    for (const [dep, version] of Object.entries(pkg[kind] ?? {})) {
      const locked = root[kind]?.[dep];
      if (locked !== version) drift.push(`${dep}  package.json=${version}  lock=${locked ?? "AUSENTE"}`);
    }
  }

  if (drift.length) {
    const name = proj ? proj.replace("../", "") : "electron";
    problems.push(
      `El package-lock.json de ${name}/ no coincide con su package.json:\n` +
        drift.map((d) => `      ${d}`).join("\n") +
        "\n    `npm ci` va a fallar en el CI, y localmente se empaquetaría una versión\n" +
        "    distinta a la del lockfile.\n" +
        `    → Corré:  npm --prefix ${name === "electron" ? "electron" : name} install`
    );
  }
}

if (problems.length) {
  console.error("\n✗ Verificación falló — no se va a empaquetar nada:\n");
  problems.forEach((p, i) => console.error(`  ${i + 1}. ${p}\n`));
  process.exit(1);
}

console.log("✓ Verificado — rutas · artefactos · motor · dependencias · lockfiles");
