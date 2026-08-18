# Finance OS

Sistema operativo financiero personal. Aplicación de escritorio para Windows, macOS y Linux.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | React 18 · TypeScript · TailwindCSS · Recharts · Framer Motion · Zustand |
| Backend | Express · TypeScript · Prisma · SQLite |
| Escritorio | Electron 32 · electron-builder 25 |
| Integración | Mercado Pago OAuth (sync paginada, clasificación que aprende) |

## Instalar y correr

```bash
npm run install:all     # instala server + client + electron

npm run db:setup        # crea la base (solo la primera vez)
npm run db:seed         # opcional: usuario demo con datos reales 2026

npm run dev:api         # terminal 1 → API en :4000
npm run dev:web         # terminal 2 → React en :5173
```

Usuario demo: `demo@financeos.app` / `demo1234`

## Generar los instaladores

```bash
npm run dist:mac:intel   # → Finance OS Intel.dmg          (solo en macOS)
npm run dist:mac:arm     # → Finance OS Apple Silicon.dmg  (solo en macOS)
npm run dist:win        # → electron/release/*.exe
```

**Cada plataforma se compila en su propia plataforma** (el motor de Prisma es un
binario nativo). Para las tres de una sola vez, usá el CI: `git tag v1.0.0 && git push --tags`.

👉 **Guía completa de compilación: [BUILD.md](BUILD.md)**

## Pantallas

- **Dashboard** — patrimonio neto, evolución del ahorro, insights, categorías, movimientos
- **Meses** — 12 tarjetas con gauge de % gastado + detalle con exportación a PDF
- **Patrimonio** — balance mensual, cuentas, deudas, evolución
- **Inversiones** — pesos, USD, USDT, BTC, ETH, acciones, fondos, plazos fijos
- **Forecast** — proyección ponderada de ingreso, gasto, ahorro y patrimonio
- **Integraciones** — Mercado Pago + 6 conectores preparados

## Dónde viven tus datos

Fuera del paquete de la app, así sobreviven a reinstalaciones:

| Sistema | Ruta |
|---|---|
| macOS | `~/Library/Application Support/Finance OS/` |
| Windows | `%APPDATA%\Finance OS\` |
| Linux | `~/.config/Finance OS/` |

## Seguridad

Rate limiting · tokens de Mercado Pago cifrados con AES-256-GCM · refresh token en
cookie httpOnly rotativa · access token solo en memoria · bcrypt 12 rounds ·
límite de body 1MB · secrets validados en producción.
