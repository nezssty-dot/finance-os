# V1 fuerte: Salud Financiera, sync al abrir, patrimonio visual

Los tres pilares que pediste, con foco en no agregar funciones grandes que rompan lo que
anda. Lo que había que construir de verdad se construyó; lo que ya estaba, se conectó.

---

## Pilar 1 — Integraciones que se sienten vivas

**Sincronización al abrir la app**, con el panel "Sincronizando…" que dibujaste.

Al entrar, la app llama sola a todas las cuentas conectadas y muestra el resultado por
proveedor abajo a la derecha:

```
Sincronizando…
  ✓ Mercado Pago    2 movimientos nuevos
  ✓ IOL             1 tenencia actualizada
  ✓ Banco Galicia   Sin cambios
Listo.
```

Cuando termina, refresca los datos solo (dataVersion) y **todo** —dashboard, patrimonio,
timeline, forecast, salud— toma lo nuevo sin que toques nada. A los segundos, el panel se va.

**Por qué así y no atado al arranque de Electron** (que es lo que venía marcando como
riesgoso): es una llamada normal disparada desde el front al montar la app. Si la sync se
cuelga o tarda, **la app abre igual**. Si un proveedor falla, los demás siguen y el error
queda en su propia línea, no tumba la tanda. Y como cada sync ya deduplica, llamarla en
cada apertura nunca duplica un movimiento. Es el pilar #1 hecho de la forma segura.

Endpoint nuevo: `POST /api/integrations/sync-all`. Componente: `SyncOnOpen.tsx`.

---

## Pilar 2 — Todo deriva solo

Esto **ya estaba** y sigue estando: el `dataVersion` de Zustand hace que cargar un
movimiento actualice dashboard, patrimonio, timeline, forecast, objetivos, insights y
gráficos sin refrescar. No lo toqué. El sync-all de arriba se engancha a ese mismo
mecanismo, así que lo que baja de Mercado Pago o IOL también dispara la cascada.

---

## Pilar 3 — Que piense como asesor: SALUD FINANCIERA

La función que dijiste que era clave antes de lanzar. Hecha de punta a punta.

**Una tarjeta grande** arriba del dashboard: un anillo con el puntaje 0-100, el rating
("Excelente"), el resumen del mes (ingresaste / gastaste / ahorraste) y la lista de señales:

```
  ✔ Ahorrás el 38% de lo que ingresás
  ✔ Sin deudas
  ✔ Buen flujo: cubrís tus gastos
  ⚠ Muchas suscripciones: 32% de tu ingreso
  ⚠ Delivery alto: 28% de tus gastos
```

**La regla que manda: cada punto se puede explicar.** El puntaje no es un número mágico —
es la suma de cinco factores con peso fijo (ahorro 35, deuda 25, flujo 20, suscripciones
10, concentración 10), y esa lista de ✔/⚠ es *literalmente* de dónde sale. Si te da 85,
ves exactamente qué te sumó y qué te restó. El test que blinda esto verifica que el score
es *exactamente* la suma de los factores — así el número y las señales nunca cuentan cosas
distintas.

- Motor puro y testeado: `server/src/lib/health.ts`, 11 tests.
- Los umbrales (qué es "ahorro sano", "muchas suscripciones", "delivery alto") están todos
  a la vista arriba del archivo, para ajustarlos sin cazar magia por el código.
- Se mide sobre el **mes actual** (la salud es lo que pasa ahora) y en **ARS** (mezclar
  monedas daría un número sin sentido, igual que en el patrimonio).
- Es una heurística honesta, no una verdad revelada — y está dicho así.

Endpoint: `GET /api/analysis/health`. Tarjeta: `HealthCard.tsx`.

---

## Centro de Patrimonio: distribución + historial

**Distribución por cuenta**, con las barras que dibujaste:

```
Dónde está tu plata (cuentas en ARS)
  Mercado Pago   $1.260.000   15%   ████
  Banco          $1.680.000   20%   █████████
  IOL            $4.620.000   55%   ██████████████
  Efectivo       $840.000     10%   ██
```

Solo sobre cuentas en ARS, a propósito: repartir un total que mezcle pesos y dólares no
tendría sentido. Las cuentas en dólares se muestran aparte.

**El historial del patrimonio YA EXISTÍA** (`/patrimonio/history`) y se ve en la página:
la evolución mes a mes con el gráfico de barras. No hubo que construirlo — ya estaba el
"Enero → Febrero → … → Hoy" que motiva.

---

## Estado

| Suite | Tests |
|---|---|
| finance (balance-math + monedas) | 15 |
| mercadopago | 32 |
| integrations | 17 |
| import | 31 |
| classification | 17 |
| services (fechas + detección) | 26 |
| **health (salud financiera)** | **11** |
| electron/migrations | 7 |
| **Total** | **156** |

Todos verdes. Typecheck limpio en los tres proyectos.

Nuevo en esta entrega: `server/src/lib/health.ts`, `server/tests/health.test.ts`,
`client/src/components/HealthCard.tsx`, `client/src/components/layout/SyncOnOpen.tsx`,
endpoints `/analysis/health` y `/integrations/sync-all`, distribución por cuenta en la
página Patrimonio.

---

## Lo que sigue quedando (sin cambios desde antes)

- **IOL → patrimonio**: el conector trae holdings, pero `patrimonio()` todavía suma la
  tabla `Investment`, no `Holding`. Cuando se cierre, las inversiones de IOL impactan el
  neto en vivo. Es el gap más viejo pendiente.
- **Formatos OFX/QFX/JSON** en el importador (la arquitectura ya los admite).

Nada de esto bloquea el uso diario. La app ya te deja registrar, importar, ver patrimonio
real por moneda, controlar servicios, ver tu salud financiera y sincronizar al abrir.
