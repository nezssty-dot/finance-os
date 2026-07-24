/**
 * En qué está corriendo la app.
 *
 * ─── POR QUÉ ESTO EXISTE ───
 *
 * En macOS, Electron abre la ventana con `titleBarStyle: "hiddenInset"`: no hay barra
 * de título, y los botones de cerrar / minimizar / maximizar FLOTAN sobre el contenido,
 * arriba a la izquierda. Que es exactamente donde está el logo del sidebar.
 *
 * Y hay una segunda consecuencia, más silenciosa: sin barra de título, la ventana no se
 * puede arrastrar desde ningún lado, salvo que declaremos alguna zona como arrastrable.
 *
 * Las dos cosas se arreglan reservando una franja arriba — pero SOLO en macOS de
 * escritorio. En Windows y Linux la barra de título es real, y en el navegador (dev:
 * localhost:5173) no hay ventana nativa: reservar espacio ahí sería un hueco vacío
 * arriba del logo, sin ningún motivo.
 */

interface ElectronAPI {
  isElectron: true;
  platform: string;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

/** Corriendo dentro de la app de escritorio (no en el navegador). */
export const isDesktop = (): boolean => !!window.electronAPI?.isElectron;

/**
 * macOS de escritorio: el único caso donde los botones de la ventana invaden el
 * contenido y hay que reservarles lugar.
 */
export const isMacDesktop = (): boolean => window.electronAPI?.platform === "darwin";

/**
 * Alto de la franja que se reserva arriba en macOS, en px.
 *
 * 32 px alcanza para que el semáforo (que Electron dibuja en y=18, ver
 * `trafficLightPosition` en electron/src/main.ts) quede holgado y no toque el logo.
 */
export const MAC_INSET = 32;
