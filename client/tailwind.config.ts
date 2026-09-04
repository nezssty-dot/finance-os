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
        // Riel del sidebar: siempre negro, no cambia con el tema (ver index.css).
        chrome: { DEFAULT: 'var(--c-chrome)', 2: 'var(--c-chrome-2)' },
        'chrome-txt': { DEFAULT: 'var(--c-chrome-txt)', 2: 'var(--c-chrome-txt-2)' },
      },
      fontFamily: {
        sans: ['Poppins', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['SF Mono', 'Cascadia Code', 'Consolas', 'ui-monospace', 'monospace'],
      },
      // Escala tipográfica EXACTA del frame "Typo" en Components (nodo 10:897 del
      // Figma) — familia, tamaño y peso tal cual figuran ahí, no aproximados:
      //   Hero 40/Regular · H1 30/Medium · H2 30/Regular · H3 24/Regular ·
      //   H4 20/Regular · Title 16/Regular · Body M 14/Regular (= text-sm) ·
      //   Body S 12/Regular (= text-xs) · Caption 10/Regular
      fontSize: {
        hero: ['40px', { lineHeight: '1.1', fontWeight: '400' }],
        h1: ['30px', { lineHeight: '1.2', fontWeight: '500' }],
        h2: ['30px', { lineHeight: '1.2', fontWeight: '400' }],
        h3: ['24px', { lineHeight: '1.25', fontWeight: '400' }],
        h4: ['20px', { lineHeight: '1.3', fontWeight: '400' }],
        title: ['16px', { lineHeight: '1.4', fontWeight: '400' }],
        caption: ['10px', { lineHeight: '1.4', fontWeight: '400' }],
      },
      borderRadius: { card: '26px', btn: '999px' },
      animation: { 'fade-in': 'fadeIn .22s ease', 'spin-slow': 'spin .8s linear infinite' },
      keyframes: { fadeIn: { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } } },
    },
  },
  plugins: [],
} satisfies Config
