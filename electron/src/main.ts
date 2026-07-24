import { app, BrowserWindow, shell, dialog, Menu } from "electron";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import type { AddressInfo } from "net";
import { migrate } from "./migrations";

const isDev = !app.isPackaged;

// In dev the renderer is Vite on :5173, whose proxy forwards /api to :4000,
// so the API must listen on exactly 4000. When packaged, the renderer is served
// by our own Express instance, so we take any free port (0) and load that origin.
const DEV_API_PORT = 4000;
const VITE_URL = process.env.FOS_DEV_SERVER ?? "http://localhost:5173";

let mainWindow: BrowserWindow | null = null;
let appOrigin = "";

/* ─────────────────── Server boundary ───────────────────
 * The API is a separate TypeScript project: it is compiled to server/dist and
 * copied into build/server by scripts/prepare.mjs. It is loaded with require()
 * instead of a static import so the two builds stay decoupled — only these two
 * narrow contracts cross the boundary.
 */
// $queryRawUnsafe hace falta para leer `PRAGMA user_version`: $executeRawUnsafe
// devuelve el número de filas afectadas, no el resultado. Ver migrations.ts.
type PrismaLike = {
  $executeRawUnsafe(sql: string): Promise<unknown>;
  $queryRawUnsafe<T = unknown>(sql: string): Promise<T>;
};
type ExpressLike = {
  listen(port: number, host: string, cb: () => void): import("http").Server;
};
type ServerModule = { createApp(options?: { staticDir?: string }): ExpressLike };

function loadFromServer<T>(...segments: string[]): T {
  // Deliberado: el server se compila por separado y se carga en runtime desde los
  // recursos empaquetados. Un import estático no puede resolver esa ruta, que solo
  // existe después de que electron-builder arma el bundle. El main de Electron corre
  // como CommonJS, así que require() acá es el mecanismo correcto, no un atajo.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(path.join(__dirname, "server", ...segments)) as T;
}

/* ─────────────────── Paths ─────────────────── */

// User data lives outside the app bundle so it survives updates and reinstalls:
//   macOS   ~/Library/Application Support/Finance OS/
//   Windows %APPDATA%\Finance OS\
//   Linux   ~/.config/Finance OS/
const userData = app.getPath("userData");
const dbPath = path.join(userData, "finance-os.db");

/**
 * La raíz de la app, en cualquier modo.
 *
 * Se deriva de __dirname a propósito, y NO de app.isPackaged + process.resourcesPath.
 *
 * La versión anterior hacía:
 *     app.isPackaged ? path.join(process.resourcesPath, "app.asar") : ...
 *
 * Eso codificaba el layout del empaquetado en el código. Cuando el empaquetado dejó
 * de usar asar, la ruta pasó a apuntar a resources/app.asar — un directorio que ya no
 * existe — y la app no habría encontrado ni schema.sql ni el HTML del renderer.
 *
 * __dirname siempre es <raíz>/build, esté donde esté:
 *   · desarrollo          → electron/build            → ".." = electron/
 *   · empaquetada         → resources/app/build       → ".." = resources/app/
 *   · empaquetada c/ asar → resources/app.asar/build  → ".." = resources/app.asar/
 *
 * Una sola expresión, correcta en los tres casos. Sin condicionales que se pudren
 * cuando cambia el empaquetado.
 */
const appRoot = path.join(__dirname, "..");

/* ─────────────────── Secrets ───────────────────
 * These MUST stay stable across launches. Mercado Pago tokens are encrypted at
 * rest with a key derived from ENCRYPTION_KEY: if it were regenerated on every
 * boot, every stored token would become permanently undecryptable and the user
 * would silently lose the integration.
 */
function loadOrCreateSecrets(): Record<string, string> {
  const file = path.join(userData, "secrets.json");
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      /* corrupt file → regenerate below */
    }
  }
  const gen = () => crypto.randomBytes(32).toString("hex");
  const secrets = {
    JWT_ACCESS_SECRET: gen(),
    JWT_REFRESH_SECRET: gen(),
    JWT_STATE_SECRET: gen(),
    ENCRYPTION_KEY: gen(),
  };
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  return secrets;
}

/* ─────────────────── Prisma engine ─────────────────── */

// Find the query engine binary that `prisma generate` produced, and give Prisma
// its absolute path.
//
// The engine is compiled per OS *and* per CPU architecture. If more than one is
// present (e.g. a build machine that generated several targets), picking the
// wrong one makes the app fail to start with an opaque error — so match the
// running platform explicitly rather than grabbing whatever comes first.
/**
 * Dónde vive el motor nativo de Prisma.
 *
 * ─── LO QUE ESTABA MAL ───
 *
 * La versión anterior asumía app.asar.unpacked. Y el problema de fondo era peor que
 * una ruta: @prisma/client hace, literalmente,
 *
 *     module.exports = { ...require('.prisma/client/default') }
 *
 * Copiar .prisma con `extraResources` lo dejaba en el disco correcto, pero NUNCA
 * entraba al asar — y el shim de Electron solo redirige app.asar/X → app.asar.unpacked/X
 * si X figura en la CABECERA del asar. Sin registro, Node no lo encuentra:
 *
 *     Cannot find module '.prisma/client/default'
 *
 * Ahora la app se empaqueta SIN asar (asar: false), así que .prisma es un directorio
 * real dentro de node_modules y Node lo resuelve caminando hacia arriba, como siempre.
 * Sin shim, sin cabecera, sin magia.
 *
 * ─── QUÉ HACE ESTA FUNCIÓN ───
 *
 * Encuentra el .node correcto para ESTA plataforma y ESTA arquitectura, en cualquiera
 * de los tres modos en los que la app puede estar corriendo:
 *
 *   · desarrollo  → electron/node_modules/.prisma/client
 *   · empaquetada sin asar → resources/app/node_modules/.prisma/client
 *   · empaquetada con asar (por si vuelve) → resources/app.asar.unpacked/...
 *
 * Devuelve null si no lo encuentra. Deliberadamente: apuntar
 * PRISMA_QUERY_ENGINE_LIBRARY a un archivo que no existe es PEOR que no setearla —
 * si no la seteamos, Prisma lo busca solo y su mensaje de error es mucho mejor que
 * cualquier cosa que podamos inventar nosotros.
 */
function resolvePrismaEngine(): string | null {
  // El motor se compila por sistema Y por arquitectura. Si hay varios (un build
  // universal de macOS lleva los dos), agarrar el primero que aparezca hace que la
  // app no abra con un error incomprensible. Se matchea explícito.
  const wanted: string[] =
    process.platform === "win32"
      ? ["query_engine-windows"]
      : process.platform === "darwin"
        ? process.arch === "arm64"
          ? ["libquery_engine-darwin-arm64"]
          : ["libquery_engine-darwin."] // el punto final evita matchear darwin-arm64
        : ["libquery_engine-debian", "libquery_engine-linux", "libquery_engine-rhel"];

  // De más específico a menos. El primero que exista, gana.
  const candidates = [
    // Empaquetada, sin asar (el modo actual).
    path.join(process.resourcesPath ?? "", "app", "node_modules", ".prisma", "client"),
    // Empaquetada, con asar desempaquetado (si algún día vuelve el asar).
    path.join(process.resourcesPath ?? "", "app.asar.unpacked", "node_modules", ".prisma", "client"),
    // Desarrollo: node_modules al lado del código.
    path.join(__dirname, "..", "node_modules", ".prisma", "client"),
    path.join(__dirname, "..", "..", "node_modules", ".prisma", "client"),
  ].filter((d) => d && !d.startsWith(path.sep + "app")); // descarta rutas vacías

  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;

    const engines = fs.readdirSync(dir).filter((f) => f.endsWith(".node"));
    if (!engines.length) continue;

    const match = engines.find((f) => wanted.some((w) => f.startsWith(w)));
    if (match) {
      const full = path.join(dir, match);
      // Un archivo de 0 bytes es un motor roto, y falla mucho más tarde y mucho peor.
      if (fs.statSync(full).size > 0) return full;
    }
  }

  return null;
}

/* ─────────────────── Database bootstrap ─────────────────── */

// Lleva la base al día: crea las tablas la primera vez, y aplica las migraciones
// incrementales en cada actualización. Ver electron/src/migrations.ts — ahí está
// explicado por qué `prisma migrate deploy` no se puede usar en la app empaquetada,
// y por qué `CREATE TABLE IF NOT EXISTS` solo no alcanza.
async function initDatabase(prisma: PrismaLike) {
  // SQLite treats a zero-length file as a valid empty database.
  if (!fs.existsSync(dbPath)) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.closeSync(fs.openSync(dbPath, "w"));
  }

  const sqlPath = [
    path.join(appRoot, "prisma", "schema.sql"),
    path.join(__dirname, "..", "prisma", "schema.sql"),
  ].find((p) => fs.existsSync(p));

  if (!sqlPath) throw new Error("No se encontró prisma/schema.sql en el paquete.");

  const baselineSql = fs.readFileSync(sqlPath, "utf8");
  const applied = await migrate(prisma, baselineSql, {
    log: (msg) => console.log(`[db] ${msg}`),
  });

  if (applied.length) {
    console.log(`[db] Base actualizada a v${applied[applied.length - 1]}.`);
  }
}

/* ─────────────────── Server ─────────────────── */

async function startServer(): Promise<string> {
  Object.assign(process.env, loadOrCreateSecrets());

  process.env.DATABASE_URL = `file:${dbPath}`;
  // The desktop app is served over plain http://127.0.0.1, where the browser
  // refuses to send `secure` cookies — so the refresh cookie must not be one.
  process.env.COOKIE_SECURE = "false";

  const engine = resolvePrismaEngine();
  if (engine) process.env.PRISMA_QUERY_ENGINE_LIBRARY = engine;

  // Loaded only AFTER the env vars above are set: PrismaClient reads
  // DATABASE_URL when constructed, and config.ts reads the secrets on import.
  const { prisma } = loadFromServer<{ prisma: PrismaLike }>("lib", "prisma");
  await initDatabase(prisma);

  const { createApp } = loadFromServer<ServerModule>("app");
  const rendererDir = path.join(__dirname, "renderer");
  const expressApp = createApp(
    isDev || !fs.existsSync(rendererDir) ? {} : { staticDir: rendererDir }
  );

  return new Promise((resolve, reject) => {
    const server = expressApp.listen(isDev ? DEV_API_PORT : 0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const origin = `http://127.0.0.1:${port}`;
      process.env.WEB_ORIGIN = isDev ? VITE_URL : origin;
      console.log(`Finance OS API → ${origin}`);
      resolve(origin);
    });
    server.on("error", reject);
  });
}

/* ─────────────────── Window ─────────────────── */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 940,
    minHeight: 640,
    title: "Finance OS",
    backgroundColor: "#08080a",
    // Inset traffic lights feel native on macOS; other platforms keep standard chrome.
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    // Con `hiddenInset` no hay barra de título: los botones de cerrar/minimizar/maximizar
    // flotan SOBRE el contenido, arriba a la izquierda — justo encima del logo del
    // sidebar. Fijar la posición acá los vuelve predecibles, y el sidebar reserva
    // exactamente esa franja (ver client/src/lib/platform.ts → MAC_INSET).
    //
    // Sin esto, la posición depende de la versión de macOS y el solapamiento vuelve
    // en cuanto Apple mueve los botones un par de píxeles.
    ...(process.platform === "darwin"
      ? { trafficLightPosition: { x: 16, y: 18 } }
      : {}),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(isDev ? VITE_URL : appOrigin);
  mainWindow.once("ready-to-show", () => mainWindow?.show());

  // The Mercado Pago consent screen must open in the real browser, never inside
  // the app: people should only type their MP password on a page whose URL bar
  // they can actually inspect.
  const isExternal = (url: string) =>
    /^https?:\/\//.test(url) && !url.startsWith(appOrigin) && !url.startsWith(VITE_URL);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternal(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isExternal(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/* ─────────────────── Lifecycle ─────────────────── */

app.on("ready", async () => {
  Menu.setApplicationMenu(
    process.platform === "darwin"
      ? Menu.buildFromTemplate([
          { role: "appMenu" },
          { role: "editMenu" },
          { role: "viewMenu" },
          { role: "windowMenu" },
        ])
      : null
  );

  try {
    appOrigin = await startServer();
    createWindow();
  } catch (err) {
    console.error(err);
    dialog.showErrorBox(
      "Finance OS no pudo iniciar",
      `${(err as Error).message}\n\nTus datos siguen a salvo en:\n${dbPath}`
    );
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (!mainWindow) createWindow();
});
