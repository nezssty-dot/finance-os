# Soporte de USD + inventario del pedido "Versión 1.0"

Dos cosas en esta entrega: **soporte de dólares bien hecho** (lo que pediste explícito),
y un repaso honesto del documento de V1.0 —porque casi todo ya está construido, y tu
propia instrucción fue "estabilidad primero, no agregar nada que rompa lo existente".

---

## USD: hecho, y sin romper nada

Ya se podían crear cuentas en USD (el form ya lo permitía). El problema era que **nada
más lo respetaba**. Se arregló toda la cadena:

### El riesgo que había (y por qué importaba)

`netWorth` sumaba **todos los saldos en un solo número, sin mirar la moneda**. El minuto
que cargabas una cuenta en dólares, tu "disponible" pasaba a ser pesos + dólares sumados
como si fueran lo mismo. 1.000.000 ARS + 500 USD = "1.000.500" de nada.

Es el mismo tipo de error que ya evitamos en los servicios (no mezclar monedas) y en el
ledger (no guardar saldos). Un número que mezcla monedas es peor que no mostrarlo: parece
correcto y no lo es.

### Cómo quedó

- **El patrimonio nunca mezcla monedas.** `balancesByCurrency()` (función pura, testeada)
  separa cada moneda en su propio total. El "Disponible" del dashboard es **solo ARS** —
  para quien usa solo pesos, nada cambió, cero regresión. Si tenés dólares, aparecen en
  su propia tarjeta ("Disponible USD"), nunca sumados a los pesos.
- **No hay tipo de cambio inventado.** No se convierte USD a ARS para dar un "total
  único", a propósito: en Argentina hay varios dólares (oficial, blue, MEP, CCL), y hornear
  una cotización volátil dentro del patrimonio daría un número discutible y desactualizado.
  Las monedas se muestran separadas, exactas, siempre. (Si algún día querés un total
  aproximado combinado, se puede agregar con una cotización que cargues vos y quede
  marcada como aproximada — pero la fuente de verdad sigue siendo por moneda.)
- **Todo se formatea en su moneda.** Antes el helper `ARS()` estaba clavado en pesos: una
  cuenta en dólares mostraba "$500" como si fueran pesos. Ahora hay `money(monto, moneda)`
  y se usa en cuentas, dashboard y servicios. USD se ve "US$ 500", con centavos (en dólares
  los centavos importan; en pesos no).
- **Los movimientos heredan la moneda de su cuenta.** Un movimiento (manual o importado) en
  una cuenta en dólares es en dólares, aunque el form mande el default ARS. Sin esto, el
  saldo de la cuenta (USD) no cerraba con sus propios movimientos (marcados ARS).
- **Las transferencias entre monedas distintas se bloquean**, con un mensaje claro. Una
  transferencia credita al destino exactamente lo que sale del origen (para que el
  patrimonio no se mueva); entre monedas distintas eso inventaría plata. En vez de adivinar
  un tipo de cambio, se te pide cargar el cambio como un gasto en una moneda y un ingreso
  en la otra, con los montos reales de cada lado. Es lo honesto.

### Tests

4 tests nuevos que blindan la separación de monedas (en `finance.test.ts`, ahora 15).
Además se ejerció un escenario real de punta a punta: pesos en Mercado Pago + dólares
guardados aparte → el dashboard muestra "994.500 ARS" y "US$ 700" separados, y el número
mezclado (995.200, sin sentido) no aparece por ningún lado.

**Total de la suite: 145 tests, todos verdes.** Typecheck limpio en los tres proyectos.

---

## El documento "Versión 1.0": qué ya está

Casi todo esto ya se construyó en los sprints anteriores. Lo repaso para que no
reconstruyamos lo que anda.

### Ya funciona
- **Importador multiformato con detección**: CSV, Excel, PDF ya andan. Detecta delimitador,
  decimal (coma/punto), formato de fecha y origen del archivo (banco/billetera) solo.
- **Mapeo automático de columnas**: reconoce Fecha/Descripción/Monto aunque cambie el orden.
- **Resumen antes de importar con duplicados**: la vista previa ya dice "X nuevos, Y ya
  estaban". La deduplicación por hash de contenido ya existe (31 tests).
- **Cada movimiento pertenece a una cuenta**: ya es así.
- **Patrimonio automático** (disponible + inversiones + cuentas − deudas + por cobrar): ya
  se deriva en tiempo real, nunca se guarda. Ahora además separa monedas.
- **Sincronización de cuentas conectadas**: el scheduler ya sincroniza Mercado Pago e IOL
  por intervalo, trayendo solo lo nuevo, y toda la app se actualiza sola (dataVersion).
- **No pantallas vacías**: las páginas ya tienen estados vacíos con indicaciones para
  empezar.

### Lo que falta de verdad (en orden de valor)
1. **Sincronizar al ABRIR la app** (además del intervalo). El scheduler corre cada X; falta
   el disparo al arranque. Es directo, pero toca la coordinación Electron→server al boot, y
   no lo puedo probar de punta a punta en este entorno (Prisma necesita un binario que acá
   está bloqueado). Con "estabilidad primero" como norte, prefiero hacerlo con la app
   corriendo para verificar que no cuelga el arranque, antes que meterlo a ciegas.
2. **IOL → patrimonio**: el conector ya trae los holdings, pero `patrimonio()` todavía suma
   la tabla `Investment`, no `Holding`. Es el mismo gap que venía de antes. Cuando se cierre,
   las inversiones de IOL impactan el patrimonio en vivo.
3. **Formatos OFX/QFX/JSON** en el importador: la arquitectura ya está lista (un importer =
   un archivo), faltan esos tres parsers.
4. **Asistente de mapeo manual** cuando la detección falla, con memoria de la config: hoy la
   detección es automática y buena, pero no hay un wizard para el caso raro que no reconoce.

### Placeholders / gráficos de ejemplo cuando no hay datos
El doc pide "gráficos de ejemplo cuando no hay movimientos". Hoy hay estados vacíos con
texto, no gráficos fantasma. Es una decisión defendible: un gráfico con datos inventados
puede confundir (parece que ya tenés datos). Si lo querés igual, se hace — pero lo dejo
anotado como decisión, no como olvido.

---

## Sobre "que aprenda del comportamiento" (varios puntos del doc)

Los insights actuales son **reglas sobre tus datos reales** (gastaste X% más, tal servicio
aumentó, tenés N servicios por Y al mes), no un modelo que aprende. Está bien así, y es a
propósito: para finanzas personales, reglas explicables le ganan a una caja negra. Cuando
un número te sorprende, podés ver exactamente de dónde sale. Un "modelo que aprende" de
verdad es otro proyecto y, para esto, no lo veo como mejora.
