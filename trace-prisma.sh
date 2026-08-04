#!/bin/bash
# RASTREO DE @prisma/client — CORRELO EN TU MAC.
#
# Esto no depende de mi sandbox ni de que me creas. Compila en TU máquina y te dice,
# etapa por etapa, dónde está @prisma/client y dónde no.
#
#   bash trace-prisma.sh
#
# Al final te da un veredicto claro. Si dice que falta, es el empaquetado y lo arreglo.
# Si dice que está, el problema está en otro lado y también te lo muestra.

set -uo pipefail
cd "$(dirname "$0")"

line() { printf '─%.0s' {1..70}; echo; }
box()  { echo; line; echo "  $1"; line; }

count() {  # cuenta archivos de un dir, o dice que no existe
  if [ -d "$1" ]; then echo "✅ $(ls -1 "$1" | wc -l | tr -d ' ') archivos"
  else echo "❌ NO EXISTE"; fi
}

box "ETAPA 1 — node_modules de electron, antes de compilar"
echo
echo "  electron/node_modules/@prisma/client   $(count electron/node_modules/@prisma/client)"
echo "  electron/node_modules/.prisma/client   $(count electron/node_modules/.prisma/client)"
echo
echo "  ¿@prisma/client es dependencia de PRODUCCIÓN?"
node -e "
  const p = require('./electron/package.json');
  const d = p.dependencies?.['@prisma/client'];
  const v = p.devDependencies?.['@prisma/client'];
  console.log('     dependencies:    ' + (d ?? '—'));
  console.log('     devDependencies: ' + (v ?? '—'));
  console.log(d && !v ? '     ✅ está donde tiene que estar' : '     ❌ MAL UBICADA');
"

box "ETAPA 2 — corriendo el pipeline (build.mjs)"
echo
rm -rf server/dist client/dist electron/build electron/release
npm --prefix electron run build:electron -- --target=mac-arm 2>&1 | grep -E '^▸|✓ Verificado' || true
echo
echo "  Después de build.mjs:"
echo "  electron/node_modules/@prisma/client   $(count electron/node_modules/@prisma/client)"
echo "  electron/node_modules/.prisma/client   $(count electron/node_modules/.prisma/client)"

box "ETAPA 3 — empaquetando con electron-builder"
echo
( cd electron && npx electron-builder --mac --arm64 --dir --publish never 2>&1 | grep -iE 'packaging|verificado|✗' ) || true

APP=$(find "$PWD/electron/release" -maxdepth 2 -name "*.app" | head -1)
if [ -z "$APP" ]; then
  echo
  echo "  ❌ No se generó ningún .app. El build falló antes de empaquetar."
  exit 1
fi

R="$APP/Contents/Resources/app"

box "ETAPA 4 — EL .app FINAL  ← LA PREGUNTA"
echo
echo "  $APP"
echo
echo "  Contents/Resources/app/node_modules/@prisma/client   $(count "$R/node_modules/@prisma/client")"
echo "  Contents/Resources/app/node_modules/.prisma/client   $(count "$R/node_modules/.prisma/client")"
echo

if [ -d "$R/node_modules/@prisma/client" ]; then
  echo "  ── contenido real de @prisma/client ──"
  ls -1 "$R/node_modules/@prisma/client" | sed 's/^/     /'
fi

box "ETAPA 5 — el require() de tu CI, sobre ESTE bundle"
echo
REL="${APP#$PWD/}"

echo "  ▸ Como lo llamaba el workflow VIEJO (ruta RELATIVA):"
node -e "
try { require('$REL/Contents/Resources/app/node_modules/@prisma/client'); console.log('     cargó'); }
catch (e) { console.log('     ❌ ' + e.message.split('\n')[0]); }
"
echo
echo "  ▸ Con ruta ABSOLUTA (el workflow corregido):"
node -e "
try {
  const m = require('$R/node_modules/@prisma/client');
  console.log('     ✅ CARGA · PrismaClient: ' + typeof m.PrismaClient + ' · v' + m.Prisma.prismaVersion.client);
} catch (e) { console.log('     ❌ ' + e.message.split('\n')[0]); }
"

box "VEREDICTO"
echo
if [ ! -d "$R/node_modules/@prisma/client" ]; then
  echo "  🔴 @prisma/client NO ESTÁ EN EL BUNDLE."
  echo
  echo "     Tenías razón: es un problema de empaquetado."
  echo "     Pasame esta salida completa y lo arreglo."
elif [ ! -f "$R/node_modules/@prisma/client/default.js" ]; then
  echo "  🔴 @prisma/client está, pero INCOMPLETO (falta default.js)."
  echo
  echo "     Alguna exclusión de \`files\` se está comiendo archivos que sí se ejecutan."
  echo "     Pasame esta salida completa y lo arreglo."
else
  echo "  ✅ @prisma/client ESTÁ EN EL BUNDLE, y está completo."
  echo
  echo "     El empaquetado funciona. electron-builder SÍ copia las dependencies"
  echo "     de producción."
  echo
  echo "     Fijate la ETAPA 5: el mismo archivo, con ruta relativa NO carga y con"
  echo "     ruta absoluta SÍ. Node interpreta require('rel/path/x') como NOMBRE DE"
  echo "     PAQUETE, no como archivo — y lo busca en node_modules."
  echo
  echo "     Eso era el bug del CI. Ya está corregido en los workflows."
fi
echo
