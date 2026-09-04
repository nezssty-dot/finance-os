# Consolidación del menú (20 → 13 secciones)

## El problema

El sidebar era un riel angosto de solo íconos con 19 ítems (18 pantallas + Dashboard).
En una ventana baja — típico en Windows, donde la barra de tareas se come parte del
alto disponible — los últimos íconos (Auditoría, Configuración) quedaban tapados: no
había scroll de respaldo y el cálculo de "cuántos íconos entran sin recortarse" se
hacía corto en esa plataforma.

Además, con 19 ítems repartidos en 5 grupos, la navegación era difícil de recorrer de
un vistazo — demasiadas secciones para una app que se supone simple de usar.

## La solución

Dos cambios independientes, uno arriba del otro:

1. **El riel ahora scrollea si hace falta** (`overflow-y-auto` en `Sidebar.tsx`), así
   que aunque algún día vuelva a haber más ítems de los que entran, nunca más se
   recortan en silencio — en la peor ventana, aparecen con scroll.

2. **Se juntaron 5 pantallas dentro de la más relacionada**, sacándolas del ícono
   propio del menú y dejándolas alcanzables con un link directo desde su pantalla
   madre. Ninguna ruta se borró — siguen andando igual, solo que ya no compiten por
   espacio en el riel:

   | Pantalla        | Vive dentro de   | Cómo se llega                              |
   |------------------|------------------|---------------------------------------------|
   | Timeline         | Movimientos      | Link "Timeline" en la barra superior         |
   | Importar         | Movimientos      | Link "Importar" en la barra superior         |
   | Categorías       | Configuración    | Link "Categorías" en la barra superior       |
   | Auditoría        | Configuración    | Link "Auditoría" en la barra superior        |
   | Forecast         | Insights         | Link "Forecast" en la barra superior         |

   El sidebar quedó en 13 íconos: Dashboard, Movimientos, Servicios, Cuentas, Meses,
   Patrimonio, Inversiones, Deudas, Presupuestos, Objetivos, Insights, Reportes,
   Configuración.

## Por qué así y no con pestañas adentro de una sola pantalla

Fusionar de verdad el contenido de dos pantallas en pestañas (por ejemplo, que
Movimientos tenga una pestaña "Timeline") es más lindo pero mucho más trabajo y
riesgo: hay que reescribir el layout interno de las dos pantallas para que compartan
un mismo marco. La versión con link directo logra el objetivo real — sacar íconos del
riel, bajar la carga cognitiva del menú — sin tocar la lógica interna de ninguna
pantalla que ya funciona. Si más adelante se quiere la versión con pestañas de verdad,
esto es un punto de partida seguro: las rutas y los datos no cambiaron, solo cómo se
llega a ellas.

## Cómo se marca "estás acá"

`Sidebar.tsx` tiene un mapa `parentOf` que dice, para cada pantalla hija, cuál ícono
del riel se enciende cuando estás ahí (ej: estando en `/timeline`, se enciende
"Movimientos"). Si en algún momento se agrega otra pantalla hija, hay que sumarla ahí
también — si no, el riel se queda sin nada resaltado y se pierde la orientación.
