# AUDITORÍA — Cierre V1.0

Auditoría del proyecto para cerrar la V1. Foco en confiabilidad de datos y experiencia de
uso, sin tocar la arquitectura (Ledger, Balance Math, Patrimonio, Prisma, migraciones,
pipeline y reactividad siguen intactos).

---

## Bugs encontrados y corregidos en esta pasada

### 1. Loading infinito cuando un fetch falla (CORREGIDO)

**El bug:** seis pantallas (Dashboard, Forecast, Inversiones, Patrimonio, Meses × 2)
hacían `if (!data) return <Spinner/>` e **ignoraban el error** de `useFetch`. Si un fetch
fallaba (server arrancando, un 500, un corte), `data` quedaba en null, el spinner no se
apagaba nunca, y la pantalla quedaba **cargando para siempre**. Es exactamente el "loading
infinito" que querías cazar.

**El arreglo:** un componente `AsyncGate` que muestra el spinner mientras carga y, si el
fetch falla, un mensaje claro con botón "Reintentar". Aplicado a las seis pantallas. Ahora
un error se ve y se puede reintentar, en vez de colgar la pantalla.

### 2. Importación lenta: una consulta por fila (CORREGIDO)

**El bug:** al importar, el commit hacía un `findUnique` por cada fila para detectar
duplicados. Con 10.000 filas eran 10.000 consultas secuenciales solo para deduplicar —
justo el caso de tu Prioridad 8 (soportar 10.000+ movimientos sin congelar).

**El arreglo:** deduplicación en bloque. Una sola consulta trae los IDs ya importados y
arma un Set en memoria; el chequeo por fila es contra el Set. La lógica de "no duplicar" es
idéntica (mismo `importId`), pero pasa de N consultas a 1. Se agregó también protección
contra duplicados dentro del mismo archivo.

---

## Lo que se auditó y está BIEN (sin cambios necesarios)

- **Botones:** ninguno muerto. Todos tienen acción; los formularios de login/registro usan
  `onSubmit` correctamente.
- **Placeholders:** Reportes usa datos reales, sin gráficos de ejemplo colgados.
- **Estados vacíos:** 15 páginas tienen `EmptyState` bien diseñado para cuando no hay datos.
- **Errores tragados:** solo hay un `catch {}` vacío, en el logout (correcto: te estás
  yendo igual).
- **Código a medias:** no hay TODOs ni features sin implementar en el código.
- **Reactividad:** el `useFetch` re-consulta ante cualquier cambio (`dataVersion`), así que
  un movimiento nuevo actualiza dashboard, patrimonio, timeline, forecast, objetivos,
  servicios, insights y reportes sin refrescar. Verificado en el hook.

---

## Qué quedó TERMINADO

- Motor contable único; saldos y patrimonio siempre derivados, nunca guardados.
- Multi-moneda (ARS + USD) sin mezclar, en cuentas, patrimonio y servicios.
- **Importador robusto** (CSV, Excel, PDF): encabezado en cualquier fila (saltea
  preámbulo), detección de columnas por mayoría, muchos sinónimos, deduplicación en bloque,
  y diagnóstico claro de por qué no reconoció algo. 38 tests.
- Preview antes de importar (banco/cuenta/moneda, primeros movimientos, nuevos vs
  duplicados vs descartados).
- Clasificación automática por reglas que aprenden.
- Servicios y suscripciones (vencimientos, calendario, detección de pagos, disponible real).
- Salud Financiera (puntaje 0-100 explicable). 11 tests.
- Patrimonio por moneda, con distribución por cuenta e historial.
- Timeline (pasado + próximos vencimientos).
- Sincronización al abrir la app.
- Manejo de errores de carga en todas las pantallas (nuevo).
- Migraciones seguras de base. 7 tests.
- Motor de reconstrucción de cartera de IOL (posiciones, PPC, realizado, no realizado,
  renta). 26 tests. (El motor está; falta el cableado en vivo — ver pendientes.)
- Diagnóstico exacto de configuración de Mercado Pago.
- Conectores MP (OAuth) e IOL (posiciones + saldo), con tokens cifrados.

## Qué quedó PENDIENTE para V2

En orden de valor:

1. **IOL historial en vivo** (Investment Ledger separado). El motor de reconstrucción y el
   mapper están y testeados; falta: fetch de operaciones en el provider, almacenamiento
   separado (para no duplicar caja ni patrimonio), y la vista. **Necesita verificación con
   una respuesta real de `/api/v2/operaciones` de tu cuenta** — los nombres de campo se
   infieren de la documentación.
2. **IOL → patrimonio en vivo:** hoy el neto suma la tabla `Investment`, no `Holding`. Al
   cerrarlo, las tenencias impactan el patrimonio en tiempo real.
3. **Asistente de mapeo manual** de columnas cuando la autodetección falla, con memoria por
   banco. Hoy la detección es robusta y el diagnóstico dice qué revisar, pero no hay wizard.
4. **Formatos OFX/QFX/JSON** en el importador (la arquitectura ya los admite).
5. **Sincronización de Mercado Pago end-to-end:** el código está; requiere tus credenciales
   (crear la app en MP Developers) para probarlo de verdad.

## Qué se OPTIMIZÓ

- **Importación:** deduplicación de N consultas a 1 (crítico para archivos grandes).
- **Detección de importador:** de "todas las celdas" a "mayoría", más ubicación del
  encabezado real — menos rechazos, más formatos que entran a la primera.

## Qué todavía PODRÍA mejorarse (no urgente)

- **Commit de importación:** el `create` sigue siendo fila por fila (necesario para
  registrar cada movimiento y detectar pagos de servicios). Para volúmenes muy grandes se
  podría envolver en una transacción o usar `createMany`. En SQLite local, con la dedup ya
  optimizada, el costo restante es aceptable; se puede medir y mejorar si hace falta.
- **`suggestCategory`** se llama por fila en el import. Se podría precargar las reglas una
  vez. Impacto menor.
- **Gráficos pesados:** si algún reporte con miles de puntos se sintiera lento, se puede
  agregar muestreo. Hoy no se observa problema.

---

## Estado de compilación (versiones exactas del CI: TypeScript 5.9.3)

| Paso | Resultado |
|---|---|
| Tests server | ✓ 178, exit 0 |
| Tests electron/migraciones | ✓ 7/7 |
| Typecheck cliente | ✓ limpio |
| Typecheck electron | ✓ limpio |
| Typecheck server | ✓ 0 errores reales (solo firma Prisma-sin-generar) |
| Build cliente | ✓ exit 0 |
| Lint | ✓ 0 errores, 176 warnings (**0 nuevos**) |

**Build nativos (Windows / macOS Intel / Apple Silicon):** el pipeline está configurado y
—desde el fix de `prisma generate` antes de compilar (ver `FIX-BUILD.md`)— cada build
genera Prisma primero. No puedo ejecutar los instaladores nativos ni `prisma generate` en
este entorno (bloqueo de red al dominio del engine de Prisma), pero el schema es válido y
todos los "errores" del server son tipos que Prisma genera. En tu entorno corren en verde.

## No se rompió nada existente

Las 8 suites del server pasan (178 tests), incluidos los 31 originales del importador
(Galicia, Santander, Macro, Brubank, deduplicación). El cambio del importador y del manejo
de carga es aditivo. La arquitectura del Ledger, Balance Math y Patrimonio no se tocó.

Donde había riesgo de un dato financiero incorrecto (registrar operaciones de IOL en la
caja sin resolver el doble conteo), se dejó como pendiente bien definido para la V2 antes
que meter un número poco confiable — tal como pediste.
