// Corre justo después de empacar y antes de generar el instalador.
// Si tira, no se genera ningún instalador.
//
// ─── POR QUÉ ESTE ARCHIVO SE REESCRIBIÓ ENTERO ───
//
// La versión anterior verificaba que los ARCHIVOS EXISTIERAN en disco. Daba verde.
// Y la app igual moría al abrir con:
//
//     Cannot find module '.prisma/client/default'
//
// Los archivos estaban. Node no los podía RESOLVER. No es lo mismo — y chequear lo
// primero mientras el usuario necesita lo segundo es PEOR que no chequear nada: da
// una confianza que no corresponde. Ese chequeo débil es lo que dejó pasar el bug.
//
// Ahora hay dos verificaciones, con responsabilidades separadas:
//
//   A. PROBE: levanta el binario de Electron recién empaquetado y le hace RESOLVER
//      @prisma/client de verdad. Eso ejecuta default.js, que ejecuta
//      require('.prisma/client/default') — o sea, la cadena entera que estaba rota.
//      Es determinista: no necesita base de datos ni motor funcionando.
//
//   B. ARCHIVOS: que el motor nativo exista, sea de ESTA plataforma y no esté vacío.
//      Son los tres modos en que un motor puede estar mal.
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

/** Recorta un error para que se pueda leer. El stderr de Prisma viene minificado en
 *  una sola línea gigante: sin esto, la terminal escupe 200 KB de JS ilegible. */
function readable(text, maxLines = 4, maxLen = 160) {
  return String(text)
    .split("\n")
    .filter(Boolean)
    .slice(0, maxLines)
    .map((l) => (l.length > maxLen ? l.slice(0, maxLen) + " …" : l))
    .join("\n    ");
}

exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName, arch, packager } = context;

  // electron-builder pasa el enum Arch (un número), no el nombre. "arch=1" no le
  // dice nada a nadie.
  const ARCH = ["ia32", "x64", "armv7l", "arm64", "universal"];
  const archName = ARCH[arch] ?? String(arch);
  const product = packager.appInfo.productFilename;

  const isMac = electronPlatformName === "darwin";
  const isWin = electronPlatformName === "win32";

  const resources = isMac
    ? path.join(appOutDir, `${product}.app`, "Contents", "Resources")
    : path.join(appOutDir, "resources");

  // asar: false → la app vive en resources/app/ (un directorio real)
  const appDir = path.join(resources, "app");
  const prismaDir = path.join(appDir, "node_modules", ".prisma", "client");

  const problems = [];

  // ─── 0. EL ASAR NO PUEDE VOLVER ───
  //
  // Si aparece un app.asar, el empaquetado se hizo con `asar: true` — y eso ROMPE
  // Prisma de una forma que no se ve hasta que el usuario abre la app:
  //
  //     Cannot find module '.prisma/client/default'
  //     Require stack:
  //       .../Contents/Resources/app.asar/node_modules/@prisma/client/default.js
  //
  // Porque @prisma/client/default.js hace, literalmente:
  //     module.exports = { ...require('.prisma/client/default') }
  //
  // y el shim de asar de Electron solo redirige app.asar/X → app.asar.unpacked/X si X
  // está registrado EN LA CABECERA del asar. `.prisma` entra por extraResources, o sea
  // NUNCA pasa por el asar, o sea no tiene entrada, o sea Node no lo encuentra.
  //
  // El instalador se genera igual. Se instala igual. Y no abre.
  // Este chequeo mata el build antes de que eso llegue a un usuario.
  const asarFile = path.join(resources, "app.asar");
  if (fs.existsSync(asarFile)) {
    problems.push(
      "SE GENERÓ UN app.asar. El empaquetado tiene que ser SIN asar.\n" +
        "    Con asar, la app se instala perfecto y muere al abrir con:\n" +
        "        Cannot find module '.prisma/client/default'\n" +
        "    Porque .prisma entra por extraResources y nunca queda registrado en la\n" +
        "    cabecera del asar, así que el shim de Electron no lo puede resolver.\n" +
        "    → electron-builder.yml tiene que decir  asar: false"
    );
  }

  // ─── A. El cliente generado tiene que estar ───
  //
  // @prisma/client NO SIRVE PARA NADA sin .prisma/client al lado: su default.js hace
  // literalmente `module.exports = { ...require('.prisma/client/default') }`.
  if (!fs.existsSync(prismaDir)) {
    problems.push(
      "Falta el cliente generado de Prisma (node_modules/.prisma/client).\n" +
        "    Sin esto la app abre y muere con «Cannot find module '.prisma/client/default'».\n" +
        "    → Revisá `extraResources` en electron-builder.yml."
    );
  }

  // ─── A2. @prisma/client: EXIGIDO, no asumido ───
  //
  // electron-builder incluye las `dependencies` de producción por su cuenta: lee el
  // árbol con `app-builder node-dep-tree` y las copia. Funciona. Pero es un
  // comportamiento IMPLÍCITO, y confiar en algo implícito sin verificarlo es
  // exactamente cómo se cuelan los bugs que instalan bien y no abren.
  //
  // Así que se EXIGE. Si algún día electron-builder cambia de criterio, o alguien
  // mueve @prisma/client a devDependencies, o una exclusión de `files` se lo come:
  // el build MUERE ACÁ, con un mensaje que dice qué pasó. No sale un instalador roto.
  //
  // (No se copia a mano con extraResources: sería redundante, duplicaría archivos
  //  sobre los que electron-builder ya puso, y taparía el problema en vez de mostrarlo.)
  const clientDir = path.join(appDir, "node_modules", "@prisma", "client");

  if (!fs.existsSync(clientDir)) {
    problems.push(
      "FALTA @prisma/client EN EL BUNDLE.\n" +
        `    Se esperaba en: ${path.relative(appOutDir, clientDir)}\n` +
        "    electron-builder NO copió esta dependencia de producción.\n" +
        "    → Verificá que @prisma/client esté en `dependencies` (no devDependencies)\n" +
        "      de electron/package.json, y que `files` no la excluya."
    );
  } else {
    // El directorio puede existir y estar incompleto. default.js es EL archivo:
    // hace literalmente `module.exports = { ...require('.prisma/client/default') }`.
    // Sin él, @prisma/client no sirve para nada.
    const required = ["package.json", "default.js", "index.js", "runtime"];
    const missing = required.filter((f) => !fs.existsSync(path.join(clientDir, f)));

    if (missing.length) {
      problems.push(
        `@prisma/client está en el bundle pero INCOMPLETO. Falta: ${missing.join(", ")}\n` +
          "    default.js es el que hace `require('.prisma/client/default')`.\n" +
          "    → Alguna exclusión de `files` se está comiendo archivos que sí se ejecutan."
      );
    }
  }

  // ─── B. El motor nativo: existe, es de esta plataforma, no está vacío ───
  const engines = fs.existsSync(prismaDir)
    ? fs.readdirSync(prismaDir).filter((f) => f.endsWith(".node"))
    : [];

  // El motor tiene que ser DE ESTA PLATAFORMA **Y DE ESTA ARQUITECTURA**.
  //
  // El chequeo anterior usaba el prefijo "libquery_engine-darwin", que matchea LOS DOS:
  //
  //     libquery_engine-darwin.dylib.node        ← Intel
  //     libquery_engine-darwin-arm64.dylib.node  ← Apple Silicon
  //
  // Con el build universal eso no importaba: iban los dos motores. Ahora que son dos
  // .dmg independientes, un build de Intel con el motor de ARM adentro habría pasado
  // el chequeo, instalado perfecto y NO ABIERTO. Por eso ahora se matchea el nombre
  // COMPLETO, sin prefijos ambiguos.
  const EXPECTED = {
    "win32-x64": "query_engine-windows.dll.node",
    "darwin-x64": "libquery_engine-darwin.dylib.node",
    "darwin-arm64": "libquery_engine-darwin-arm64.dylib.node",
  }[`${electronPlatformName}-${archName}`];

  if (!engines.length) {
    problems.push(
      "No hay ningún motor de Prisma en el paquete.\n" +
        "    La app instalaría bien y no abriría (sin driver de base de datos).\n" +
        "    → Corré `prisma generate` antes de empaquetar."
    );
  } else {
    // EXACTAMENTE UNO. Si hay más, `prisma generate` acumuló motores de un build
    // anterior y prepare.mjs no los purgó — el paquete lleva peso muerto, y peor:
    // el motor equivocado podría ser el que carga.
    if (engines.length > 1) {
      problems.push(
        `El paquete lleva ${engines.length} motores de Prisma. Tiene que llevar UNO.\n` +
          `    Encontrados: ${engines.join(", ")}\n` +
          "    → prepare.mjs debería haber purgado los viejos. Borrá node_modules/.prisma\n" +
          "      y volvé a compilar."
      );
    }

    if (EXPECTED && !engines.includes(EXPECTED)) {
      problems.push(
        "El motor de Prisma no corresponde a este build.\n" +
          `    Empaquetando: ${electronPlatformName}/${archName}  → se esperaba "${EXPECTED}"\n` +
          `    Se encontró:  ${engines.join(", ")}\n` +
          "    La app instalaría bien y NO abriría. El motor es nativo por sistema Y por\n" +
          "    arquitectura: compilá cada uno con su target (ver package.json)."
      );
    }

    for (const e of engines) {
      if (fs.statSync(path.join(prismaDir, e)).size === 0)
        problems.push(`El motor ${e} pesa 0 bytes. Está vacío — no se bajó bien.`);
    }
  }

  // ─── C. El schema, que la app ejecuta en el primer arranque ───
  for (const f of ["schema.prisma", "schema.sql"]) {
    if (!fs.existsSync(path.join(appDir, "prisma", f)))
      problems.push(`Falta prisma/${f}. La app no puede crear la base en el primer arranque.`);
  }

  // ─── D. LA PRUEBA QUE IMPORTA: ¿Node RESUELVE @prisma/client? ───
  //
  // Todo lo de arriba puede dar verde y el módulo igual no resolver. Eso fue
  // EXACTAMENTE lo que pasó. Así que acá se levanta el Electron recién empaquetado
  // y se le pide que cargue Prisma de verdad.
  //
  // Solo se puede correr si el binario es de esta máquina. Armando el .exe desde
  // Linux no se puede ejecutar — y eso se dice, en vez de fingir que se verificó.
  const host =
    process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";

  // La ARQUITECTURA también tiene que coincidir. En un runner Apple Silicon, el
  // binario de Intel solo correría bajo Rosetta — y no vamos a apoyar una verificación
  // en que Rosetta esté instalado. Si no se puede ejecutar, se DICE, no se finge.
  const runnable = electronPlatformName === host && archName === process.arch;

  let probed = false;
  let signed = false;

  if (runnable && !problems.length) {
    const binary = isMac
      ? path.join(appOutDir, `${product}.app`, "Contents", "MacOS", product)
      : isWin
        ? path.join(appOutDir, `${product}.exe`)
        : path.join(appOutDir, packager.executableName || product.toLowerCase());

    // AGUJERO CERRADO: antes, si el binario no estaba donde lo busco, el probe se
    // salteaba EN SILENCIO. problems quedaba vacío, la app se firmaba, y el build daba
    // VERDE sin haber verificado NADA. Ese es exactamente el falso-verde que hay que
    // matar. Si el binario tendría que estar y no está, el build muere.
    if (!fs.existsSync(binary)) {
      problems.push(
        `No se encontró el binario de la app: ${path.relative(appOutDir, binary)}\n` +
          "    No se pudo verificar que Prisma cargue. No se firma una app sin verificar."
      );
    } else {
      const client = path.join(appDir, "node_modules", "@prisma", "client");

      // Esto ejecuta la cadena entera que estaba rota:
      //   require('@prisma/client')
      //     → @prisma/client/default.js
      //       → require('.prisma/client/default')   ← acá fallaba
      //
      // Y confirma que cargó el cliente GENERADO (que trae prismaVersion), no un stub.
      const probe = [
        "try {",
        `  const m = require(${JSON.stringify(client)});`,
        '  if (typeof m.PrismaClient !== "function") throw new Error("PrismaClient no es una funcion");',
        '  if (!m.Prisma || !m.Prisma.prismaVersion) throw new Error("cargo un stub, no el cliente generado");',
        '  console.log("PRISMA_RESOLVE_OK " + m.Prisma.prismaVersion.client);',
        "} catch (e) {",
        '  console.error("PRISMA_FAIL " + String(e && e.message).split("\\n")[0]);',
        "  process.exit(1);",
        "}",
      ].join("\n");

      try {
        const out = execFileSync(binary, ["-e", probe], {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
          encoding: "utf8",
          timeout: 90_000,
          stdio: ["ignore", "pipe", "pipe"],
        });

        if (String(out).includes("PRISMA_RESOLVE_OK")) probed = true;
        else problems.push(`La app empaquetada no pudo cargar Prisma.\n    ${readable(out)}`);
      } catch (err) {
        problems.push(
          "LA APP EMPAQUETADA NO PUEDE CARGAR PRISMA.\n" +
            `    ${readable(err.stderr || err.stdout || err.message)}\n` +
            "    Se instalaría bien y NO abriría. No se genera instalador."
        );
      }
    }
  }

  // ─── E. FIRMA AD-HOC (macOS) ───
  //
  // ESTO ES LO QUE ARREGLA EL «LA APLICACIÓN ESTÁ DAÑADA».
  //
  // Electron viene FIRMADO de fábrica: Apple lo exige para que un binario arm64 pueda
  // ejecutarse. Pero electron-builder, con `identity: null`, NO FIRMA NADA:
  //
  //     log.info({ reason: "identity explicitly is set to null" }, "skipped macOS code signing")
  //
  // Y mientras tanto le METIÓ nuestro Contents/Resources/app/ adentro del bundle. Eso
  // ROMPE la firma que Electron traía.
  //
  // Un bundle con firma INVÁLIDA no es lo mismo que uno SIN FIRMAR:
  //
  //   · sin firmar + cuarentena → "desarrollador no identificado"
  //                                (clic derecho → Abrir funciona)
  //   · FIRMA ROTA              → "está dañado y no se puede abrir"
  //                                (clic derecho NO funciona; en Apple Silicon el
  //                                 kernel directamente lo mata)
  //
  // La firma ad-hoc (`codesign --sign -`) es GRATIS: no necesita cuenta de Apple.
  // No saca la cuarentena —eso solo se arregla notarizando, que sale US$99/año— pero
  // hace que la app NO ESTÉ ROTA. Son dos problemas distintos, y este es el que
  // estábamos causando nosotros.
  //
  // Sin `--options runtime`: el hardened runtime exige entitlements (JIT para V8) y
  // con una firma ad-hoc haría que la app no arranque.
  // SOLO si la firma está explícitamente deshabilitada. Si algún día hay un certificado
  // de verdad (identity con un Developer ID), electron-builder firma él, con hardened
  // runtime, y nosotros no tocamos nada.
  const signingDisabled = packager.platformSpecificBuildOptions?.identity === null;

  if (isMac && signingDisabled && !problems.length) {
    const appPath = path.join(appOutDir, `${product}.app`);

    if (fs.existsSync(appPath)) {
      try {
        // --deep firma también los frameworks y helpers de adentro. Sin eso, la firma
        // del bundle externo es válida pero la de los internos no, y macOS igual lo rechaza.
        execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], {
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 300_000,
        });

        // Y verificamos que haya quedado bien. Firmar y no chequear es lo mismo que
        // no firmar: no te enterás hasta que un usuario abre la app.
        execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], {
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 300_000,
        });

        signed = true;
      } catch (err) {
        const noCodesign =
          String(err.message).includes("ENOENT") || String(err.code) === "ENOENT";

        if (noCodesign) {
          // `codesign` es una herramienta de macOS. No existe en Linux ni en Windows.
          //
          // Esto NO es un bug: es que las apps de macOS SE COMPILAN EN macOS. Sin
          // firma, el .app está roto — macOS dice «está dañado» y en Apple Silicon el
          // kernel lo mata. Producir un .app sin firmar sería producir basura, así que
          // fallamos en vez de entregarla.
          problems.push(
            `Estás compilando para macOS desde ${process.platform}, y \`codesign\` no existe acá.\n` +
              "    Las apps de macOS SE COMPILAN EN macOS. No es una limitación nuestra:\n" +
              "    sin firma el .app está roto, y ni el .dmg se puede generar (necesita hdiutil).\n" +
              "    → Usá un runner macOS (el CI ya lo hace: macos-13 y macos-14)."
          );
        } else {
          problems.push(
            "No se pudo firmar la app (ad-hoc).\n" +
              `    ${readable(err.stderr || err.message)}\n` +
              "    Sin firma válida, macOS dice «la aplicación está dañada» y no abre.\n" +
              "    (En Apple Silicon el kernel directamente la mata.)"
          );
        }
      }
    }
  }

  if (problems.length) {
    throw new Error(
      "\n✗ Verificación del paquete falló:\n\n" +
        problems.map((p, i) => `  ${i + 1}. ${p}`).join("\n\n") +
        "\n"
    );
  }

  const clientFiles = fs.existsSync(clientDir) ? fs.readdirSync(clientDir).length : 0;

  const bits = [
    `@prisma/client=${clientFiles} archivos`,
    `motor=${engines.join(", ")}`,
    probed ? "Prisma RESUELVE ✓" : "(cross-build: no se pudo ejecutar el binario)",
    ...(isMac ? [signed ? "firmado ad-hoc ✓" : "SIN FIRMAR ⚠"] : []),
  ];
  console.log(`  • verificado      ${electronPlatformName}/${archName} · ${bits.join(" · ")}`);
};
