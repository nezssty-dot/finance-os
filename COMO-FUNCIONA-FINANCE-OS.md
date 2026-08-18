# Finance OS — Cómo funciona

Documento de referencia del sistema completo: qué es, cómo está armado, qué hace cada
parte y —sobre todo— por qué está hecho así. La idea es que puedas entender y retomar
cualquier pedazo sin tener que releer todo el código.

---

## 1. Qué es

Finance OS es una aplicación de escritorio de finanzas personales, **100% local** (tus
datos viven en tu máquina, no en la nube). Corre en Windows y macOS.

**El stack:**
- **Electron** — la app de escritorio (empaqueta todo en una ventana nativa).
- **React + Vite** — la interfaz (lo que ves y tocás).
- **Express** — el servidor interno que responde a la interfaz.
- **Prisma + SQLite** — la base de datos, un archivo local.

Los tres corren juntos dentro de Electron: la interfaz le habla al servidor, y el servidor
lee y escribe en la base. Nada sale de tu computadora salvo cuando vos conectás un banco o
broker (y ahí solo para traer TUS datos).

---

## 2. El principio de oro

Hay una regla que atraviesa todo el sistema y explica la mayoría de las decisiones:

> **Los saldos y el patrimonio nunca se guardan. Se derivan de los movimientos.**

Cada peso que entra o sale es un registro en la tabla de movimientos (el "libro
contable"). El saldo de una cuenta no es un número guardado que hay que actualizar: es la
**suma de sus movimientos**, calculada en el momento.

¿Por qué? Porque un saldo guardado es una bomba de tiempo. Habría que actualizarlo en cada
lugar que toca plata —un movimiento manual, una edición, un borrado, una sincronización de
Mercado Pago, un pago de deuda— y el día que UN camino se olvida de hacerlo, el número
queda mal para siempre y en silencio. Derivándolo, **no puede desfasarse**: no hay botón de
"recalcular" porque no hay nada que recalcular.

La segunda mitad de la regla:

> **Las monedas nunca se mezclan.**

Los pesos van con los pesos y los dólares con los dólares. El sistema jamás suma ARS + USD
en un mismo número (eso sería sumar peras con manzanas). El patrimonio en dólares se
muestra por separado del de pesos. Esto vas a verlo en todos lados: cuentas, patrimonio,
inversiones, servicios.

---

## 3. Arquitectura en capas

```
┌─────────────────────────────────────────────┐
│  Interfaz (React)  — 20 páginas               │
│  Reactividad: un cambio actualiza todo        │
└───────────────────┬─────────────────────────┘
                    │ HTTP (localhost)
┌───────────────────▼─────────────────────────┐
│  Servidor (Express) — 17 routers /api/*       │
│  ┌─────────────────────────────────────────┐ │
│  │  Motores puros (lib/)                    │ │
│  │  balance-math, finance, health,          │ │
│  │  services-math, portfolio, activity…     │ │
│  │  SIN base, SIN red → 100% testeables     │ │
│  └─────────────────────────────────────────┘ │
└───────────────────┬─────────────────────────┘
                    │ Prisma
┌───────────────────▼─────────────────────────┐
│  SQLite (un archivo local)                    │
└─────────────────────────────────────────────┘
```

**La idea clave:** la lógica difícil (todo lo que calcula plata) vive en **motores puros**
—funciones que reciben datos y devuelven resultados, sin tocar la base ni la red—. Eso
permite testearlos de verdad, con casos fijos, sin montar una base. La app tiene alrededor
de **223 tests** que corren en segundos, casi todos sobre estos motores.

---

## 4. El motor contable

Es el corazón. Vive en `lib/balance-math.ts` y `lib/finance.ts`.

**Cómo se calcula un saldo:** cada movimiento tiene un tipo, y cada tipo tiene un signo:

| Tipo | Signo | Qué es |
|---|---|---|
| INCOME | + | Ingreso (entra plata) |
| COLLECTION | + | Te devolvieron una deuda |
| EXPENSE | − | Gasto |
| DEBT_PAYMENT | − | Pagaste una deuda |
| INVESTMENT | − | Compraste una inversión (la plata se volvió activo) |
| TRANSFER | − | Sale de esta cuenta (entra en otra) |
| INTERNAL | 0 | Neutro |

El monto siempre se guarda en positivo; el signo lo pone el tipo. El saldo de una cuenta es
la suma de (monto × signo) de sus movimientos. Una transferencia resta en la cuenta de
origen y suma en la de destino, así que el patrimonio total no cambia (solo se movió plata
de un lado a otro).

**El patrimonio** (`patrimonio()`) junta todo, siempre en vivo:
- **Disponible** = suma de los saldos de las cuentas (por moneda).
- **Invertido** = valor de tus inversiones manuales + las tenencias sincronizadas de IOL.
- **Por cobrar** = deudas que te deben.
- **Deudas** = lo que debés.
- **Neto** = disponible + invertido + por cobrar − deudas.

El neto principal se lleva en pesos (la moneda base del mercado local). Lo que está en
dólares —efectivo o invertido— se muestra aparte, en sus propias tarjetas, para no inflar
un número mezclando monedas.

---

## 5. Los módulos

### Cuentas
Tus cuentas (banco, billetera, efectivo…), cada una con su moneda. El saldo de cada una se
deriva de sus movimientos. Podés tener cuentas en pesos y en dólares; nunca se suman entre sí.

### Movimientos (el Ledger)
El libro contable. Cada ingreso, gasto, transferencia, etc. es un movimiento con fecha,
monto, tipo, cuenta y categoría. Es la única fuente de verdad de la que sale todo lo demás.

### Importador
Uno de los módulos más trabajados. Toma extractos de banco/billetera (CSV, Excel, PDF) y
los convierte en movimientos. Cómo funciona:

1. **Lee el archivo** del lado de la interfaz (CSV, Excel o PDF).
2. **Encuentra el encabezado real**, esté donde esté. Los extractos suelen traer filas de
   preámbulo (banco, titular, período, número de cuenta) ANTES de la tabla. El importador
   las saltea y busca la fila que de verdad es el encabezado.
3. **Detecta qué es cada columna** por dos vías: primero por el nombre (reconoce muchísimos
   sinónimos: Fecha/Date/Fecha Movimiento/Transaction Date, Monto/Importe/Amount/Total,
   Débito/Egreso, Crédito/Ingreso, etc.), y lo que no resuelve por nombre lo infiere
   mirando los datos **por mayoría** (la columna que mayormente parece fecha ES la fecha,
   aunque haya alguna celda rara).
4. **Valida las columnas numéricas**: si una columna se llama "Ingreso" pero contiene texto
   (la fuente del ingreso, no un número), no la trata como plata — la pasa a descripción.
   Esto arregla los exports de Notion, donde la plata está en "Cantidad" y "Gasto"/"Ingreso"
   son texto.
5. **Infiere el tipo por el encabezado**: un archivo con columna "Gasto" son todos egresos;
   con "Ingreso", todos ingresos. Así importa planillas que no traen signo (la Cantidad
   siempre positiva) poniéndole el signo correcto a cada movimiento.
6. **Reconoce fechas en varios formatos**, incluidas las que traen nombre de mes ("16 de
   julio de 2026", "July 16, 2026", "16 Jul 2026").
7. **Deduplica**: cada fila genera un identificador propio; reimportar el mismo archivo dos
   veces no duplica nada. La deduplicación es en bloque (una sola consulta), así que aguanta
   archivos de miles de movimientos sin trabarse.
8. **Diagnóstico claro**: si algo no cierra, te dice exactamente qué columnas detectó y por
   qué descartó filas. Nunca un "no se reconoció nada" sin explicación.

Antes de guardar, siempre muestra un **preview**: banco/cuenta detectados, cuántos
movimientos, cuáles son nuevos vs. duplicados.

### Servicios y suscripciones
Los gastos que se repiten (alquiler, Netflix, etc.), con su frecuencia y día de
vencimiento. El sistema arma un calendario de vencimientos, y cuando aparece un movimiento
que coincide (mismo nombre + monto + fecha, los tres), lo marca como pagado
automáticamente. El **"disponible real"** del dashboard resta lo que todavía falta pagar
este mes, así ves cuánta plata tenés de verdad libre.

### Inversiones
Tus inversiones manuales y las tenencias que se sincronizan de IOL, juntas. Muestra:
- Los **totales por moneda** (ARS y USD por separado, nunca mezclados).
- Un **desglose por tipo de activo** con porcentajes: Acciones, CEDEARs, Bonos, Renta fija,
  ETF, Crypto. Unifica los nombres de IOL y los manuales bajo las mismas categorías.
- Cada posición con su ticker, cantidad, valor y ganancia. Las de IOL llevan un badge "IOL"
  (son de solo lectura, se sincronizan solas).

### Patrimonio
La foto de tu neto, con el desglose (disponible, invertido, deudas, por cobrar), la
distribución por cuenta y el historial. Todo separado por moneda.

### Objetivos inteligentes
Metas de ahorro. Pero no solo el progreso: el sistema calcula tu **ritmo real de ahorro**
(a partir de tus movimientos) y te dice cuánto te falta y **en cuántos meses llegás** si
seguís al mismo ritmo. Si le pusiste fecha límite, te avisa si vas en camino o tarde.

### Dashboard
La pantalla principal. Muestra:
- Tarjetas **vivas** de actividad: hoy ganaste, hoy gastaste, balance de la semana, balance
  del mes (con color: verde ingreso, rojo gasto).
- Las tarjetas de patrimonio (neto, disponible, invertido, deudas…), en pesos y en dólares.
- Salud financiera, gráficos de evolución, categorías, y los últimos movimientos.

### Los demás
- **Forecast** — proyección de los próximos meses según tu historial.
- **Reportes** — gráficos con datos reales; estados vacíos bien diseñados si no hay datos.
- **Timeline** — lo que pasó y los próximos vencimientos.
- **Presupuestos** — límites por categoría, con alertas cuando te acercás.
- **Insights** — observaciones automáticas ("a este ritmo cerrás el mes con X en tal
  categoría").
- **Deudas** — lo que debés y lo que te deben, con pagos parciales.
- **Salud Financiera** — un puntaje 0-100 explicable (no un número mágico: te dice de dónde
  sale).

---

## 6. Reactividad

Todo se actualiza solo. La interfaz usa un contador de versión de datos: cuando hacés
cualquier cambio (cargás un movimiento, importás, sincronizás), ese contador sube y todas
las pantallas que muestran datos vuelven a consultar. Un movimiento nuevo actualiza el
dashboard, el patrimonio, el timeline, el forecast, los objetivos, los servicios, los
insights, los reportes y las inversiones **sin que tengas que refrescar**.

Si una consulta falla (el servidor arrancando, un error puntual), la pantalla muestra un
mensaje claro con botón "Reintentar" — nunca se queda cargando para siempre.

---

## 7. Integraciones (bancos y brokers)

Viven en `integrations/`, con una interfaz común para todos los proveedores. Los tokens de
acceso se guardan **cifrados** (AES-256-GCM).

### IOL (Invertir Online)
- **Login una sola vez.** IOL usa usuario y contraseña para darte un token (válido 15
  minutos) + un refresh token. La contraseña se usa una vez para obtener los tokens y **no
  se guarda**. Después, el sistema renueva el token solo, usando el refresh token, y guarda
  los nuevos cifrados. No te vuelve a pedir usuario y contraseña.
- **Trae tus posiciones**: ticker, descripción, cantidad, precio promedio, precio actual,
  valor, moneda. Se guardan por **upsert** (nunca duplica). Impactan automáticamente en
  patrimonio, inversiones y dashboard.
- **Posiciones cerradas**: si vendés algo y desaparece de IOL, no se borra — se marca como
  cerrada y se conserva el historial. Si la recomprás, se reabre sola.
- **ARS y USD** no se descartan por moneda: se muestran separadas.
- **Motor de reconstrucción** (listo, testeado): dado el historial de operaciones, calcula
  costo promedio, ganancia realizada y no realizada, y renta cobrada. Falta cablearlo en
  vivo (ver pendientes).

### Mercado Pago
- El flujo completo (OAuth: te lleva a autorizar, vuelve con un código, se cambia por
  tokens, se refresca solo) **está implementado**. Trae saldo y movimientos (hasta 12 meses,
  que es el máximo que da Mercado Pago).
- Para usarlo hace falta que vos crees una aplicación en Mercado Pago Developers y cargues
  dos credenciales (Client ID y Client Secret) en la configuración. Eso solo lo podés hacer
  vos (son de tu cuenta). Si falta una variable, el sistema te dice exactamente cuál.

### Cómo sincroniza
Al abrir la app, sincroniza sola. Cada sync trae lo nuevo (deduplicando por identificador),
persiste las tenencias, y deja logs completos (posiciones recibidas / nuevas / actualizadas
/ cerradas). Un movimiento que viene raro no tira abajo la sync entera: se cuenta y se sigue.

---

## 8. Multi-moneda

Cada cuenta e inversión tiene su moneda. El sistema:
- Suma cada moneda por separado (disponible ARS, disponible USD, invertido ARS, invertido
  USD…).
- Nunca convierte ni inventa un tipo de cambio.
- Muestra los totales de cada moneda en sus propias tarjetas.

**Lo que todavía falta** (ver pendientes): traer el precio del dólar para poder mostrar el
patrimonio también en dólares y reflejar cómo cambia cuando el dólar se mueve.

---

## 9. Migraciones de base

Cuando la estructura de la base cambia (una columna nueva, una tabla nueva), hay que
actualizar las bases que ya existen sin perder datos. El sistema usa un esquema de
**versiones**: cada cambio es una migración numerada, y la base recuerda en qué versión
está. Al abrir la app, aplica las que falten, **en una transacción** (todo o nada: una
migración a medio aplicar no puede existir). Si algo falla, la base queda intacta en la
versión anterior y te dice qué pasó.

---

## 10. Testing y estabilidad

La filosofía es **estabilidad y exactitud antes que features**. Un dato financiero mal es
peor que una función que falta.

- ~223 tests en el servidor + 7 de migraciones, todos verdes.
- Cubren lo que más importa: la matemática de saldos, el costo promedio de inversiones, la
  detección del importador (con archivos reales de Galicia, Santander, Macro, Brubank,
  Notion…), la deduplicación, la salud financiera, la detección de pagos de servicios, el
  desglose por tipo, y las ventanas de actividad.
- Cada cambio se verifica: tests, TypeScript, y lint sin errores.

Cuando algo no se puede terminar bien (por ejemplo, cablear en vivo algo que necesita una
API real que no se puede probar sin tus credenciales), se deja **claramente identificado
para más adelante** en vez de meter una solución a medias.

---

## 11. Build y empaquetado

La app se compila para Windows, macOS Intel y Apple Silicon. Puntos resueltos en el camino:
- Prisma se genera antes de compilar (si no, faltan tipos).
- El empaquetado de Electron requirió ajustes específicos (resolución de módulos, firma en
  macOS, rutas con espacios en Windows).
- Hay una verificación que corta el build si las dependencias declaradas no coinciden con
  las instaladas.

---

## 12. Seguridad y privacidad

- **Todo es local.** La base es un archivo en tu máquina. Nada se sube a ningún lado.
- Los tokens de bancos/brokers se guardan **cifrados**.
- Las conexiones a bancos son de **solo lectura**: Finance OS nunca opera (no compra, no
  vende, no transfiere). En el caso de IOL, el permiso que da su API es amplio (permite
  operar), pero la app nunca lo usa para eso.

---

## 13. Estado actual y qué falta

### Funcionando
Todo el flujo diario: crear cuentas, importar extractos (con detección inteligente),
registrar movimientos, ver patrimonio por moneda, servicios con vencimientos, inversiones
con desglose por tipo, objetivos inteligentes, dashboard vivo, forecast, reportes,
presupuestos, salud financiera. IOL sincroniza posiciones e impacta en todo. Mercado Pago
tiene el flujo completo listo (falta que cargues tus credenciales).

### Pendiente
1. **Precio e historial del dólar.** Es la pieza que desbloquea varias cosas de una vez:
   mostrar el patrimonio en ambas monedas, el gráfico del dólar (MEP), la evolución real del
   patrimonio cuando el dólar se mueve, la variación diaria, y elegir moneda principal.
   Necesita una fuente externa (dolarapi o similar) que la app consulta desde tu máquina.
2. **IOL historial en vivo.** El motor de reconstrucción está listo y testeado; falta
   cablearlo (traer las operaciones, guardarlas como un libro de inversiones separado para
   no duplicar patrimonio) y verificarlo con datos reales de tu cuenta.
3. **Categorías con iconos** — elegir un emoji por categoría.
4. **Asistente de mapeo manual** de columnas para el importador, con memoria por banco (hoy
   la detección automática es robusta y el diagnóstico dice qué revisar, pero no hay un
   asistente visual todavía).

---

*Finance OS — sistema de finanzas personales, local y verificado. Documento de referencia
del funcionamiento general.*
