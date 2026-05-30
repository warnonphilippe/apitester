import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [angular({ tsconfig: 'tsconfig.app.json' })],
  resolve: {
    mainFields: ['module'],
  },
  server: {
    port: 4200,
    host: true,
    // Dev proxy to bypass CORS when testing an API that does not send CORS headers.
    // Point your request URL at /proxy/... and set VITE_PROXY_TARGET to the real host.
    proxy: {
      '/proxy': {
        target: process.env['VITE_PROXY_TARGET'] ?? 'http://localhost:8080',
        rewrite: (path) => path.replace(/^\/proxy/, ''),
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    target: 'es2022',
  },
  define: {
    'import.meta.vitest': mode !== 'production',
  },
}));
