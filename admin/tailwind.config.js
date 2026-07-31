/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
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
        },
        brand: {
          600: '#6d28d9',
          500: '#7c3aed',
          400: '#8b5cf6',
          300: '#a78bfa',
        },
      },
    },
  },
  plugins: [],
};
