import './load-local-env.js';
import { defineConfig } from 'vite';
import { buildRuntimeConfig } from './runtime-config.shared.js';

const runtimeConfig = buildRuntimeConfig(process.env);

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
      '/api': 'http://localhost:4000',
      '/ws': {
        target: 'ws://localhost:4000',
        ws: true,
      },
    },
  },
  plugins: [claudeVilleRuntimeConfigPlugin()],
  define: {
    // For production build: inline the values so runtime-config.ts uses them
    'import.meta.env.VITE_HUB_HTTP_URL': JSON.stringify(runtimeConfig.hubHttpUrl),
    'import.meta.env.VITE_HUB_WS_URL': JSON.stringify(runtimeConfig.hubWsUrl),
  },
  build: {
    outDir: '../dist/frontend',
    emptyOutDir: true,
  },
});
