import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('openclaw adapter', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const tmp of tmpDirs) {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
    tmpDirs.length = 0;
  });

  describe('OpenClawAdapter class', () => {
    it('can be imported', async () => {
      const { OpenClawAdapter } = await import('./openclaw.js');
      expect(typeof OpenClawAdapter).toBe('function');
    });

    it('instance has expected properties', () => {
      const { OpenClawAdapter } = require('./openclaw.js');
      const adapter = new OpenClawAdapter();
      expect(adapter.provider).toBe('openclaw');
      expect(adapter.name).toBe('OpenClaw');
      expect(adapter.homeDir).toContain('.openclaw');
    });
  });
});