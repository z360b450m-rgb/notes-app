/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Noto Sans SC"', 'Poppins', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Poppins', '"Noto Sans SC"', 'system-ui', 'sans-serif'],
        body: ['"Noto Sans SC"', 'Lora', 'Georgia', 'serif'],
      },
      colors: {
        // Anthropic brand palette
        brand: {
          dark: '#141413',
          light: '#faf9f5',
          mid: '#b0aea5',
          'light-gray': '#e8e6dc',
          orange: '#d97757',
          blue: '#6a9bcc',
          green: '#788c5d',
        },
        // Primary accent → brand orange
        accent: {
          DEFAULT: '#d97757',
          light: '#fdf0e8',
          dark: '#c56a48',
        },
        // Semantic colors — preserved for functional correctness
        wrong: {
          bg: '#fef2f2',
          border: '#fecaca',
          accent: '#ef4444',
        },
        correct: {
          bg: '#ecfdf5',
          border: '#a7f3d0',
          accent: '#10b981',
        },
      },
    },
  },
  plugins: [],
}
