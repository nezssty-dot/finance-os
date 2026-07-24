# IOL historial + Mercado Pago + Importador — estado

Entrega honesta. Construí lo que se puede hacer **bien y verificado**, y te explico con
precisión qué queda y por qué, porque esto toca tu patrimonio y un dato mal es peor que
una función que falta.

---

## Lo que quedó hecho y probado

### Motor de reconstrucción de cartera (`server/src/lib/portfolio.ts`) — 19 tests

Dado el historial de operaciones, reconstruye todo lo que pediste, con matemática
determinística y testeada:

- **Posiciones** por activo (cantidad neta de compras − ventas).
- **Costo promedio (PPC)** ponderado — el mismo método que usa IOL.
- **Capital invertido** por moneda (ARS y USD separados, nunca mezclados).
- **Ganancia/pérdida realizada** (de las ventas).
- **Ganancia/pérdida no realizada** (`unrealizedPnL`, contra el precio actual).
- **Renta cobrada** (dividendos, intereses, cupones).
- Un **ledger** con cada operación, su fecha original, y su signo correcto.

Está testeado en lo que más importa: costo promedio ponderado, ventas parciales, vender
todo y reabrir (PPC nuevo sin arrastrar el viejo), pérdidas, monedas separadas, y
robustez ante historial incompleto.

### Mapper de operaciones de IOL (`.../iol/mapping.ts`) — 7 tests

Traduce la respuesta de `GET /api/v2/operaciones` a operaciones normalizadas, clasificando
compra / venta / suscripción / rescate / dividendo / cupón / interés / etc. Es tolerante a
que IOL varíe mayúsculas o nombres de campo.

### Mercado Pago: diagnóstico exacto (requisito #10)

El mensaje genérico "no está configurado" ahora dice **exactamente qué variable falta**
(`MP_CLIENT_ID` y/o `MP_CLIENT_SECRET`), apunta a Mercado Pago Developers, e informa la
Redirect URI que hay que registrar.

**171 tests en total, todos verdes. Lint y typecheck limpios.**

---

## Lo que NO hice, y por qué (esto es importante)

### IOL: registrar compras/ventas en el Ledger de caja

Encontré un problema de correctitud real, no un detalle. El modelo de Finance OS deriva
los saldos de los movimientos, con este signo:

```
INVESTMENT: −1  (sale plata)      INCOME: +1  (entra plata)
```

- Una **compra** encaja perfecto: INVESTMENT, sale plata. ✓
- Una **venta** trae plata (necesita +1), y **no existe un tipo "venta" con signo +**.
- Peor: la cuenta de IOL **ya reporta su saldo** (por `estadocuenta`) y sus **tenencias**
  (por el portfolio). Si además inyecto cada compra/venta como movimiento de caja,
  **duplico el conteo** contra esas dos fuentes y te corrompo el patrimonio.

**Por esto exactamente el código original tenía `movements: false`.** No es un olvido: es
una decisión correcta. Inyectar las operaciones a ciegas, sin poder probarlo contra tu
cuenta real, tenía riesgo concreto de mostrarte un patrimonio equivocado. En una app de
plata, eso es peor que no tener la función todavía.

**Lo que falta decidir (juntos):** cómo registrar las operaciones sin romper la
reconciliación. La forma correcta que recomiendo es un **modelo de lectura separado**: las
operaciones alimentan la reconstrucción (posiciones, realizado, no realizado, evolución)
como una vista de inversiones, **sin** tocar la derivación del saldo de caja —que sigue
viniendo de `estadocuenta`, que es la fuente autoritativa. Así ves todo lo que querés sin
duplicar nada.

**Lo que necesito de vos para cerrarlo con seguridad:** una respuesta real de
`GET /api/v2/operaciones` de tu cuenta (podés borrarle los números sensibles, solo
necesito ver los **nombres de los campos** y un par de filas de ejemplo). Con eso ajusto el
mapper a la forma real —hoy está basado en la documentación, que a veces difiere— y lo
verifico de punta a punta. Sin datos reales, cablearlo sería adivinar.

### Mercado Pago: el flujo ya está, falta TU configuración

El OAuth completo **ya está implementado** (authorization → code → token → refresh, con el
límite de 12 meses). No es un problema de código. Lo que falta es configuración que **solo
vos podés hacer** (son credenciales de tu cuenta):

1. Entrá a https://www.mercadopago.com.ar/developers y creá una aplicación.
2. Copiá el **Client ID** y el **Client Secret**.
3. En la app de MP, registrá la Redirect URI:
   `http://localhost:4000/api/integrations/mercadopago/callback`
4. Cargá estas variables de entorno donde corre el server:
   ```
   MP_CLIENT_ID=tu_client_id
   MP_CLIENT_SECRET=tu_client_secret
   MP_REDIRECT_URI=http://localhost:4000/api/integrations/mercadopago/callback
   ```
5. Reiniciá. El botón "Conectar" ya va a funcionar (y si falta una variable, ahora te dice
   exactamente cuál).

### Importador: necesito el caso que falla

El importador tiene 31 tests que pasan y arquitectura sólida (CSV, Excel, PDF, con
detección de formato y deduplicación). No pude reproducir un bug real sin tu archivo
específico. Reescribir a ciegas algo que anda es la forma más rápida de romperlo.

**Para arreglarlo:** pasame el archivo que no te deja importar (o el mensaje de error
exacto que ves). Con eso identifico el problema real —puede ser que tu banco/MP use un
formato que el detector todavía no reconoce, que es un ajuste chico y puntual.

---

## Honestidad sobre la verificación

No puedo probar contra las APIs reales de IOL ni de Mercado Pago desde donde preparo esto:
necesitan tus credenciales y acceso de red a esos servidores. Todo lo que es **lógica pura**
(la reconstrucción, el mapper, la matemática) está testeado y es correcto. Lo que es
**fetch contra la API real** lo dejé estructurado y claro, pero su verificación final la
tenés que hacer vos con tu cuenta —y con los datos reales que te pido arriba, lo cierro
bien en la próxima.
