import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ProxyEntry {
  target: string;
  secure?: boolean;
}

function loadProxyConfig(): Record<string, object> {
  const configPath = resolve(__dirname, 'proxy.config.json');
  if (!existsSync(configPath)) return {};

  const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, ProxyEntry>;

  return Object.fromEntries(
    Object.entries(raw).map(([prefix, opts]) => [
      prefix,
      {
        target: opts.target,
        changeOrigin: true,
        secure: opts.secure ?? false,
        rewrite: (path: string) => path.replace(new RegExp('^' + prefix), ''),
      },
    ]),
  );
}

export default defineConfig(({ mode }) => ({
  plugins: [angular({ tsconfig: 'tsconfig.app.json' })],
  resolve: {
    mainFields: ['module'],
  },
  server: {
    port: 4200,
    host: true,
    proxy: loadProxyConfig(),
  },
  build: {
    target: 'es2022',
  },
  define: {
    'import.meta.vitest': mode !== 'production',
  },
}));
