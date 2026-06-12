/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      // Semantic tokens driven by CSS variables (see src/index.css).
      // RGB-triplet form keeps Tailwind opacity modifiers (e.g. bg-app/90) working.
      colors: {
        app: 'rgb(var(--c-app) / <alpha-value>)', // page & chrome background
        surface: 'rgb(var(--c-surface) / <alpha-value>)', // cards, modals
        surface2: 'rgb(var(--c-surface2) / <alpha-value>)', // hovers, tracks, wells
        edge: 'rgb(var(--c-edge) / <alpha-value>)', // borders
        main: 'rgb(var(--c-text) / <alpha-value>)', // primary text
        muted: 'rgb(var(--c-muted) / <alpha-value>)', // secondary text
        faint: 'rgb(var(--c-faint) / <alpha-value>)', // tertiary text, placeholders
        accent: 'rgb(var(--c-accent) / <alpha-value>)',
        'accent-hov': 'rgb(var(--c-accent-hov) / <alpha-value>)',
        'on-accent': 'rgb(var(--c-on-accent) / <alpha-value>)', // text on accent buttons
      },
    },
  },
  plugins: [],
};
