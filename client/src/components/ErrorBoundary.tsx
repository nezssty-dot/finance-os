import { Component, type ReactNode } from 'react'

/**
 * Atrapa cualquier error de render de la página que envuelve. Sin esto, un error tira abajo
 * TODO el árbol de React y la app queda en pantalla negra (el fondo oscuro sin contenido).
 * Con esto, el error queda contenido en el área de contenido y se muestra un mensaje con la
 * opción de reintentar — el resto de la app (barra lateral, navegación) sigue viva.
 *
 * Se resetea solo al navegar: en AppShell se le pasa una `key` atada a la ruta, así cambiar
 * de pantalla vuelve a montarlo limpio y una pantalla que crasheó no queda "pegada".
 */
interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    // Queda en la consola para poder diagnosticar qué pantalla y con qué dato falló.
    console.error('Error de render en una pantalla:', error)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex-1 flex items-center justify-center p-10">
          <div className="max-w-md text-center">
            <div className="w-14 h-14 rounded-2xl bg-danger/15 text-danger flex items-center justify-center text-2xl mx-auto mb-4">!</div>
            <h2 className="text-lg font-semibold mb-2">Algo se rompió en esta pantalla</h2>
            <p className="text-sm text-txt-3 mb-5">
              El resto de la app sigue funcionando. Podés reintentar o cambiar de sección desde el menú.
            </p>
            <button
              onClick={() => this.setState({ error: null })}
              className="px-4 py-2 rounded-lg bg-gold-dim text-gold-2 text-sm font-semibold hover:bg-gold-dim/70 transition-colors"
            >
              Reintentar
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
