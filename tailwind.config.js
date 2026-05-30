/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,html}'],
  theme: {
    extend: {
      colors: {
        verb: {
          get: '#10b981',
          post: '#f59e0b',
          put: '#3b82f6',
          patch: '#8b5cf6',
          delete: '#ef4444',
          head: '#6b7280',
          options: '#06b6d4',
        },
      },
    },
  },
  plugins: [],
};
