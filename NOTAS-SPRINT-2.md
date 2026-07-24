# Sprint 2 — Servicios, y la base para todo lo demás

Este sprint es distinto al anterior: el documento reconoce el core y pide **no tocarlo**.
Eso es lo correcto. No se tocó el Ledger, ni balance-math, ni la derivación de saldos.

Lo que se hizo es el **módulo de Servicios completo** —que era el cimiento de medio
documento— más los enganches que ese módulo desbloquea.

---

## Por qué Servicios primero

Sin Servicios, no existen:

- **§2 Disponible real** — necesita saber cuánto hay comprometido.
- **§4 Timeline** con vencimientos futuros — los vencimientos SON servicios.
- **§8 Forecast** con pagos futuros — el gasto conocido son los servicios.
- **§9 IA** hablando de suscripciones — necesita el historial de pagos.
- **§12 Recordatorios** y **§14 Resumen ejecutivo** — el próximo pago es un servicio.

Así que se hizo Servicios de punta a punta, y eso alimentó al resto.

---

## Lo construido

### El modelo (con una decisión importante)

Dos tablas nuevas: `Service` y `ServicePayment` (schema.prisma + schema.sql).

**No se guarda el "próximo vencimiento".** Es derivado —sale de la frecuencia, el día de
vencimiento y los pagos ya hechos— y guardarlo sería el mismo error que guardar un saldo:
el día que una fecha se calcula mal y queda pegada, miente para siempre. Se calcula en
cada lectura. Es la misma filosofía que ya protege balance-math.

`ServicePayment` guarda **el monto de cada pago**, no solo el precio actual del servicio.
Sin eso no se puede detectar "Adobe aumentó 12%": necesitás saber qué costaba antes.

### La migración v2 (y por qué importó tener el sistema del sprint pasado)

Agregar tablas tocando el schema es exactamente lo que **rompía la app de todos** antes
del sistema de migraciones. Ahora:

- Instalaciones nuevas: las tablas vienen en el baseline (schema.sql).
- Instalaciones que ya existen: las reciben por la **migración v2**, sin perder datos.

Probado contra SQLite **real**: base nueva, base vieja con datos adentro, re-arranque que
no re-migra, e inserts reales con sus constraints. **Este sprint no habría sido posible sin
lo del anterior** — habría dejado a cualquiera con la app instalada sin poder abrirla.

### El motor de fechas (`services-math.ts`, puro, 18 tests)

Lo más delicado del módulo: calcular vencimientos. Los casos que rompen la aritmética
ingenua de fechas están todos cubiertos:

- Día 31 en un mes de 30 → cae el 30, no salta al mes siguiente.
- Día 31 en febrero → el 28 (o 29 en bisiesto).
- **Después de febrero vuelve a 31** — no se queda pegado en 28, que es el bug clásico.
- Anual desde el 29-feb → 28-feb en años no bisiestos.
- interval 0 y datos absurdos → no cuelgan la app (guardas duras).

La mayoría de las apps de finanzas tienen esto mal. Acá está probado con fechas fijas.

### La detección automática de pagos (`service-match.ts`, puro, 8 tests)

Cuando entra un gasto (importado o sincronizado), se detecta si paga un servicio y se
marca solo. **La regla de oro es: ante la duda, NO.** Exige las tres cosas a la vez:

1. El nombre del servicio aparece en la descripción.
2. El monto es parecido (±15%, para servicios en dólares o con impuestos variables).
3. La fecha cae cerca de un vencimiento real (±7 días).

Un falso positivo marca "pagado" algo que no se pagó, y eso es peor que no detectar nada:
el usuario deja de ver un vencimiento que sigue vivo. Por eso es conservador. Probado que
rechaza el caso ambiguo (mismo monto, sin nombre → no matchea).

Y **nunca pisa un pago que el usuario ya confirmó** a mano (unique serviceId+dueDate).

### La página (`Servicios.tsx`)

Lista con estado de cada servicio (próximo vencimiento, si está pago, cuántos días
faltan), calendario de próximos 45 días agrupado por día, y formulario completo. Marcar
pagado/pendiente con un clic. Pausar sin borrar. Todo con el sistema de diseño existente.

### Los enganches

- **Dashboard**: tarjeta "Disponible Real" (disponible − comprometido del mes) y banda de
  "próximo pago". Solo aparecen si hay servicios: no ensucian el dashboard de quien no los usa.
- **Forecast**: los meses proyectados usan el gasto de servicios como **piso conocido** en
  vez de adivinarlo por promedio. Expone `committed` por mes.
- **Timeline**: sección "Próximamente" con los vencimientos de los próximos 30 días.
  (De paso se arregló un bug preexistente — ver abajo.)
- **IA/Insights**: cuántos servicios y cuánto se destina por mes, y **aumentos detectados**
  desde el historial real de pagos.

---

## Un bug preexistente que se arregló de paso

La página **Timeline estaba rota**: llamaba a `/timeline` esperando días ya agregados,
pero el server había pasado a devolver un feed de eventos individuales (`{ events }`). El
resultado: la página mostraba siempre "Nada todavía". Como estaba trabajando ahí y tenía
las dos puntas a la vista, se reescribió el cliente para agregar los eventos por día. Ahora
funciona y además tiene la sección de próximos vencimientos.

(No se pudo correr end-to-end con la base real acá —Prisma necesita un binario que este
entorno bloquea— pero el cliente typechequea y la lógica de agregación es mecánica.)

---

## Lo que queda del documento

Varias cosas del Sprint 2 **ya existían** y solo necesitan que Servicios las alimente
(ahora ya lo hace). Lo que queda como trabajo genuino:

### Enganchado pero ampliable
- **§5 Centro de inversiones / §11 IOL**: el conector ya trae holdings, pero `patrimonio()`
  todavía suma la tabla `Investment`, no `Holding`. Es el mismo gap que ya estaba en las
  notas del sprint anterior. Cuando se cierre, las inversiones de IOL impactan el patrimonio.
- **§12 Sincronizar al abrir**: el scheduler sincroniza por intervalo; falta el disparo al
  arrancar la app.

### Nuevo, no empezado
- **§12 Recordatorios / §13 Notificaciones**: la data ya está (calendario de servicios,
  próximos pagos). Falta la capa de notificación in-app. Es directo ahora que existe
  `/services/calendar` y `/timeline/upcoming`.
- **§10 Reportes con gráficos de servicios**: sumar servicios a los reportes exportables.
- **§6 Patrimonio como centro patrimonial**: la página existe; el documento pide más
  desgloses (histórico, liquidez vs invertido). Ampliación, no reescritura.

### Ojo con esto
- El documento pide "aprender del comportamiento" en varios lados (§9, §12). Los insights
  actuales son reglas sobre datos reales, no un modelo que aprende. Está bien así: es
  honesto y predecible. Un "modelo que aprende" de verdad es otro proyecto, y para finanzas
  personales las reglas explicables suelen ser mejores que una caja negra.

---

## Estado de los tests

| Suite | Tests |
|---|---|
| `finance.test.ts` (balance-math) | 11 |
| `mercadopago.test.ts` | 32 |
| `integrations.test.ts` | 17 |
| `import.test.ts` | 31 |
| `classification.test.ts` | 17 |
| `services.test.ts` **(nuevo: fechas + detección)** | 26 |
| `electron/migrations.test.ts` (ahora con v2) | 7 |
| **Total** | **141** |

Todos verdes. El motor de fechas y el matcher se probaron además con un escenario
realista de 3 servicios (Spotify, Netflix, ChatGPT en USD) de punta a punta.

Typecheck limpio en client, electron y server (server: solo los falsos errores de
Prisma-sin-generar, que en tu máquina no aparecen porque ahí `prisma generate` sí corre).
