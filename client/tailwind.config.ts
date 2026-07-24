import type { Config } from 'tailwindcss'
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: { DEFAULT: '#08080a', 2: '#0d0d10' },
        panel: { DEFAULT: '#131316', 2: '#181920' },
        line: { DEFAULT: '#242428', 2: '#33343a' },
        txt: { DEFAULT: '#f1f0ed', 2: '#a2a2aa', 3: '#6a6a74' },
        gold: { DEFAULT: '#d4a53a', 2: '#e7bd52', dim: 'rgba(212,165,58,.13)', line: 'rgba(212,165,58,.38)' },
        success: { DEFAULT: '#5bbf7a', dim: 'rgba(91,191,122,.12)' },
        danger: { DEFAULT: '#d9615c', dim: 'rgba(217,97,92,.12)' },
        track: '#212127',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['SF Mono', 'Cascadia Code', 'Consolas', 'ui-monospace', 'monospace'],
      },
      borderRadius: { card: '16px', btn: '10px' },
      animation: { 'fade-in': 'fadeIn .22s ease', 'spin-slow': 'spin .8s linear infinite' },
      keyframes: { fadeIn: { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } } },
    },
  },
  plugins: [],
} satisfies Config
