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
    // For production build: inline the full buildRuntimeConfig payload so
    // runtime-config.ts has it when nothing set __CLAUDEVILLE_CONFIG__ first —
    // the case for a bundle served by static hosting, where
    // /runtime-config.js does not exist. Every key buildRuntimeConfig() returns
    // must be here, or that deployment silently loses the field.
    'import.meta.env.VITE_HUB_HTTP_URL': JSON.stringify(runtimeConfig.hubHttpUrl),
    'import.meta.env.VITE_HUB_WS_URL': JSON.stringify(runtimeConfig.hubWsUrl),
    'import.meta.env.VITE_HUB_AUTH_TOKEN': JSON.stringify(runtimeConfig.hubAuthToken),
    'import.meta.env.VITE_NAME_MODE': JSON.stringify(runtimeConfig.nameMode),
    'import.meta.env.VITE_PROVIDER_NAME_MODES': JSON.stringify(runtimeConfig.providerNameModes),
    'import.meta.env.VITE_AGENT_NAME_POOL': JSON.stringify(runtimeConfig.agentNamePool),
    'import.meta.env.VITE_SESSION_NAME_POOL': JSON.stringify(runtimeConfig.sessionNamePool),
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
