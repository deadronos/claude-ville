import { defineConfig } from 'vite';

export default defineConfig({
  root: 'claudeville',
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
