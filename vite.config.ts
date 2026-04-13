import './load-local-env.js';
import { defineConfig } from 'vite';
import { buildRuntimeConfig } from './runtime-config.shared.js';

const runtimeConfig = buildRuntimeConfig(process.env);

function serializeRuntimeConfig(config: unknown) {
  return JSON.stringify(config).replace(/</g, '\\u003c');
}

export default defineConfig({
  root: 'claudeville',
  plugins: [
    {
      name: 'claudeville-runtime-config',
      transformIndexHtml() {
        return {
          html: '',
          tags: [
            {
              tag: 'script',
              injectTo: 'head-prepend',
              children: `window.__CLAUDEVILLE_CONFIG__ = ${serializeRuntimeConfig(runtimeConfig)};`
            }
          ]
        };
      }
    }
  ],
  server: {
    port: 3001,
    proxy: {
      '/api': 'http://localhost:4000',
      '/runtime-config.js': 'http://localhost:4000'
    }
  },
  build: {
    outDir: '../dist/frontend',
    emptyOutDir: true
  }
});
