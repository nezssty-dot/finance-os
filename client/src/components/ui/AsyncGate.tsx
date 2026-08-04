import { TopBar } from '@/components/layout/TopBar'
import { Spinner } from './Spinner'
import { EmptyState } from './EmptyState'
import { Button } from './Button'

/**
 * Estado de carga de una página completa.
 *
 * Muestra el spinner mientras carga y, si el fetch FALLA, un mensaje claro con opción de
 * reintentar — en vez del spinner infinito que quedaba antes: las páginas hacían
 * `if (!data) return <Spinner/>` e ignoraban el error, así que un fetch fallado dejaba la
 * pantalla cargando para siempre. Acá el error se ve.
 */
export function AsyncGate({
  title,
  error,
  onRetry,
}: {
  title: string
  error?: string | null
  onRetry?: () => void
}) {
  return (
    <>
      <TopBar title={title} />
      <div className="p-7">
        {error ? (
          <EmptyState
            icon="⚠️"
            title="No se pudieron cargar los datos"
            description={error}
            action={onRetry ? <Button onClick={onRetry}>Reintentar</Button> : undefined}
          />
        ) : (
          <Spinner />
        )}
      </div>
    </>
  )
}
