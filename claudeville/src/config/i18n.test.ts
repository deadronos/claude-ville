/** @vitest-environment node */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { i18n } from './i18n.js';

describe('i18n (real module)', () => {
  describe('t()', () => {
    it('returns the string for known key', () => {
      expect(i18n.t('working')).toBe('WORKING');
      expect(i18n.t('idle')).toBe('IDLE');
      expect(i18n.t('waiting')).toBe('WAITING');
    });

    it('returns the key itself when not found', () => {
      expect(i18n.t('unknown.key')).toBe('unknown.key');
    });

    it('interpolates function-valued strings', () => {
      // agentJoined receives the name directly: t('agentJoined', 'Alice')
      expect(i18n.t('agentJoined', 'Alice')).toBe('Alice joined the village');
      expect(i18n.t('agentLeft', 'Bob')).toBe('Bob left the village');
    });

    it('handles undefined gracefully in function templates', () => {
      // When no data passed, the function receives undefined → "${undefined}"
      expect(i18n.t('agentJoined')).toBe('undefined joined the village');
    });

    it('interpolates nAgents', () => {
      expect(i18n.t('nAgents', 5)).toBe('5 agents');
      expect(i18n.t('nAgents', 0)).toBe('0 agents');
    });

    it('interpolates nameModeChanged', () => {
      expect(i18n.t('nameModeChanged', { mode: 'pooled' })).toBe('Name mode set to pooled');
    });

    it('interpolates contextUsage', () => {
      expect(i18n.t('contextUsage', { percent: 42 })).toBe('Context 42%');
    });

    it('interpolates viewAgentDetails', () => {
      expect(i18n.t('viewAgentDetails', { name: 'Scout 7' })).toBe('View details for Scout 7');
    });
  });

  describe('accessible names', () => {
    // Every one of these is used as an aria-label, or as a .sr-only prefix, in
    // the TSX. If a key is missing, i18n.t() returns the key itself and a screen
    // reader announces the raw identifier — so each needs a real, sentence-cased
    // string.
    const accessibleNameKeys = [
      'agentList',
      'agentCount',
      'totalAgents',
      'agentStats',
      'viewMode',
      'focusAgent',
      'close',
    ];

    it.each(accessibleNameKeys)('%s resolves to a real string, not the key', (key) => {
      expect(i18n.t(key)).not.toBe(key);
    });

    it('uses sentence case so screen readers do not spell out uppercase', () => {
      for (const key of accessibleNameKeys) {
        const value = i18n.t(key);
        // Every character after the first must be lowercase, so 'AGENT LIST'
        // fails while 'Agent list' passes.
        expect(value.slice(1)).toBe(value.slice(1).toLowerCase());
      }
    });
  });

  describe('key coverage', () => {
    // Guards the whole bug class rather than a hand-copied list of the keys
    // that were once missing: any i18n.t('literal') call anywhere in the app
    // must name a key that exists, or a screen reader announces the identifier.
    const SRC = path.resolve(__dirname, '..');

    // Function-valued keys take a data argument, so they cannot be called with
    // no argument. Each is paired with the data its call site passes.
    const KEY_ARGS: Record<string, unknown> = {
      viewAgentDetails: { name: 'Scout 7' },
      nAgents: 1,
      contextUsage: { percent: 1 },
      nameModeChanged: { mode: 'pooled' },
      agentJoined: 'Alice',
      agentLeft: 'Bob',
    };

    function collectKeys(dir: string): string[] {
      const keys: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          keys.push(...collectKeys(full));
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          const source = fs.readFileSync(full, 'utf-8');
          for (const match of source.matchAll(/i18n\.t\(\s*'([A-Za-z0-9_]+)'/g)) {
            keys.push(match[1]);
          }
        }
      }
      return keys;
    }

    const usedKeys = [...new Set(collectKeys(SRC))].sort();

    it('finds call sites to check', () => {
      // If a refactor moves the app, this test would silently pass on an empty
      // set. Fail loudly instead.
      expect(usedKeys.length).toBeGreaterThan(20);
    });

    it.each(usedKeys)('i18n.t(%s) resolves to a defined string', (key) => {
      const value = i18n.t(key, KEY_ARGS[key]);
      expect(value).not.toBe(key);
      expect(value).toBeTruthy();
    });
  });

  describe('lang', () => {
    it('getter returns current lang', () => {
      expect(i18n.lang).toBe('en');
    });

    it('exposes lang as a read-only default', () => {
      expect(i18n.lang).toBe('en');
      expect(Object.getOwnPropertyDescriptor(i18n, 'lang')?.set).toBeUndefined();
    });
  });
});
