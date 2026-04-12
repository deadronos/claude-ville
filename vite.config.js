"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vite_1 = require("vite");
exports.default = (0, vite_1.defineConfig)({
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
