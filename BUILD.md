# Compilar Finance OS

## Un solo comando

```bash
npm run dist:win         # → Finance OS Setup.exe
npm run dist:mac:intel   # → Finance OS Intel.dmg
npm run dist:mac:arm     # → Finance OS Apple Silicon.dmg
```

Nada más. No hay que compilar nada antes, ni copiar archivos, ni correr `prisma generate` a mano.

**Las apps de macOS se compilan EN macOS.** No es una limitación nuestra: sin `codesign` el `.app` queda con la firma rota (macOS dice *"está dañado"*), y el `.dmg` necesita `hdiutil`. El CI usa `macos-13` (Intel) y `macos-14` (Apple Silicon).

---

## El pipeline

Todo el orden vive en **`electron/scripts/build.mjs`**. Un solo archivo. No es una convención que hay que recordar en cinco scripts: es una estructura, y no hay forma de invocarla mal.

```
▸ Backend  (server → dist)
▸ Frontend (client → dist)
▸ Recursos (dist → electron/build, y fija el binaryTarget de Prisma)
▸ Prisma   (baja el motor del target, y SOLO ese)
▸ TypeScript (main + preload)
▸ Verificación (rutas · artefactos · motor · dependencias)
✓ Listo para empaquetar
```

Después de eso, `electron-builder` **solo empaqueta**. No compila nada.

**Cada paso verifica al anterior.** Si `server/dist` no existe, `prepare.mjs` corta y te dice qué comando usar. Si el motor de Prisma no es el del target, `validate` corta antes de gastar minutos empaquetando.

---

## Por qué el motor de Prisma es el problema difícil

El motor de consultas de Prisma es un **binario nativo**: distinto por sistema y por arquitectura.

```
Windows          query_engine-windows.dll.node
macOS Intel      libquery_engine-darwin.dylib.node
macOS ARM        libquery_engine-darwin-arm64.dylib.node
```

`prepare.mjs` reescribe `binaryTargets` en el schema según el target, **y borra los motores viejos antes de generar** — porque `prisma generate` los AGREGA, no los reemplaza. Sin esa purga, compilar Intel y después ARM deja los dos motores adentro del segundo paquete.

Y hay algo que no es obvio: **`@prisma/client` no sirve para nada sin `.prisma/client` al lado.** Su `default.js` hace, literalmente:

```js
module.exports = { ...require('.prisma/client/default') }
```

Por eso la app se empaqueta **sin asar** (`asar: false`). Con asar, `.prisma` se copiaba a `app.asar.unpacked/` — el archivo llegaba al disco correcto y **aun así fallaba**, porque el shim de Electron solo redirige `app.asar/X → app.asar.unpacked/X` si X está registrado en la **cabecera del asar**. Un archivo que nunca entró al asar no tiene registro:

```
Cannot find module '.prisma/client/default'
```

Sin asar, `.prisma` es un directorio real y Node lo resuelve caminando `node_modules` hacia arriba. Sin shim, sin cabecera, sin magia.

---

## Por qué macOS decía "la aplicación está dañada"

**No era Gatekeeper.** Era la firma.

Electron viene **firmado de fábrica** (Apple lo exige para arm64). electron-builder le mete `Contents/Resources/app/` adentro y **rompe esa firma**. Y con `identity: null`, **no la rehace**:

```js
// app-builder-lib/out/macPackager.js
if (qualifier === null) {
  log.info({ reason: "identity explicitly is set to null" }, "skipped macOS code signing");
  return false;   // NO FIRMA NADA
}
```

Una firma **rota** no es lo mismo que **sin firmar**:

| | Mensaje de macOS | Clic derecho → Abrir |
|---|---|---|
| Sin firmar + cuarentena | "desarrollador no identificado" | ✅ funciona |
| **Firma rota** | **"está dañado y no se puede abrir"** | ❌ no funciona |

En Apple Silicon el kernel directamente la mata.

El `afterPack` ahora **firma ad-hoc** (`codesign --sign -`). Es gratis, no necesita cuenta de Apple, y verifica la firma después. Solo corre cuando `identity: null` — si algún día hay un Developer ID real, electron-builder firma él y nosotros no tocamos nada.

**La cuarentena es otro problema, y no se puede evitar.** macOS marca todo lo descargado. Sin notarizar (US$99/año) hay que correr:

```bash
xattr -cr "/Applications/Finance OS.app"
```

Está en `INSTALL.md`.

---

## Las verificaciones

Ningún build entrega un instalador roto. Estas tres corren solas:

**`validate-config.mjs`** (antes de empaquetar)
- Ninguna ruta de `electron-builder.yml` se escapa de `electron/` ni es absoluta
- Todo lo que la config declara existe
- El motor de Prisma es **el del target**, y hay **uno solo**
- Las dependencias de `electron/package.json` **coinciden con las del server**

Eso último ya atajó un bug real: `express-rate-limit` estaba en `^8.5.2` en el server (la versión testeada) y en `^7.4.1` en electron (la que se **empaquetaba**). Dos majors, APIs incompatibles.

**`after-pack.cjs`** (después de empacar, antes del instalador)
- Levanta el binario de Electron recién empaquetado y **le hace cargar Prisma de verdad**
- El motor coincide con la plataforma **y la arquitectura**
- Firma ad-hoc + verificación de la firma

Que los archivos existan **no significa** que Node los resuelva. Ese fue exactamente el bug de `Cannot find module '.prisma/client/default'`: todos los chequeos de archivos daban verde.

**El CI** (`.github/workflows/`)
- `verify.yml` — typecheck, lint, tests (reutilizable, definido una vez)
- `build-windows.yml`, `build-macos-intel.yml`, `build-macos-arm.yml` — independientes
- Cada uno verifica firma, arquitectura, motor, que Prisma cargue, **y monta el DMG de verdad**

---

## Firmar de verdad (cuando haga falta)

1. Sacar la cuenta de Apple Developer (US$99/año)
2. Generar un certificado **Developer ID Application**
3. En `electron/electron-builder.yml`, borrar `identity: null` y `notarize: false`
4. Poner `hardenedRuntime: true` (lo exige la notarización)
5. Secrets en GitHub Actions:
   ```
   CSC_LINK                      # el .p12 en base64
   CSC_KEY_PASSWORD
   APPLE_ID
   APPLE_APP_SPECIFIC_PASSWORD   # de appleid.apple.com
   APPLE_TEAM_ID
   ```

El `afterPack` detecta que hay identidad y **no firma ad-hoc**: deja que electron-builder firme y notarice.

---

## Desarrollo

```bash
npm run install:all
npm run db:setup
npm run dev:api       # API en :4000
npm run dev:web       # Vite en :5173
npm run dev:desktop   # Electron
```
