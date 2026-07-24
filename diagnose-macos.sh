#!/bin/bash
# Diagnóstico de macOS — CORRELO EN TU MAC.
#
# Yo no tengo una Mac. No puedo montar un DMG, ni correr codesign, ni abrir la app.
# Todo lo que te reporté como "verde" verificaba el EMPAQUETADO, nunca que la app abra.
# Esa diferencia es la que te viene quemando.
#
# Esto cierra el loop: te dice EXACTAMENTE qué está roto, y distingue los dos problemas
# que macOS confunde bajo el mismo mensaje de "dañado":
#
#   A. FIRMA ROTA          → la app está genuinamente rota. Es culpa nuestra. Se arregla.
#   B. CUARENTENA          → la app está bien, macOS la bloquea por no estar notarizada.
#                            Solo se saca pagando US$99/año, o con un comando.
#
# Uso:
#   bash diagnose-macos.sh "/ruta/al/Finance OS Intel.dmg"
#   bash diagnose-macos.sh "/Applications/Finance OS.app"

set -uo pipefail

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "Uso: bash diagnose-macos.sh <ruta al .dmg o al .app>"
  exit 1
fi

if [ "$(uname)" != "Darwin" ]; then
  echo "Esto tiene que correr en una Mac."
  exit 1
fi

line() { printf '─%.0s' {1..66}; echo; }
ok()   { echo "  ✅ $1"; }
bad()  { echo "  ❌ $1"; }
warn() { echo "  ⚠️  $1"; }

echo
line
echo "  DIAGNÓSTICO — $(basename "$TARGET")"
line

APP=""
MOUNT=""

# ─────────────────────────────────────────────────────────────
# Si es un DMG: primero ver si es válido y si monta
# ─────────────────────────────────────────────────────────────
if [[ "$TARGET" == *.dmg ]]; then
  echo
  echo "▸ 1. ¿El DMG es un archivo válido?"
  echo

  if hdiutil verify "$TARGET" > /tmp/dmg-verify.log 2>&1; then
    ok "El DMG es estructuralmente válido (hdiutil verify pasó)."
    echo "     → Si no monta, NO está corrupto. Es la cuarentena."
  else
    bad "El DMG está CORRUPTO."
    sed 's/^/       /' /tmp/dmg-verify.log | head -6
    echo
    echo "     → El archivo se dañó al generarse o al descargarse."
    echo "       Si lo bajaste de GitHub Actions, viene adentro de un .zip:"
    echo "       asegurate de descomprimirlo bien antes de abrirlo."
    exit 1
  fi

  echo
  echo "▸ 2. ¿Está en cuarentena?"
  echo

  QUAR=$(xattr -p com.apple.quarantine "$TARGET" 2>/dev/null || true)
  if [ -n "$QUAR" ]; then
    warn "SÍ. macOS le puso com.apple.quarantine al bajarlo."
    echo "       $QUAR"
    echo
    echo "     Por eso al hacer doble clic dice «está dañado» y no monta."
    echo "     El DMG NO está dañado — está en cuarentena."
    echo
    echo "     Sacala:"
    echo "         xattr -cr \"$TARGET\""
  else
    ok "No está en cuarentena."
  fi

  echo
  echo "▸ 3. Montando el DMG…"
  echo

  MOUNT=$(mktemp -d)
  if hdiutil attach "$TARGET" -mountpoint "$MOUNT" -nobrowse -quiet 2>/tmp/mount.log; then
    ok "Montó."
    APP=$(find "$MOUNT" -maxdepth 1 -name "*.app" | head -1)
    [ -n "$APP" ] && echo "     App adentro: $(basename "$APP")" || bad "No hay ningún .app adentro."
  else
    bad "NO MONTA."
    sed 's/^/       /' /tmp/mount.log | head -4
    echo
    echo "     Probá primero:  xattr -cr \"$TARGET\""
    exit 1
  fi
else
  APP="$TARGET"
fi

[ -z "$APP" ] && { echo; bad "No encontré ninguna .app."; exit 1; }

# ─────────────────────────────────────────────────────────────
# La app: LA PREGUNTA CLAVE
# ─────────────────────────────────────────────────────────────
echo
line
echo "  LA APP — ¿está ROTA, o solo BLOQUEADA?"
line
echo
echo "▸ 4. ¿La firma es válida?"
echo
echo "  Esta es LA pregunta. macOS dice «dañado» en dos casos distintos:"
echo "     · firma ROTA      → la app está rota de verdad. Culpa nuestra."
echo "     · solo cuarentena → la app está bien. Es Gatekeeper."
echo

if codesign --verify --deep --strict "$APP" > /tmp/cs.log 2>&1; then
  ok "FIRMA VÁLIDA. La app NO está rota."
  echo
  codesign -dv "$APP" 2>&1 | grep -iE 'Signature|Authority|Identifier|TeamIdentifier' | sed 's/^/       /'
  echo
  echo "     Si igual no abre, es SOLO cuarentena (ver punto 5)."
else
  bad "FIRMA ROTA. La app está genuinamente rota."
  echo
  sed 's/^/       /' /tmp/cs.log | head -6
  echo
  echo "     Esto es lo que produce «la aplicación está dañada»."
  echo "     En Apple Silicon el kernel directamente la mata."
  echo
  echo "     CAUSA: electron-builder con identity: null NO FIRMA NADA, pero igual"
  echo "     modifica el bundle de Electron (que venía firmado de fábrica)."
  echo "     Eso invalida la firma."
  echo
  echo "     El afterPack ahora firma ad-hoc para arreglarlo. Si ves esto, el build"
  echo "     que instalaste es ANTERIOR a ese arreglo."
fi

echo
echo "▸ 5. ¿Está en cuarentena?"
echo

QUAR=$(xattr -p com.apple.quarantine "$APP" 2>/dev/null || true)
if [ -n "$QUAR" ]; then
  warn "SÍ."
  echo
  echo "     Se saca con:   xattr -cr \"$APP\""
  echo
  echo "     Esto NO se puede evitar sin notarizar (US$99/año en Apple Developer)."
  echo "     Es independiente de la firma: son dos problemas distintos."
else
  ok "No está en cuarentena."
fi

echo
echo "▸ 6. ¿Qué dice Gatekeeper?"
echo
spctl -a -vv "$APP" 2>&1 | sed 's/^/     /' | head -4
echo
echo "     («rejected» es ESPERADO sin notarizar. No es el problema si la firma es válida.)"

# ─────────────────────────────────────────────────────────────
# Lo que importa: ¿ARRANCA?
# ─────────────────────────────────────────────────────────────
echo
line
echo "  ¿ARRANCA?"
line
echo
echo "▸ 7. Levantando el binario de Electron con Prisma…"
echo

BIN="$APP/Contents/MacOS/Finance OS"
PRISMA="$APP/Contents/Resources/app/node_modules/@prisma/client"

if [ ! -f "$BIN" ]; then
  bad "No existe el binario: $BIN"
else
  echo "     arquitectura: $(lipo -archs "$BIN" 2>/dev/null || file -b "$BIN" | cut -c1-40)"
  echo "     esta Mac:     $(uname -m)"
  echo

  ENGINE=$(ls "$APP/Contents/Resources/app/node_modules/.prisma/client/"*.node 2>/dev/null | head -1)
  if [ -n "$ENGINE" ]; then
    echo "     motor Prisma: $(basename "$ENGINE") ($(stat -f%z "$ENGINE") bytes)"
  else
    bad "No hay motor de Prisma en el paquete."
  fi
  echo

  OUT=$(ELECTRON_RUN_AS_NODE=1 "$BIN" -e "
    try {
      const { PrismaClient } = require('$PRISMA');
      new PrismaClient();
      console.log('PRISMA_OK');
    } catch (e) { console.error('FAIL: ' + String(e.message).split('\n')[0]); process.exit(1); }
  " 2>&1)

  if echo "$OUT" | grep -q PRISMA_OK; then
    ok "Prisma CARGA dentro de la app empaquetada."
  else
    bad "Prisma NO carga:"
    echo "$OUT" | head -3 | sed 's/^/       /'
  fi
fi

# ─────────────────────────────────────────────────────────────
echo
line
echo "  QUÉ HACER"
line
echo

if codesign --verify --deep --strict "$APP" > /dev/null 2>&1; then
  echo "  La app NO está rota. Su firma es válida."
  echo
  echo "  Si macOS igual la bloquea, es cuarentena — y eso solo se arregla"
  echo "  notarizando (US$99/año) o con un comando:"
  echo
  echo "      xattr -cr \"/Applications/Finance OS.app\""
else
  echo "  La app ESTÁ ROTA: su firma no es válida."
  echo
  echo "  No es Gatekeeper. Ningún xattr lo arregla."
  echo "  Hay que reconstruirla con el afterPack que firma ad-hoc."
fi
echo

[ -n "$MOUNT" ] && hdiutil detach "$MOUNT" -quiet 2>/dev/null || true
echo
