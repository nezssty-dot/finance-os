# Fix del build (Windows / Mac / CI)

## La causa raíz

Los errores que veías —
```
Module "@prisma/client" has no exported member "Debt"
Module "@prisma/client" has no exported member "Goal"
Module "@prisma/client" has no exported member "User"
Prisma.MovementWhereInput no existe
+ decenas de TS7006
```
**no eran errores del código.** Eran la firma exacta de que **`prisma generate` no se
ejecutaba antes de compilar el server.**

`Debt`, `Goal`, `User` y `Prisma.MovementWhereInput` son tipos que Prisma **genera** a
partir de `schema.prisma`. Si el cliente no está generado, `@prisma/client` no los exporta.
Y los TS7006 (`map`, `filter`, `reduce`, `find`…) eran consecuencia de lo mismo: sin el
cliente generado, `prisma.account.findMany()` devuelve `any`, entonces `.map((a) => …)`
no puede inferir el tipo de `a`. **Con el cliente generado, todos infieren solos, sin
`any`.** (Se auditó: los 31 TS7006 iteran sobre resultados de Prisma; ninguno necesita
anotación manual.)

## Dónde estaba el bug

En `electron/scripts/build.mjs`, el orden era:

```
1. npm run build (server)   ← tsc compila el server
2. npm run build (client)
3. prepare.mjs
4. npm run prisma:generate  ← Prisma se generaba DESPUÉS
```

El server compilaba en el paso 1, cuando el cliente de Prisma todavía no existía. Y lo
mismo con `npm run build` y `npm run typecheck` directos: `server/build` era solo `tsc`
y `server/typecheck` solo `tsc --noEmit` — ninguno generaba Prisma antes.

## El fix (causa raíz, sin workarounds)

**`prisma generate` ahora es prerequisito de compilar y typechequear el server.** En
`server/package.json`:

```json
"build":     "prisma generate && tsc",
"typecheck": "prisma generate && tsc --noEmit"
```

Como el `build.mjs` de electron llama a `npm run build` del server, y el CI y vos también,
**el cliente ahora se genera antes de cualquier compilación, en todas las entradas**:
`npm run build`, `npm run typecheck`, `npm run dist:win`, `npm run dist:mac`, `npm run dist`.

Sin `ts-ignore`, sin `eslint-disable`, sin `any`, sin tocar `strict` ni `noImplicitAny`.
Los callbacks infieren sus tipos desde el retorno de Prisma.

## Scripts que faltaban

Se agregaron `dist:mac` y `dist` (no existían):

| Comando | Qué hace |
|---|---|
| `npm run dist:win` | Empaqueta para Windows |
| `npm run dist:mac` | Empaqueta para la Mac del host (arch nativa) |
| `npm run dist` | Empaqueta para el SO del host |
| `npm run dist:mac:intel` | Mac Intel (x64) — ya existía |
| `npm run dist:mac:arm` | Mac Apple Silicon (arm64) — ya existía |

## Los 8 comandos que pediste

Todos existen y están correctamente encadenados:

```
npm install       ✓
npm run build     ✓  (genera Prisma → compila server + client)
npm run dist:win  ✓  (genera Prisma → empaqueta Windows)
npm run dist:mac  ✓  (genera Prisma → empaqueta Mac)
npm run dist      ✓  (genera Prisma → empaqueta host)
npm test          ✓  (145 tests)
npm run lint      ✓  (0 errores)
npm run typecheck ✓  (genera Prisma → tsc en server/client/electron)
```

## Verificación

Se verificó en este entorno todo lo que **no** depende del engine nativo de Prisma:

| Paso | Resultado |
|---|---|
| Server tests (145) | ✓ exit 0 |
| Lint (0 errores) | ✓ exit 0 |
| Electron typecheck | ✓ limpio |
| Electron test (migraciones, 7) | ✓ 7/7 |
| Cliente build (tsc -b && vite build) | ✓ exit 0 |
| Cliente typecheck | ✓ limpio |
| Server: análisis de errores | ✓ solo firma Prisma-sin-generar (0 errores reales) |

**Nota honesta sobre la verificación del server:** el entorno donde se preparó esta
corrección **bloquea por red** el dominio de descarga del engine de Prisma
(`binaries.prisma.sh`), así que `prisma generate` no puede ejecutarse acá. Por eso el
server typecheck/build no se pudo correr *empíricamente* en este entorno. En cambio se
verificó por análisis exhaustivo: se listaron **todos** los errores del server y se
confirmó que son **exclusivamente** la firma de "Prisma sin generar" (tipos de modelos y
de resultados de queries), sin un solo error real de tipos (ni campos inexistentes, ni
objetos mal formados). En tu entorno —Windows, Mac, GitHub Actions— el dominio está
accesible, `prisma generate` corre, y esos errores desaparecen.

Si al compilar en tu máquina apareciera **cualquier** error que NO sea de Prisma-sin-generar,
avisame el mensaje exacto y lo corrijo — pero según el análisis, no debería quedar ninguno.
