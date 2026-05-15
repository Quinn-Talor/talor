/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{js,ts,jsx,tsx}', './index.html'],
  theme: {
    extend: {
      colors: {
        // ─── New design tokens ──────────────────────────────
        // Map CSS variables to Tailwind names for class-based use.
        text: 'var(--text)',
        body: 'var(--body)',
        mute: 'var(--mute)',
        subtle: 'var(--subtle)',
        line: 'var(--line)',
        'line-2': 'var(--line-2)',
        surface: 'var(--surface)',
        canvas: 'var(--canvas)',
        ok: 'var(--ok)',
        warn: 'var(--warn)',
        err: 'var(--err)',
        info: 'var(--info)',

        // ─── Legacy palettes (kept during Phase 12 transition) ───
        // TODO: purge these and update consumers in Phase 12.2
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#4f8ef7',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        accent: {
          400: '#818cf8',
          500: '#7c3aed',
          600: '#6d28d9',
        },
      },
      fontFamily: {
        sans: ['var(--font-ui)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        sm: 'var(--r-sm)',
        DEFAULT: 'var(--r-md)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
      },
    },
  },
  plugins: [],
}
