/**
 * Guards the wiring described in docs/architecture/001-split-stack-runtime.md:
 * the runtime config must reach the browser on every delivery path.
 *
 * Both halves of this failed silently once. `claudeville/runtime-config.ts` was
 * not imported by anything, so its build-time fallback never ran; and
 * `<script src="/runtime-config.js">` was dropped from index.html, so the
 * legacy server's endpoint was never requested. A production bundle therefore
 * booted with no config at all — see #128.
 *
 * These are assertions about files, not behaviour, because the failure mode is
 * an unimported module and a missing script tag — neither of which any runtime
 * test can observe.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const CLAUDEVILLE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const REPO_ROOT = path.resolve(CLAUDEVILLE_DIR, '..');

function read(filePath: string): string {
  return fs.readFileSync(path.join(CLAUDEVILLE_DIR, filePath), 'utf-8');
}

describe('runtime config delivery wiring', () => {
  describe('build-time fallback (static hosting)', () => {
    // All three entry points reach the hub through HubDataSource, which reads
    // window.__CLAUDEVILLE_CONFIG__ on construction, so each must load the
    // fallback module before its app import.
    const entryPoints = [
      ['src/main.tsx', './presentation/react/ClaudeVilleApp.js'],
      ['src/pixivillage/main.tsx', './PixiVillageApp.js'],
      ['src/voxelvillage/main.tsx', './VoxelVillageApp.js'],
    ] as const;

    it.each(entryPoints)('%s imports the fallback before its app import', (entry, appImport) => {
      const source = read(entry);
      const importIndex = source.indexOf('runtime-config.js');
      expect(importIndex, `${entry} must import the runtime-config module`).toBeGreaterThan(-1);
      expect(importIndex, `${entry} must import it before ${appImport}`).toBeLessThan(
        source.indexOf(appImport),
      );
    });

    it('falls back to a token, not to undefined', () => {
      expect(read('runtime-config.ts')).toContain('hubAuthToken: import.meta.env.VITE_HUB_AUTH_TOKEN');
    });

    it('has a define entry for every field the fallback reads', () => {
      const viteConfig = fs.readFileSync(path.join(REPO_ROOT, 'vite.config.ts'), 'utf-8');
      const module = read('runtime-config.ts');
      for (const key of [...module.matchAll(/import\.meta\.env\.(VITE_HUB_\w+)/g)].map((m) => m[1])) {
        expect(viteConfig, `vite.config.ts must define ${key}`).toContain(`import.meta.env.${key}`);
      }
    });
  });

  describe('dynamic injection (legacy server)', () => {
    it('loads /runtime-config.js from index.html', () => {
      expect(read('index.html')).toContain('<script src="/runtime-config.js">');
    });

    it('loads it before the module entrypoint', () => {
      const html = read('index.html');
      expect(html.indexOf('/runtime-config.js')).toBeLessThan(html.indexOf('/src/main.tsx'));
    });

    it('is served by the legacy server at that exact path', () => {
      const server = fs.readFileSync(path.join(CLAUDEVILLE_DIR, 'server.ts'), 'utf-8');
      expect(server).toContain("pathname === '/runtime-config.js'");
    });
  });
});
