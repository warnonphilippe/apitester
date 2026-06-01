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
      // Proxy direct vers le convertisseur gpdoc dans le cluster.
      // Le host svc.cluster.local se résout depuis cette machine (VPN / /etc/hosts) —
      // c'est le process Node de Vite qui appelle, donc PAS de CORS et, avec
      // secure:false, le certificat auto-signé est ignoré (comme Postman).
      // Usage dans l'app : http://localhost:4200/windoc-dev/api/convertStream
      '/windoc-dev': {
        target:
          process.env['VITE_GPDOC_TARGET'] ??
          'https://REDACTED.internal:8443',
        rewrite: (path) => path.replace(/^\/windoc-dev/, ''),
        changeOrigin: true,
        secure: false, // accepte le certificat auto-signé du service
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
