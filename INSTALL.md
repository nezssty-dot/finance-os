# Instalar Finance OS

## macOS — «La aplicación está dañada y no se puede abrir»

**Tu app no está dañada.** Nunca lo estuvo. macOS miente.

### Qué pasa de verdad

macOS le pone un atributo llamado `com.apple.quarantine` a **todo** lo que descargás de internet. Cuando después intenta abrir una app que no está firmada con un **Developer ID de Apple** y notarizada por Apple, Gatekeeper la bloquea.

El mensaje que muestra —*"is damaged and can't be opened"*— es **engañoso**. No hay ningún daño. El archivo está perfecto. Lo único que falta es una firma que cuesta **US$99 al año**.

### El arreglo (10 segundos)

```bash
xattr -cr "/Applications/Finance OS.app"
```

Eso saca el atributo de cuarentena. Abrís la app y funciona.

Si la instalaste en otro lado, cambiá la ruta.

### Por qué no está firmada

Firmar requiere una cuenta de **Apple Developer Program** (US$99/año). Para uso personal no vale la pena: el comando de arriba resuelve lo mismo, una sola vez.

### Cuando quieras distribuirla a otros

Ahí sí hay que firmar, porque no le vas a pedir a cada usuario que corra comandos en la terminal.

1. Sacar la cuenta de Apple Developer.
2. Generar un certificado **Developer ID Application**.
3. En `electron/electron-builder.yml`, borrar estas dos líneas:
   ```yaml
   identity: null
   notarize: false
   ```
4. Configurar los secrets en GitHub Actions:
   ```
   CSC_LINK                      # el .p12 en base64
   CSC_KEY_PASSWORD              # su contraseña
   APPLE_ID                      # tu Apple ID
   APPLE_APP_SPECIFIC_PASSWORD   # generada en appleid.apple.com
   APPLE_TEAM_ID
   ```

Con eso, el `.dmg` sale firmado y notarizado, y se abre con doble clic como cualquier app.

---

## macOS — ¿cuál bajo, Intel o Apple Silicon?

Hay **dos instaladores**. Bajá el que corresponde a tu Mac:

| Tu Mac | Archivo |
|---|---|
| **Apple Silicon** (M1, M2, M3, M4…) | `Finance OS Apple Silicon.dmg` |
| **Intel** | `Finance OS Intel.dmg` |

**¿No sabés cuál tenés?** Menú Apple → **Acerca de esta Mac**. Ahí dice "Chip: Apple M…" o "Procesador: Intel…".

### Si bajás el equivocado

- **Intel en una Mac Apple Silicon** → funciona. macOS lo traduce con Rosetta. Anda un poco más lento, nada más.
- **Apple Silicon en una Mac Intel** → **no abre**. macOS dice que la app no es compatible con esta Mac. Bajá el de Intel.

### Por qué no hay un solo instalador universal

Lo hubo, y se sacó a propósito.

Un binario universal obliga a `@electron/universal` a **fusionar** dos sub-builds, y esa fusión solo funciona si ambos contienen archivos idénticos. El motor de consultas de Prisma es un binario **nativo por arquitectura**, así que para cumplir esa condición había que meter **los dos motores en los dos sub-builds**: unos 15 MB muertos en cada uno, y un paso de merge más que puede fallar.

Dos instaladores separados son **más chicos, más simples, y no tienen merge que romperse**. Cada uno lleva exactamente su motor:

```
Finance OS Intel.dmg          →  libquery_engine-darwin.dylib.node
Finance OS Apple Silicon.dmg  →  libquery_engine-darwin-arm64.dylib.node
```

El build **verifica esto y falla si no se cumple**: si un `.dmg` sale con el motor de la otra arquitectura —o con los dos— no se genera el instalador. Ese error instala perfecto y después no abre, así que se ataja antes de que salga.

---

## Windows

Doble clic al `.exe`. Es un instalador NSIS.

Windows SmartScreen puede mostrar *"Windows protegió tu PC"* — es el equivalente de Gatekeeper, y pasa por lo mismo (app sin firmar). **Más información → Ejecutar de todas formas.**

Firmar en Windows requiere un certificado de code signing (unos US$200–400/año, según el emisor).

---

## Linux

Fuera de alcance por ahora, por decisión propia. La configuración de AppImage se puede reponer cuando haga falta.

---

## Dónde quedan tus datos

En **tu computadora**, en un SQLite dentro de la carpeta de datos de la aplicación:

- **macOS** — `~/Library/Application Support/Finance OS/`
- **Windows** — `%APPDATA%\Finance OS\`

Nada sale de tu máquina. No hay servidor. Los tokens de Mercado Pago e IOL están cifrados con AES-256-GCM, con una clave que se genera en el primer arranque y vive en `secrets.json` (permisos 600).

Para respaldar todo: **Configuración → Descargar backup.**

---

## ⚠️ Antes de la primera actualización — leer esto

`schema.sql` usa `CREATE TABLE IF NOT EXISTS`. Sobre una base que **ya existe**, ve que las tablas están y **no agrega columnas nuevas**.

Instalación nueva: perfecto. **Pero la primera actualización que cambie el schema deja sin abrir la base de todos los usuarios que ya tengan datos.**

Está documentado en `KNOWN-GAPS.md` §1. **Es lo primero que hay que resolver antes de publicar una segunda versión.**
