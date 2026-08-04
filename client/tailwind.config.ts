import type { Config } from 'tailwindcss'

/*
 * Los colores apuntan a variables CSS (definidas en index.css por tema). Cambiar el tema
 * (claro/oscuro) recolorea toda la app sin tocar las pantallas.
 *
 * Nota: se conserva el nombre "gold" mapeado al acento VERDE del diseño. Así las 39
 * pantallas que ya usan `bg-gold`, `text-gold-2`, etc. adoptan el verde automáticamente,
 * sin tener que renombrar clase por clase. El nombre quedó por historia; el color es verde.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: 'var(--c-bg)', 2: 'var(--c-bg-2)' },
        panel: { DEFAULT: 'var(--c-panel)', 2: 'var(--c-panel-2)' },
        line: { DEFAULT: 'var(--c-line)', 2: 'var(--c-line-2)' },
        txt: { DEFAULT: 'var(--c-txt)', 2: 'var(--c-txt-2)', 3: 'var(--c-txt-3)' },
        // "gold" = acento verde del diseño (nombre histórico)
        gold: { DEFAULT: 'var(--c-accent)', 2: 'var(--c-accent-2)', dim: 'var(--c-accent-dim)', line: 'var(--c-accent-line)' },
        accent: { DEFAULT: 'var(--c-accent)', 2: 'var(--c-accent-2)', dim: 'var(--c-accent-dim)', line: 'var(--c-accent-line)' },
        success: { DEFAULT: 'var(--c-success)', dim: 'var(--c-success-dim)' },
        danger: { DEFAULT: 'var(--c-danger)', dim: 'var(--c-danger-dim)' },
        warning: { DEFAULT: 'var(--c-warning)', dim: 'var(--c-warning-dim)' },
        info: { DEFAULT: 'var(--c-info)', dim: 'var(--c-info-dim)' },
        violet: { DEFAULT: 'var(--c-violet)', dim: 'var(--c-violet-dim)' },
        track: 'var(--c-track)',
      },
      fontFamily: {
        sans: ['Poppins', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['SF Mono', 'Cascadia Code', 'Consolas', 'ui-monospace', 'monospace'],
      },
      borderRadius: { card: '20px', btn: '999px' },
      animation: { 'fade-in': 'fadeIn .22s ease', 'spin-slow': 'spin .8s linear infinite' },
      keyframes: { fadeIn: { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } } },
    },
  },
  plugins: [],
} satisfies Config
