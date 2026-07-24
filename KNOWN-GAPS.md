# Lo que todavía no está resuelto

Esto no es una lista de deseos. Son cosas **rotas o sin verificar** que hay que saber antes de usar Finance OS con plata real.

Está acá porque los informes de sprint se borraron —describían un empaquetado que ya no existe— pero **estos problemas siguen siendo reales**.

---

## ✅ 1. La primera actualización rompe la base de datos de todos — RESUELTO

**Era el más grave.** Ya no lo es.

`prisma/schema.sql` usa `CREATE TABLE IF NOT EXISTS`. Sobre una base que **ya existe**, ve que las tablas están y **no agrega columnas nuevas** — así que cualquier cambio de schema dejaba a los usuarios existentes con la app sin abrir.

**Cómo se resolvió:** `electron/src/migrations.ts`. Un sistema de migraciones incrementales versionado con `PRAGMA user_version` (el entero que SQLite guarda en el header de cada archivo de base; no hace falta ninguna tabla extra). En cada arranque se aplican, en orden y dentro de una transacción, todas las migraciones cuya versión sea mayor a la de la base.

- Las bases **viejas** (user_version = 0, tablas ya creadas) se adoptan como v1 sin perder un dato.
- Una migración que falla **revierte entera**: no existe el estado "a medio migrar".
- 7 tests contra SQLite real (`electron/tests/migrations.test.ts`), incluido el caso "base vieja con datos adentro".

**El contrato, que no se negocia:** si tocás `server/prisma/schema.prisma`, **agregá una migración** en `MIGRATIONS` con la versión siguiente. Si no, anda en desarrollo (`prisma db push` sincroniza solo) y rompe en la app instalada de todos. Una migración ya publicada nunca se edita: se agrega otra.

**Igual, antes de instalar una versión nueva: hacé backup** (Configuración → Descargar backup). Cuesta 5 segundos.

---

## 🔴 2. "Recuperar contraseña" no manda ningún mail

El endpoint existe, genera el token y lo guarda. **Pero no hay proveedor de email configurado**, así que el token no llega a ningún lado.

En una app de escritorio de un solo usuario esto es casi irrelevante (la base es local). Pasa a ser bloqueante el día que Finance OS sea SaaS.

**Lo que hace falta:** Resend, SendGrid o SMTP, y un `EMAIL_FROM`.

---

## ⚠️ 3. Mercado Pago: dos campos sin verificar contra una cuenta real

Verifiqué la mayoría de los campos contra la documentación oficial de la API. Estos dos **no**:

**`fee_details[]`** — la forma `[{amount, fee_payer}]` es la que usa todo el ecosistema, pero **no aparece en la respuesta de ejemplo oficial**. Si viniera distinta, las **comisiones simplemente no se importan**: nada se rompe, y el payload crudo queda guardado para re-mapear.

**Rendimientos** (`operation_type: "investment"`) — es una **suposición**. Es muy probable que los rendimientos de Mercado Pago **no salgan por `/v1/payments/search`** en absoluto. Está aislado en `isYield()` para que corregirlo sea una línea.

**Cómo se verifica:** una sincronización real contra tu cuenta, y comparar contra lo que ves en la app de Mercado Pago.

**Límite duro de la API (esto sí está confirmado):** `/v1/payments/search` **solo devuelve los últimos 12 meses**. No es una decisión nuestra. La UI lo dice.

---

## ⚠️ 4. IOL hay que habilitarlo a mano

La API de Invertir Online **no está activa por defecto**. Hay que pedirla desde el sitio de IOL y aceptar los términos en **Mi Cuenta → Personalización → APIs**.

Sin eso, `/token` responde error y no hay forma de saltearlo desde el código.

**Y algo que hay que entender antes de conectar:** IOL **no tiene OAuth**. Usa usuario y contraseña. Finance OS la pide una sola vez, la cambia por tokens, y **no la guarda**. Pero el token que devuelve IOL **puede operar** (comprar y vender). Finance OS es de solo lectura y nunca va a operar — pero el permiso que estás dando es amplio.

---

## ⚠️ 5. Los arreglos de Windows y macOS no están probados en hardware real

Los encontré leyendo el código fuente de electron-builder y razonando sobre el comportamiento de `cmd.exe`. **Alta confianza, pero son hipótesis hasta que corra el CI.**

- **Windows**: `process.execPath` es `C:\Program Files\nodejs\node.exe` — con un espacio. Con `shell: true`, `cmd.exe` parte en el espacio y falla con `'C:\Program' is not recognized`.
- **macOS "dañado"**: electron-builder con `identity: null` **no firma nada**, pero igual rompe la firma que Electron trae de fábrica. Firma rota ≠ sin firmar. El `afterPack` ahora firma ad-hoc.

**Si el CI falla, hace falta el log crudo.** No el resumen.

---

## ⚠️ 6. La cuarentena de macOS no se puede evitar sin pagar

Aunque la firma ad-hoc quede válida, **macOS marca con cuarentena todo lo que se descarga de internet**. Va a seguir diciendo que la app no se puede abrir.

Eso **no es un bug**: es política de Apple. Se saca de dos maneras:

```bash
xattr -cr "/Applications/Finance OS.app"
```

o **notarizando** (cuenta de Apple Developer, US$99/año). No hay tercera opción.

Diagnóstico: `bash diagnose-macos.sh <ruta al .dmg>` distingue si la app está **rota** (culpa nuestra) o solo **bloqueada** (Gatekeeper).

---

## ⚠️ 7. GitHub está deprecando los runners Intel de macOS

El build de macOS Intel usa `macos-13`, que es el **último runner Intel** que queda. Cuando GitHub lo saque, ese build se cae.

**Alternativas cuando pase:** compilar Intel en un runner Apple Silicon usando `--x64` (el `.app` se genera igual, pero **el `afterPack` no va a poder ejecutarlo** para verificar que Prisma carga, salvo que el runner tenga Rosetta).
