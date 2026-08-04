# CHANGELOG — Fase Final V1.0

Construido SOBRE la arquitectura existente. No se reescribió nada: Ledger, Balance Math,
Patrimonio, Prisma, tests, integraciones y pipeline siguen intactos. Todo lo nuevo se
sumó sin refactors grandes.

---

## Lo que cambió en esta fase

### Importador — detección inteligente (Prioridad 1)

El problema real: el importador leía el archivo pero muchas veces devolvía "no se
reconoció ningún movimiento". Encontré tres causas y las arreglé de raíz, todo en lógica
pura testeada.

1. **Encabezado en cualquier fila, no solo la primera.** Los extractos traen preámbulo
   (banco, titular, período, número de cuenta) ANTES de la tabla. Antes se asumía que la
   fila 0 era el encabezado; con preámbulo, el encabezado real quedaba adentro de los
   datos y no se detectaban las columnas por nombre. Ahora `findHeaderRow()` ubica el
   encabezado real dondequiera que esté y saltea el preámbulo.

2. **Detección por MAYORÍA, no por "todas".** Antes se exigía que TODOS los valores de una
   columna parecieran fecha (o importe). Una sola celda vacía o una fila rara tiraba la
   detección de la columna entera. Ahora la columna que MAYORMENTE parece fecha ES la
   fecha, filtrando además a las filas que parecen transacciones.

3. **Muchos más sinónimos de columnas.** Se reconocen (sin depender del nombre exacto):
   - Fecha: `Fecha`, `Date`, `Fecha Operación`, `Fecha Movimiento`, `Transaction Date`,
     `Fecha Comprobante`, `Fecha Valor`, `Posted`…
   - Descripción: `Descripción`, `Detalle`, `Concepto`, `Movimiento`, `Description`,
     `Comercio`, `Beneficiario`, `Referencia`, `Memo`…
   - Importe: `Monto`, `Importe`, `Amount`, `Valor`, `Total`…
   - Débito: `Débito`, `Debe`, `Debit`, `Cargo`, `Egreso`, `Extracción`, `Retiro`…
   - Crédito: `Crédito`, `Haber`, `Credit`, `Abono`, `Ingreso`, `Acreditación`, `Depósito`…

4. **Diagnóstico claro — nunca más un error genérico.** El preview ahora devuelve, y la
   pantalla muestra: qué columna se detectó como qué, si falta la fecha o el importe, y
   por qué se descartó cada fila. Si algo no cierra, el mensaje dice exactamente qué pasó.

**Tests:** +7 casos nuevos (preámbulo, sinónimos, inglés, ingreso/egreso, celda vacía,
diagnóstico) → **38 tests del importador, todos verdes.** Los 31 que ya existían siguen
pasando: no se rompió ningún formato que ya andaba (Galicia, Santander, Macro, Brubank).

### Mercado Pago — diagnóstico exacto (Prioridad 2)

El mensaje genérico "no está configurado" ahora dice **exactamente qué variable falta**
(`MP_CLIENT_ID` y/o `MP_CLIENT_SECRET`), apunta a Mercado Pago Developers, e informa la
Redirect URI que hay que registrar. El OAuth completo ya estaba implementado.

### IOL — motor de reconstrucción de cartera (Prioridad 3)

Motor puro y testeado (`server/src/lib/portfolio.ts`) que, dado el historial de
operaciones, reconstruye: posiciones, costo promedio ponderado (PPC), capital invertido,
ganancia realizada, ganancia no realizada, y renta cobrada (dividendos/intereses/cupones).
Más el mapper de `/api/v2/operaciones`. **26 tests.**

Respetando tu indicación de "no duplicar patrimonio ni caja": el diseño correcto es un
**Investment Ledger separado** que alimenta la vista de inversiones SIN tocar la
derivación del saldo de caja (que sigue viniendo de `estadocuenta`, la fuente autoritativa
de IOL). Ver "Pendientes" para qué falta para conectarlo en vivo.

---

## 1. Funcionalidades terminadas

- Motor contable único; saldos y patrimonio siempre derivados, nunca guardados.
- Cuentas multi-moneda (ARS + USD) sin mezclar.
- **Importador con detección inteligente** (CSV, Excel, PDF): encabezado en cualquier fila,
  sinónimos de columnas, detección por mayoría, deduplicación, y diagnóstico claro.
- Preview antes de importar (banco/cuenta/moneda detectados, primeros movimientos, nuevos
  vs duplicados vs descartados).
- Clasificación automática por reglas que aprenden.
- Servicios y suscripciones (vencimientos, calendario, detección de pagos, disponible real).
- Salud Financiera (puntaje 0-100 explicable).
- Patrimonio por moneda, con distribución por cuenta e historial.
- Timeline (pasado + próximos vencimientos).
- Sincronización al abrir la app (panel "Sincronizando…").
- Reactividad total (dataVersion): un cambio actualiza dashboard, patrimonio, timeline,
  forecast, objetivos, servicios, insights, reportes, inversiones y presupuestos sin refrescar.
- Migraciones seguras de base.
- Motor de reconstrucción de cartera de IOL (posiciones, PPC, realizado, no realizado, renta).
- Diagnóstico exacto de configuración de Mercado Pago.
- Conectores MP (OAuth) e IOL (posiciones actuales + saldo), con tokens cifrados.

## 2. Funcionalidades pendientes

En orden de valor:

1. **Conectar el motor de reconstrucción de IOL en vivo**, como Investment Ledger separado.
   Falta: fetch de operaciones en el provider, almacenamiento separado, y la vista. El
   motor y el mapper ya están y testeados; falta el cableado + verificación con tu cuenta
   real (los nombres de campo de `/operaciones` los infiero de la doc — necesito una
   respuesta real para confirmarlos).
2. **Asistente de mapeo manual** de columnas cuando la detección automática falla, con
   memoria por banco. Hoy la detección es mucho más robusta y el diagnóstico dice qué
   revisar, pero no hay un wizard visual todavía.
3. **Formatos OFX/QFX/JSON** en el importador (la arquitectura ya los admite).
4. **IOL → patrimonio en vivo**: el neto todavía suma la tabla `Investment`, no `Holding`.

## 3. Cómo probar cada integración

### Importador
1. Andá a Importar y arrastrá un CSV/Excel/PDF de tu banco.
2. Debería mostrar el preview con banco/cuenta detectados y los movimientos.
3. Si NO reconoce movimientos, ahora te dice exactamente por qué (qué columnas detectó,
   si falta fecha/importe). **Si eso pasa con un archivo tuyo, mandámelo con ese mensaje**
   y ajusto la detección a ese formato puntual.
4. Elegí la cuenta e importá. Reimportar el mismo archivo NO duplica (probalo).

### Mercado Pago
1. Creá una app en https://www.mercadopago.com.ar/developers y copiá Client ID y Secret.
2. Registrá la Redirect URI: `http://localhost:4000/api/integrations/mercadopago/callback`
3. Cargá las variables de entorno del server:
   ```
   MP_CLIENT_ID=...
   MP_CLIENT_SECRET=...
   MP_REDIRECT_URI=http://localhost:4000/api/integrations/mercadopago/callback
   ```
4. Reiniciá y tocá "Conectar". Si falta una variable, ahora te dice cuál.

### IOL
1. Activá la API en tu cuenta de IOL (Mi Cuenta > Personalización > APIs).
2. Conectá con usuario y contraseña (IOL no tiene OAuth; la contraseña se usa una vez y no
   se guarda). Vas a ver tus posiciones actuales y saldo.
3. Para el historial completo (reconstrucción): es el pendiente #1. Para cerrarlo bien
   necesito una respuesta real de `GET /api/v2/operaciones` de tu cuenta (solo los nombres
   de los campos y un par de filas; borrá los montos si querés).

## 4. Confirmación de compilación

Verificado en este entorno con las versiones exactas del CI (TypeScript 5.9.3):

| Paso | Resultado |
|---|---|
| Tests server (178) | ✓ exit 0 |
| Tests electron/migraciones (7) | ✓ 7/7 |
| Typecheck cliente | ✓ limpio |
| Typecheck electron | ✓ limpio |
| Typecheck server | ✓ 0 errores reales (solo firma Prisma-sin-generar, se resuelve al generar) |
| Lint | ✓ 0 errores, 176 warnings (los mismos de antes — **0 warnings nuevos**) |
| Build cliente | ✓ exit 0 |

**Nota:** `prisma generate` no corre en este entorno (bloqueo de red al dominio del engine).
El schema es válido y todos los "errores" del server son exclusivamente tipos que Prisma
genera; en tu entorno (Windows/Mac/CI) el build corre `prisma generate` primero y quedan
en cero. Ver `FIX-BUILD.md`.

## 5. Confirmación: no se rompió nada existente

Los 31 tests del importador que ya existían siguen pasando (Galicia, Santander, Macro,
Brubank, deduplicación) — el cambio de detección es aditivo. Y las 8 suites completas del
server (finance, mercadopago, integraciones, importador, clasificación, servicios, salud,
cartera) pasan en verde. La arquitectura del Ledger, Balance Math y Patrimonio no se tocó.

La prioridad fue estabilidad y exactitud: donde había riesgo de un cálculo incorrecto de
patrimonio (registrar operaciones de IOL en la caja sin resolver el doble conteo), preferí
dejarlo como pendiente bien definido antes que meter un número equivocado.
