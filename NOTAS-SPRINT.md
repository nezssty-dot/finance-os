# Refactor del core financiero — inventario honesto

Este documento revisa el pedido de "refactor completo del core financiero" punto por punto,
contra lo que **ya está construido** en el repo.

El resumen: **la mayor parte ya existe**. Un par de cosas del pedido serían un **retroceso**.
Lo que sí faltaba, o está hecho en este sprint, o está listado abajo con su diseño.

Esto no es para discutir. Es para no reescribir tres semanas de trabajo que ya funciona.

---

## ✅ Lo que YA ESTABA (no se tocó)

### §1 — "Crear un motor contable único (Ledger)"

**Ya existe, y es mejor que lo que pedía el documento.**

El ledger es la tabla `Movement`. Cada fila tiene `type` (INCOME, EXPENSE, TRANSFER, INVESTMENT,
DEBT_PAYMENT, COLLECTION, INTERNAL), `accountId`, `transferAccountId` y `amount`.
`server/src/lib/balance-math.ts` deriva **todos** los saldos de ahí, con un mapa `SIGN` que dice
qué le hace cada tipo al saldo.

Y hay una invariante que el archivo protege explícitamente:

> *"Balances are DERIVED from movements, never stored. A stored balance must be updated by every
> code path that touches money — and the day one path forgets, the number is silently wrong forever."*

**Una tabla `Ledger` separada de `Movement` sería un retroceso grave.** Serían dos fuentes de
verdad que hay que mantener sincronizadas: el día que una se desincroniza, el patrimonio miente
y no hay forma de saberlo. El diseño actual hace ese bug **imposible**, no improbable.

Las transferencias ya no cambian el patrimonio: `SIGN.TRANSFER = -1` sobre `accountId`, y la otra
punta suma en `transferAccountId`. Neto cero. Ya está probado (11 tests en `finance.test.ts`).

### §2, §3 — Dashboard y patrimonio en tiempo real

Ya salen de `analysis.ts` → `finance.ts` → `balance-math.ts`. El patrimonio **nunca se guarda**:
se calcula en cada request. Es exactamente lo que pedía el punto.

### §4 — Saldos dinámicos por cuenta

Ya es así. `openingBalance` es el saldo al momento de crear la cuenta (necesario: si abrís la app
con $200.000 en el banco, hay que poder decirlo); todo lo demás se deriva.

### §8 — Deduplicación

Ya existe, y con dos mecanismos: `importId()` (hash de contenido, para extractos) y `contentHash()`
(para los conectores). 31 tests en `import.test.ts`, incluido "reimportar enero-febrero sobre enero
no duplica enero".

### §10, §17 — Actualización automática y store central

Ya existe: `dataVersion` en el store de Zustand. Cada mutación llama `refresh()`, y `useFetch`
re-consulta solo. Por eso al cargar un movimiento el dashboard ya se actualiza.

### §14, §15 — IA y reportes

`analysis.ts` ya genera insights y reportes.

---

## 🔨 Lo que SÍ faltaba — hecho en este sprint

### §16 — El sidebar invade la barra de macOS ✅

Bug real. `titleBarStyle: "hiddenInset"` quita la barra de título y los botones de la ventana
**flotan sobre el contenido**, justo encima del logo.

Y había un **segundo bug** que no estaba en el documento: sin barra de título y sin ninguna zona
`-webkit-app-region: drag`, **la ventana no se podía arrastrar de ningún lado**.

Arreglado:
- `electron/src/main.ts` → `trafficLightPosition` fija la posición del semáforo (sin esto, se
  vuelve a romper cada vez que Apple mueve los botones un par de píxeles).
- `client/src/lib/platform.ts` → detecta macOS de escritorio.
- `Sidebar.tsx` + `TopBar.tsx` → reservan `MAC_INSET` (32px) arriba, **solo en macOS**, y esa
  franja es arrastrable.

En Windows, Linux y el navegador no cambia nada: ahí la barra de título es real, y reservar
espacio sería un hueco vacío sin motivo.

### §7, §13 — Reglas de clasificación semilla ✅

El clasificador ya existía y aprendía. **Pero arrancaba vacío**: no sabía nada hasta que
categorizabas algo a mano. Instalación nueva → importás 300 movimientos → salen 300 sin categoría.

Hecho:
- `server/src/lib/seed-rules.ts` — catálogo puro: ~110 comercios argentinos reales mapeados a
  13 categorías (Spotify → STREAMING, YPF → COMBUSTIBLE, PedidosYa → DELIVERY, OpenAI → IA…).
- `applySeedRules()` — **idempotente**, y **nunca pisa lo que vos enseñaste**. Si categorizaste
  Spotify como PRODUCCION, sigue siendo PRODUCCION.
- Se siembra sola al registrarse, y hay un botón en **Configuración → Clasificación automática**
  para las instalaciones que ya existen (como la tuya).
- 17 tests, incluidas las invariantes del catálogo (nada de menos de 3 caracteres, sin conflictos).

**Una cosa que pediste y NO hice a propósito:** la regla `"transferencia" → TRANSFERENCIAS`.
Ver abajo, en "Trampas".

### KNOWN-GAPS §1 — Sistema de migraciones ✅

**Esto no estaba en tu documento, y era el bloqueante de todo lo que sí pediste.**

Tu sprint necesita tocar el schema (tags, notas, subcategoría, Servicios). Y `schema.sql` usa
`CREATE TABLE IF NOT EXISTS`: sobre una base que ya existe, **no agrega columnas nuevas**.
Traducido: la primera actualización que agregue un campo dejaba la app sin abrir, a todos.

Hecho: `electron/src/migrations.ts`, versionado con `PRAGMA user_version`, transaccional
(una migración que falla revierte entera), con 7 tests contra SQLite **real** — incluido el caso
"base vieja con datos adentro se adopta sin perder nada".

Ahora se pueden agregar campos y tablas sin romperle la base a nadie. **Sin esto, el resto del
sprint era imposible.**

---

## ⚠️ Trampas — cosas del pedido que harían daño

### La regla "transferencia → TRANSFERENCIAS"

El importador de extractos crea todo como INCOME o EXPENSE **según el signo**. Nunca crea TRANSFER:
no tiene forma de saber que la otra punta de esa transferencia es una cuenta tuya.

Una regla de clasificación no arregla eso. Le pone una etiqueta linda a un movimiento que **sigue
contando como gasto**. Los reportes quedan inflados igual, pero ahora con una categoría que hace
parecer que está todo bien. Es peor que no tener nada.

**El bug real, que sí conviene arreglar:** si te transferís $500.000 del Galicia a Mercado Pago y
después importás los dos extractos, hoy entra como **un gasto de $500.000 y un ingreso de $500.000**.
El patrimonio queda bien (se cancelan), pero "gastos del mes" y "ingresos del mes" están inflados
en medio palo cada uno.

Arreglarlo bien es detectar, entre movimientos de **cuentas propias distintas**, pares con el mismo
monto y fechas cercanas, y ofrecer fusionarlos en un TRANSFER. Es un sprint en sí mismo y hay que
hacerlo con confirmación del usuario, no en automático — un falso positivo te borra un ingreso real.

### Ledger separado de Movement

Ver §1 arriba. Dos fuentes de verdad = el patrimonio miente algún día y no te enterás.

---

## 📋 Lo que queda — con diseño, en orden

### 1. §19 — Servicios y suscripciones (LO MÁS GRANDE, y 100% nuevo)

No existe nada. Es el único módulo del documento que es genuinamente nuevo de punta a punta.

Diseño propuesto:

```
model Service {
  id, userId, name
  categoryId?, accountId?          // con qué se paga
  amount, currency
  frequency                         // MONTHLY | WEEKLY | YEARLY
  interval        Int   @default(1) // cada cuántos períodos (3 = trimestral)
  dueDay?         Int               // día del mes (1-31)
  autoDebit       Boolean           // débito automático
  startDate, endDate?, active
  notes?
}

model ServicePayment {              // el historial: qué vencimiento pagó qué movimiento
  id, serviceId, dueDate, movementId?, paidAt?, amount
}
```

- `server/src/lib/services-math.ts` **puro**: próximo vencimiento, vencimientos en un rango,
  cuánto hay comprometido en los próximos N días. Testeable sin base.
- Auto-marcado: al importar o sincronizar, un movimiento que coincide en **nombre + monto
  aproximado + ventana de fechas** se linkea al vencimiento. Con confirmación, no en silencio.
- `ServicePayment` es lo que permite decir "Adobe te aumentó 12% en marzo" — sin historial, eso
  no se puede calcular.
- Impacto en el dashboard: **disponible real** = disponible − comprometido en los próximos 30 días.

Requiere **migración v2**. Ya se puede, gracias a lo de arriba.

### 2. §5 — Campos que faltan en Movement

`tags`, `subcategory`, `notes`. Requiere **migración v3**. Trivial ahora, imposible antes.

(`hora` ya está: `date` es DateTime. `UUID` ya está: el `id` es un cuid. `banco` ya está: se deriva
de `account.provider`.)

### 3. §6 — Formatos de importación que faltan

OFX, QFX, TXT, JSON. La arquitectura ya está lista: `client/src/lib/import/engine.ts` tiene un
array `IMPORTERS` y agregar uno es agregar un archivo. El comentario del archivo ya lo dice.

### 4. §11 — Los holdings de IOL no impactan el patrimonio

El conector IOL ya trae los holdings y los guarda. Pero `patrimonio()` suma la tabla `Investment`,
no `Holding`. O sea: tenés los datos, pero no se ven en el patrimonio neto.

### 5. §12 — Sincronizar al abrir la app

Hoy el scheduler sincroniza por intervalo. Falta el disparo al arrancar.

### 6. Venta de inversión con ganancia

El caso que pusiste en §1 (Inversiones −500k, Banco +560k, Ganancia +60k) **no está bien modelado
hoy**. `INVESTMENT` saca plata de la cuenta, pero no hay un movimiento de venta que la devuelva y
registre la ganancia por separado. Es un gap real.

---

## Estado de los tests

| Suite | Tests |
|---|---|
| `finance.test.ts` (balance-math) | 11 |
| `mercadopago.test.ts` | 32 |
| `integrations.test.ts` | 17 |
| `import.test.ts` | 31 |
| `classification.test.ts` **(nuevo)** | 17 |
| `electron/migrations.test.ts` **(nuevo)** | 7 |
| **Total** | **115** |

Todos verdes. Ninguno toca la base, la red ni credenciales — salvo los de migraciones, que corren
contra SQLite real a propósito (un mock ahí no probaría nada).
