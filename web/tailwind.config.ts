import type { Config } from 'tailwindcss';

// Тёмная тема по умолчанию (PLAN §5.5), палитра — как в проектах команды
const config: Config = {
  // components/ и lib/ обязательно перечислять явно: без них Tailwind не видит
  // классы, которые встречаются только в компонентах, и молча их не генерирует —
  // вёрстка при этом не ломается, а просто теряет часть отступов и цветов
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#070b16',
          900: '#0b1020',
          800: '#0f172a',
          700: '#1e293b',
          600: '#334155',
          500: '#64748b',
          400: '#94a3b8',
          300: '#cbd5e1',
          200: '#e2e8f0',
          100: '#f1f5f9',
        },
        brand: {
          600: '#6d28d9',
          500: '#7c3aed',
          400: '#8b5cf6',
          300: '#a78bfa',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
