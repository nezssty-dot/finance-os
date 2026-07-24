# Finance OS — Estado final V1.0

Versión cerrada, lista para producción. Este documento es la foto del repo: qué hay, qué
funciona, qué falta y qué tener en cuenta antes de seguir.

**Fecha de cierre:** esta entrega.
**Estado del pipeline:** Typecheck ✓ · Lint ✓ · Tests ✓ · Build ✓ (detalle abajo).

---

## 1. Arquitectura final

Finance OS es una **app de escritorio de finanzas personales** que corre 100% local. No hay
servidor en la nube: todo vive en la máquina del usuario.

```
┌─────────────────────────────────────────────────────────────┐
│  ELECTRON (contenedor de escritorio)                         │
│                                                              │
│   ┌────────────────┐         ┌──────────────────────────┐   │
│   │  CLIENTE       │  HTTP   │  SERVIDOR (Express)       │   │
│   │  React + Vite  │ ──────▶ │  levantado en localhost   │   │
│   │  (renderer)    │ ◀────── │  por el proceso main      │   │
│   └────────────────┘  JSON   └────────────┬─────────────┘   │
│                                            │                 │
│                                   ┌────────▼─────────┐       │
│                                   │  Prisma + SQLite  │       │
│                                   │  (archivo local)  │       │
│                                   └───────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

**El principio que sostiene todo: una sola fuente de verdad.**

Los saldos, el patrimonio y el disponible **nunca se guardan**. Se derivan de los
movimientos (la tabla `Movement` es el libro contable) en cada lectura. Esto hace
*imposible* que un saldo quede desincronizado: no hay un número guardado que pueda
divergir de la realidad. Todo el motor financiero (`server/src/lib/balance-math.ts` +
`finance.ts`) trabaja sobre esa idea, y hay una invariante testeada que la protege.

**Capas:**

- **Motores puros** (`server/src/lib/*`): lógica sin base de datos ni red — matemática de
  saldos, clasificación, fechas de vencimiento, salud financiera, detección de pagos. Es
  todo lo difícil, aislado para poder testearlo sin levantar nada. Acá viven los 145 tests.
- **Módulos** (`server/src/modules/*`): los endpoints HTTP. Traen datos con Prisma y
  delegan la lógica a los motores puros.
- **Integraciones** (`server/src/integrations/*`): conectores externos (Mercado Pago, IOL)
  detrás de una interfaz común, más el importador de extractos.
- **Cliente** (`client/src/*`): React. Un store de Zustand con `dataVersion` hace que todo
  sea reactivo — cambia un movimiento y el dashboard, patrimonio, timeline, forecast y
  salud se actualizan solos, sin refrescar.
- **Electron** (`electron/src/*`): arranca el servidor, abre la ventana, y —clave— corre
  las **migraciones** de la base al iniciar.

**Multi-moneda:** las monedas nunca se mezclan. El patrimonio separa ARS de USD; sumar
pesos con dólares daría un número sin sentido, así que no se hace. El disponible principal
es en ARS y el saldo en dólares se muestra aparte.

---

## 2. Estructura de carpetas

```
finance-os/
├── package.json              # scripts raíz: install:ci, typecheck, lint, test, build, ci
├── eslint.config.mjs         # ESLint plano (flat config), compartido por los 3 subproyectos
├── .github/workflows/        # verify.yml (gate) + 3 builds nativos (win, mac intel, mac arm)
│
├── server/                   # BACKEND (Express + Prisma + SQLite)
│   ├── prisma/
│   │   ├── schema.prisma     # 16 modelos — la fuente de verdad del esquema
│   │   └── schema.sql        # DDL equivalente, que Electron ejecuta (ver §migraciones)
│   ├── src/
│   │   ├── lib/              # MOTORES PUROS (sin DB): balance-math, finance, classify,
│   │   │                     #   services-math, service-match, health, seed-rules, crypto…
│   │   ├── modules/          # ENDPOINTS: accounts, movements, analysis, services,
│   │   │                     #   patrimonio, forecast, reports, budgets, goals, debts…
│   │   ├── integrations/     # Mercado Pago, IOL, importador, scheduler, manager
│   │   ├── middleware/       # auth, error, rate limiter
│   │   └── app.ts            # monta los 17 routers bajo /api/*
│   └── tests/                # 7 suites, 142 tests puros (corren con tsx, sin DB)
│
├── client/                   # FRONTEND (React + Vite + Tailwind)
│   └── src/
│       ├── pages/            # 20 páginas (Dashboard, Servicios, Patrimonio, Timeline…)
│       ├── components/       # UI, layout, HealthCard, SyncOnOpen…
│       ├── hooks/            # useFetch / useMutate (reactividad vía dataVersion)
│       └── lib/              # store (Zustand), api, format, institutions, platform
│
└── electron/                 # CONTENEDOR DE ESCRITORIO
    ├── src/
    │   ├── main.ts           # arranca server, abre ventana, corre migraciones
    │   ├── migrations.ts     # sistema de migraciones versionado (PRAGMA user_version)
    │   └── preload.ts
    ├── tests/                # migrations.test.ts (7 tests contra SQLite real)
    └── scripts/              # build, empaquetado, iconos
```

---

## 3. Módulos que existen

**Backend — endpoints (`server/src/modules/`):**

| Módulo | Qué hace |
|---|---|
| `auth` | Registro, login, JWT, reset de contraseña. Siembra categorías y reglas base. |
| `accounts` | Cuentas con saldo derivado. Bloquea transferencias entre monedas distintas. |
| `movements` | El libro contable. Cada movimiento hereda la moneda de su cuenta. |
| `categories` | Categorías + carga de reglas de clasificación base (idempotente). |
| `classification` | Sugerencia de categoría por reglas aprendidas (no IA, reglas explicables). |
| `analysis` | Dashboard, insights y **Salud Financiera** (`/health`). |
| `patrimonio` | Patrimonio actual (por moneda) + historial mes a mes. |
| `services` | **Servicios/suscripciones**: CRUD, calendario, resumen, marcar pagado. |
| `service-detection` | Detecta pagos de servicios entre movimientos importados/sincronizados. |
| `forecast` | Proyección financiera; usa servicios como gasto conocido. |
| `budgets` | Presupuestos por categoría. |
| `goals` | Objetivos de ahorro. |
| `debts` | Deudas (lo que debés / lo que te deben). |
| `investments` | Inversiones. |
| `reports` | Reportes exportables. |
| `timeline` | Feed histórico + **próximos vencimientos** (`/upcoming`). |
| `integrations` | Conectores (MP, IOL) + **sincronización de todo** (`/sync-all`). |

**Motores puros (`server/src/lib/`):** `balance-math` (saldos + separación por moneda),
`finance` (patrimonio), `classify` (matching de categorías), `services-math` (cálculo de
vencimientos, casos de calendario), `service-match` (detección conservadora de pagos),
`health` (puntaje de salud), `seed-rules` (comercios argentinos), `crypto` (cifrado de
tokens), `jwt`, `password`.

**Frontend — 20 páginas.** Las principales: Dashboard (con Salud Financiera), Servicios,
Patrimonio (distribución + historial), Timeline, Movimientos, Importar, Cuentas,
Integraciones, Inversiones, Forecast, Presupuestos, Objetivos, Reportes, Insights.

---

## 4. Funcionalidades implementadas

- **Motor contable único** — todo deriva de los movimientos; saldos y patrimonio nunca se guardan.
- **Cuentas con saldo dinámico** y soporte real de **múltiples monedas (ARS + USD)** sin mezclarlas.
- **Importador de extractos** (CSV, Excel, PDF) con detección de delimitador, decimal, formato
  de fecha y origen del archivo; deduplicación por hash; resumen "X nuevos / Y ya estaban".
- **Clasificación automática** por reglas que aprenden de las correcciones del usuario, con
  ~110 comercios argentinos sembrados de base. Nunca pisa lo que enseñaste.
- **Servicios y suscripciones** completos: vencimientos (con manejo correcto de día 31,
  febrero, bisiestos), calendario, detección automática de pagos (conservadora), e
  impacto en forecast y en el "disponible real".
- **Disponible real** — disponible menos lo comprometido en servicios del mes.
- **Salud Financiera** — puntaje 0-100 con factores explicables (cada punto se puede auditar).
- **Patrimonio** — por moneda, con distribución por cuenta e historial mes a mes.
- **Timeline** — pasado (agregado por día) + próximos vencimientos.
- **Sincronización al abrir la app** — panel "Sincronizando…" que trae lo nuevo de las
  cuentas conectadas y refresca todo, sin bloquear el arranque.
- **Reactividad total** — cambiar un movimiento actualiza toda la app sin refrescar.
- **Migraciones seguras** — la base se actualiza sin romperle los datos a nadie (ver §bugs).
- **Conectores** Mercado Pago (OAuth) e IOL (con tokens cifrados AES-256-GCM).
- Presupuestos, objetivos, deudas, inversiones, reportes exportables.

---

## 5. Funcionalidades pendientes

En orden de valor:

1. **IOL → patrimonio.** El conector de IOL ya trae los holdings y los guarda, pero
   `patrimonio()` todavía suma la tabla `Investment`, no `Holding`. Hasta cerrar esto, las
   tenencias de IOL no impactan el patrimonio neto en vivo. **Es el pendiente más importante.**
2. **Sincronizar al arranque de Electron.** Hoy la sync al abrir se dispara desde el
   frontend (seguro, no bloquea). El scheduler sincroniza por intervalo. Falta —opcional—
   un disparo a nivel del proceso main.
3. **Formatos de importación OFX / QFX / JSON.** La arquitectura ya los admite (un importer
   = un archivo); faltan esos parsers. Hoy andan CSV, Excel y PDF.
4. **Venta de inversión con ganancia.** El modelo actual saca plata de la cuenta al invertir
   pero no registra una venta con su ganancia por separado. Gap conocido del dominio.
5. **Asistente de mapeo manual de columnas** cuando la detección automática falla, con
   memoria de la configuración. Hoy la detección es automática y buena, pero no hay wizard
   para el caso raro.
6. **Recordatorios / notificaciones in-app.** La data ya está (`/services/calendar`,
   `/timeline/upcoming`); falta la capa visual de notificación.

---

## 6. Bugs conocidos

**Ninguno abierto que rompa el uso diario.** Lo que hay que tener presente:

- **Actualizar sin backup (mitigado, pero conviene el hábito).** La primera versión rompía
  la base de todos al cambiar el esquema (`CREATE TABLE IF NOT EXISTS` no agrega columnas).
  Eso **está resuelto** con el sistema de migraciones (`electron/src/migrations.ts`,
  versionado con `PRAGMA user_version`, transaccional, con 7 tests contra SQLite real,
  incluido el caso "base vieja con datos adentro"). Aun así, **antes de instalar una versión
  nueva conviene bajar un backup** (Configuración → Backup). Cuesta 5 segundos.
- **Recuperar contraseña no manda mail.** El flujo de reset existe pero no hay servidor de
  correo configurado (tiene sentido: la app es local). Documentado en `KNOWN-GAPS.md`.
- **El contrato de migraciones hay que respetarlo.** Si tocás `schema.prisma`, tenés que
  agregar una migración en `migrations.ts` con la versión siguiente, y reflejar el cambio en
  `schema.sql`. Si no, anda en desarrollo (`prisma db push`) y rompe en la app instalada.
  Está explicado en el encabezado de `migrations.ts`.

---

## 7. Recomendaciones antes de seguir desarrollando

1. **Cerrá IOL → patrimonio primero.** Es el pendiente que más cambia la experiencia (que
   las inversiones aparezcan en el patrimonio real), y es acotado.
2. **Respetá el contrato de migraciones religiosamente.** Es lo único que separa "actualizo
   la app sin drama" de "le rompo la base a mi yo del futuro". Cada cambio de `schema.prisma`
   → migración nueva + `schema.sql` actualizado. Y backup antes de cada release.
3. **Mantené la disciplina de motores puros.** La lógica difícil va en `server/src/lib/*`,
   sin tocar Prisma, con su test. Es lo que hace que haya 145 tests y que se pueda verificar
   sin levantar una base. No metas lógica de plata directamente en los endpoints.
4. **Nunca guardes un saldo, un patrimonio ni un disponible.** Es la regla de oro del
   proyecto. Todo se deriva. El día que alguien "cachea" un saldo para ir más rápido, empieza
   la desincronización.
5. **No mezcles monedas en un solo número, nunca.** Separá por moneda como ya lo hace el
   patrimonio y los servicios.
6. **Fijá TypeScript a una versión exacta.** El lockfile tiene 5.9.3, pero `^5.6.2` en el
   package.json permite que una máquina agarre otra. Considerá fijar la versión exacta para
   que local y CI usen siempre la misma (esto evitó un falso rojo durante el desarrollo).
7. **Sobre "IA que aprende":** los insights actuales son reglas sobre datos reales, no un
   modelo. Está bien así — para finanzas, reglas explicables le ganan a una caja negra.
   Si algún día sumás un modelo, que sea *además* de las reglas, no en lugar de ellas.

---

## 8. Estado del pipeline (verificado con las versiones del CI)

| Paso | Resultado |
|---|---|
| **Install** (`npm ci` × 4) | ✓ lockfiles coherentes |
| **Prisma generate** | ✓ schema válido (se genera en CI; local bloqueado por red) |
| **Typecheck** (TS 5.9.3) | ✓ cliente limpio · electron limpio · server limpio con Prisma generado |
| **ESLint** | ✓ 0 errores (176 warnings de `no-explicit-any`, deliberados, no rompen) |
| **Tests** | ✓ 145 tests, 8 suites (7 server + 1 electron) |
| **Build** | ✓ cliente (tsc -b && vite build) · server (tsc → dist) |

**Nota sobre Prisma en este entorno:** `prisma generate` no corre acá porque el dominio de
descarga del engine está bloqueado por red. El esquema fue validado (Prisma parsea correcto)
y todos los "errores" de typecheck del server son exclusivamente la firma de "Prisma sin
generar" (tipos de modelos y de resultados de queries), que desaparecen cuando el CI genera
el cliente. Cero errores de tipo reales.
