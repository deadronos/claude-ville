import './load-local-env.js';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { buildRuntimeConfig } from './runtime-config.shared.js';

const runtimeConfig = buildRuntimeConfig(process.env);
const hubHttpProxyTarget = runtimeConfig.hubHttpUrl || 'http://localhost:4000';
const hubWsProxyTarget = hubHttpProxyTarget.replace(/^http/, 'ws');

/**
 * Vite plugin that injects runtime config from .env.local into the page.
 * - Dev: transforms index.html to inject an inline <script> with the config
 * - Build: uses Vite define to inline the values at bundle time
 */
function claudeVilleRuntimeConfigPlugin() {
  return {
    name: 'claudeville-runtime-config',
    apply: 'serve',
    transformIndexHtml(html) {
      // Inject the runtime config as an inline <script> at the top of <head>
      const configScript = `<script>window.__CLAUDEVILLE_CONFIG__ = ${JSON.stringify(runtimeConfig)};</script>`;
      return html.replace('<head>', `<head>\n  ${configScript}`);
    },
  };
}

export default defineConfig({
  root: 'claudeville',
  server: {
    port: 3001,
    proxy: {
      '/api': hubHttpProxyTarget,
      '/ws': {
        target: hubWsProxyTarget,
        ws: true,
      },
    },
  },
  plugins: [react(), claudeVilleRuntimeConfigPlugin()],
  define: {
    // For production build: inline the values so runtime-config.ts uses them
    'import.meta.env.VITE_HUB_HTTP_URL': JSON.stringify(runtimeConfig.hubHttpUrl),
    'import.meta.env.VITE_HUB_WS_URL': JSON.stringify(runtimeConfig.hubWsUrl),
  },
  build: {
    outDir: '../dist/frontend',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'claudeville/index.html'),
        pixijs: resolve(__dirname, 'claudeville/pixijs.html'),
        voxel: resolve(__dirname, 'claudeville/voxel.html'),
      },
    },
  },
});
