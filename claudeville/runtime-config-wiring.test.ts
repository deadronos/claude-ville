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
 * The static-hosting half is also covered behaviourally in runtime-config.test.ts.
 * These file assertions cover what no runtime test can observe: an unimported
 * module, a missing script tag, a script tag made non-blocking, and a config
 * field that buildRuntimeConfig() emits but the build-time path drops.
 *
 * Entry points reach the hub through HubDataSource, which reads
 * window.__CLAUDEVILLE_CONFIG__ lazily on first call rather than in a
 * constructor.
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
      // Match the import statement, not a substring: a prose comment naming
      // /runtime-config.js would satisfy a bare indexOf and make this test pass
      // with the import deleted — which is the exact regression it guards.
      const match = source.match(/^\s*import\s+['"][^'"]*runtime-config\.js['"];?\s*$/m);
      expect(match, `${entry} must import the runtime-config module`).not.toBeNull();
      const importIndex = match!.index ?? -1;
      expect(importIndex, `${entry} must import it before ${appImport}`).toBeLessThan(
        source.indexOf(appImport),
      );
    });

    it('falls back to a token, not to undefined', () => {
      const module = read('runtime-config.ts');
      expect(module).toMatch(/hubAuthToken:\s*import\.meta\.env\.VITE_HUB_AUTH_TOKEN/);
    });

it('has a define entry for every field the fallback reads', () => {
      const viteConfig = fs.readFileSync(path.join(REPO_ROOT, 'vite.config.ts'), 'utf-8');
      const module = read('runtime-config.ts');
      for (const key of [...module.matchAll(/import\.meta\.env\.(VITE_\w+)/g)].map((m) => m[1])) {
        expect(viteConfig, `vite.config.ts must define ${key}`).toContain(`import.meta.env.${key}`);
      }
    });

    // The check that would have caught the four fields this fallback silently
    // dropped: anything buildRuntimeConfig() emits must survive into the
    // static-hosting path, or that deployment loses it with no error.
    it('carries every field buildRuntimeConfig() emits', () => {
      const shared = fs.readFileSync(path.join(REPO_ROOT, 'runtime-config.shared.ts'), 'utf-8');
      const returnBlock = shared.slice(shared.indexOf('return {', shared.indexOf('buildRuntimeConfig')));
      const fields = [...returnBlock.matchAll(/^\s{4}(\w+)[,:]/gm)].map((m) => m[1]);
      expect(fields.length).toBeGreaterThan(3);

      const module = read('runtime-config.ts');
      for (const field of fields) {
        expect(module, `runtime-config.ts fallback must carry ${field}`).toMatch(
          new RegExp(`^\\s{2}${field}:`, 'm'),
        );
      }
    });
  });

  describe('dynamic injection (legacy server)', () => {
    const htmlEntries = ['index.html', 'pixijs.html', 'voxel.html'] as const;

    // All three app entry points reach the hub through HubDataSource, which
    // reads the config lazily per call — so every page needs the dynamic path,
    // or it resolves the hub URL to whatever was baked at build time instead of
    // the serving server's own bound port.
    it.each(htmlEntries)('%s loads /runtime-config.js', (entry) => {
      expect(read(entry)).toContain('<script src="/runtime-config.js">');
    });

    it.each(htmlEntries)('%s loads it before its module entrypoint', (entry) => {
      const html = read(entry);
      const tagIndex = html.indexOf('/runtime-config.js');
      expect(tagIndex).toBeGreaterThan(-1);
      // Ordering is load-bearing: only a non-deferred classic script blocks the
      // parser and beats the deferred module entry.
      expect(tagIndex).toBeLessThan(html.indexOf('/src/'));
      expect(read(entry)).not.toMatch(/<script[^>]*runtime-config\.js[^>]*\b(?:defer|async|type="module")/);
    });
  });
});
