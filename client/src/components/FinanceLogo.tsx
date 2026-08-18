interface Props {
  size?: number
  className?: string
}

/**
 * Símbolo de Finance OS: dos ondas entrelazadas (una arriba, otra abajo, en espejo) con un
 * punto de luz en el centro. Recreado como SVG vectorial a partir del ícono de marca, así
 * queda nítido a cualquier tamaño y con fondo transparente (el JPEG original venía con su
 * propio fondo oscuro, imposible de recortar limpio).
 */
export function FinanceLogo({ size = 30, className }: Props) {
  const id = 'flogo'
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={`${id}-top`} x1="30" y1="12" x2="70" y2="50" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4db8ff" />
          <stop offset="1" stopColor="#3d7bfc" />
        </linearGradient>
        <linearGradient id={`${id}-bot`} x1="30" y1="50" x2="70" y2="88" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5b6cff" />
          <stop offset="1" stopColor="#7b5cfc" />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx="50" cy="50" r="14" gradientUnits="userSpaceOnUse">
          <stop stopColor="#eaf4ff" />
          <stop offset="0.5" stopColor="#bcdcff" />
          <stop offset="1" stopColor="#bcdcff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Onda superior: entra desde arriba-derecha y baja hacia el centro-izquierda */}
      <path
        d="M64 14 C 56 30, 34 30, 30 48 C 42 44, 52 40, 58 30 C 55 42, 46 50, 34 52 C 50 54, 64 44, 66 28 C 67 22, 66 17, 64 14 Z"
        fill={`url(#${id}-top)`}
      />
      {/* Onda inferior: espejo de la de arriba */}
      <path
        d="M36 86 C 44 70, 66 70, 70 52 C 58 56, 48 60, 42 70 C 45 58, 54 50, 66 48 C 50 46, 36 56, 34 72 C 33 78, 34 83, 36 86 Z"
        fill={`url(#${id}-bot)`}
      />

      {/* Punto de luz central */}
      <circle cx="50" cy="50" r="13" fill={`url(#${id}-glow)`} />
      <circle cx="50" cy="50" r="6.5" fill="#f2f8ff" />
    </svg>
  )
}
