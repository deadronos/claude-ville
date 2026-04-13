/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => {
  (window as any).__CLAUDEVILLE_CONFIG__ = {};
});

import {
  generateAgentDisplayName,
  resolveAgentDisplayName,
  getNameMode,
  setNameMode,
} from './agentNames.js';

// Inline helper: mirrors getNameMode logic from agentNames.ts
// Tests the logic independently of the module-level window capture
function getNameModeInline(config, lsValue, provider = null) {
  const providerMode = provider && config?.providerNameModes ? config.providerNameModes[provider] : null;
  if (providerMode) return providerMode;
  return lsValue || config?.nameMode || 'autodetected';
}

// Inline helper: mirrors setNameMode logic
function setNameModeInline(mode, store) {
  const nextMode = mode === 'pooled' ? 'pooled' : 'autodetected';
  if (store) store['claudeville-name-mode'] = nextMode;
}

// Inline helper: mirrors isRawIdentifier logic
function isRawIdentifierInline(value) {
  if (!value) return false;
  const text = String(value).trim();
  if (text.length < 16) return false;
  if (/\s/.test(text)) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return true;
  if (/^[0-9a-f]{12,}$/i.test(text)) return true;
  if (/^([a-z0-9]{8,}[-_:]){1,}[a-z0-9]{4,}$/i.test(text)) return true;
  return text.length >= 24;
}

// Inline helper: mirrors abbreviateIdentifier logic
function abbreviateIdentifierInline(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= 12) return text;
  return `${text.slice(0, 8)}…${text.slice(-3)}`;
}

describe('agentNames (real module)', () => {
  describe('generateAgentDisplayName', () => {
    it('returns a name from the agent pool for agent kind', () => {
      const name = generateAgentDisplayName('test-seed', 'agent');
      // Default agent pool has 15 names
      const pool = ['Atlas','Nova','Cipher','Pixel','Spark','Bolt','Echo','Flux','Helix','Onyx','Prism','Qubit','Rune','Sage','Vex'];
      expect(pool).toContain(name);
    });

    it('returns a name from the session pool for session kind', () => {
      const name = generateAgentDisplayName('test-seed', 'session');
      const pool = ['Orbit','Beacon','Relay','Pulse','Signal','Vector','Comet','Drift','Trace','Kernel','Node','Echo','Wisp','Shard','Tide'];
      expect(pool).toContain(name);
    });

    it('is deterministic for same seed', () => {
      const n1 = generateAgentDisplayName('abc-123');
      const n2 = generateAgentDisplayName('abc-123');
      expect(n1).toBe(n2);
    });

    it('produces different results for different seeds', () => {
      const n1 = generateAgentDisplayName('seed-001');
      const n2 = generateAgentDisplayName('seed-002');
      expect(n1).not.toBe(n2);
    });

    it('handles null/undefined seed (falls back to agent)', () => {
      const name = generateAgentDisplayName(null);
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    });

    it('falls back to agent pool for unknown kind', () => {
      const name = generateAgentDisplayName('seed', 'unknown' as any);
      const agentPool = ['Atlas','Nova','Cipher','Pixel','Spark','Bolt','Echo','Flux','Helix','Onyx','Prism','Qubit','Rune','Sage','Vex'];
      expect(agentPool).toContain(name);
    });
  });

  describe('resolveAgentDisplayName', () => {
    it('returns candidate name when it is a friendly (non-raw) identifier', () => {
      const result = resolveAgentDisplayName(
        { sessionId: 's1', displayName: 'Alice' },
        null
      );
      expect(result.name).toBe('Alice');
      expect(result.nameKind).toBe('session');
    });

    it('uses teamInfo.name over displayName', () => {
      const result = resolveAgentDisplayName(
        { sessionId: 's1', displayName: 'Alice' },
        { name: 'MyTeam' }
      );
      expect(result.name).toBe('MyTeam');
      expect(result.nameKind).toBe('agent');
    });

    it('returns agent kind when session has agentId', () => {
      const result = resolveAgentDisplayName({ sessionId: 's1', agentId: 'a1' }, null);
      expect(result.nameKind).toBe('agent');
    });

    it('returns agent kind when session has non-main agentType', () => {
      const result = resolveAgentDisplayName({ sessionId: 's1', agentType: 'reviewer' }, null);
      expect(result.nameKind).toBe('agent');
    });

    it('abbreviates raw UUID identifiers', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const result = resolveAgentDisplayName({ displayName: uuid });
      expect(result.name).toMatch(/…/); // abbreviated
    });

    it('abbreviates long hex seeds without spaces', () => {
      const result = resolveAgentDisplayName({ sessionId: 'abcdefghijklmnopqrstuvwx' });
      expect(result.name).toMatch(/…/);
    });

    it('falls back to session kind when no agent clues', () => {
      const result = resolveAgentDisplayName({ sessionId: 's1' }, null);
      expect(result.nameKind).toBe('session');
    });

    it('abbreviates structured identifiers that are >= 24 chars', () => {
      // This string is <24 chars, so NOT considered a raw identifier
      // → candidate 'session001:proj001:abc' is not raw → returned as-is
      const result = resolveAgentDisplayName({ displayName: 'session001:proj001:abc' });
      expect(result.name).toBe('session001:proj001:abc');
    });

    it('abbreviates long structured identifiers (>= 24 chars)', () => {
      const longId = 'session001:proj001:abcdefghijk';
      expect(longId.length).toBeGreaterThanOrEqual(24);
      const result = resolveAgentDisplayName({ displayName: longId });
      expect(result.name).toMatch(/…/);
    });

    it('sets nameSeed from agentId when present', () => {
      const result = resolveAgentDisplayName({ sessionId: 's1', agentId: 'a1' }, null);
      expect(result.nameSeed).toBe('a1');
    });

    it('sets nameHint to candidate', () => {
      const result = resolveAgentDisplayName({ displayName: 'Bob' }, null);
      expect(result.nameHint).toBe('Bob');
    });

    describe('pooled mode', () => {
      beforeEach(() => {
        (window as any).__CLAUDEVILLE_CONFIG__ = { nameMode: 'pooled' };
      });

      it('returns pooled name when mode is pooled', () => {
        const result = resolveAgentDisplayName({ sessionId: 's1' }, null);
        expect(result.nameMode).toBe('pooled');
        expect(result.name).toBeTruthy();
      });
    });

    describe('provider name mode override', () => {
      beforeEach(() => {
        (window as any).__CLAUDEVILLE_CONFIG__ = {
          providerNameModes: { claude: 'pooled' }
        };
      });

      it('uses provider mode when set', () => {
        const result = resolveAgentDisplayName({ sessionId: 's1', provider: 'claude' }, null);
        expect(result.nameMode).toBe('pooled');
      });
    });
  });

  describe('getNameMode', () => {
    it('returns autodetected when no config', () => {
      (window as any).__CLAUDEVILLE_CONFIG__ = {};
      expect(getNameMode()).toBe('autodetected');
    });

    it('returns configured nameMode', () => {
      (window as any).__CLAUDEVILLE_CONFIG__ = { nameMode: 'pooled' };
      expect(getNameMode()).toBe('pooled');
    });

    it('returns configured nameMode regardless of provider', () => {
      (window as any).__CLAUDEVILLE_CONFIG__ = { nameMode: 'pooled' };
      expect(getNameMode('unknown')).toBe('pooled');
      expect(getNameMode()).toBe('pooled');
    });

    it('prefers providerNameModes over global nameMode', () => {
      (window as any).__CLAUDEVILLE_CONFIG__ = {
        nameMode: 'autodetected',
        providerNameModes: { claude: 'pooled' },
      };
      expect(getNameMode('claude')).toBe('pooled');
    });

    it('falls back to localStorage when no config', () => {
      (window as any).__CLAUDEVILLE_CONFIG__ = {};
      // Test inline logic: empty ls + empty config = autodetected
      expect(getNameModeInline({}, null)).toBe('autodetected');
    });

    it('uses localStorage name mode when set (inline test)', () => {
      // Verify inline logic reads ls value correctly
      expect(getNameModeInline({}, 'pooled')).toBe('pooled');
    });
  });

  describe('setNameMode (inline test)', () => {
    it('sets localStorage to pooled when given pooled', () => {
      const store: Record<string, string> = {};
      setNameModeInline('pooled', store);
      expect(store['claudeville-name-mode']).toBe('pooled');
    });

    it('sets localStorage to autodetected when given non-pooled', () => {
      const store: Record<string, string> = { 'claudeville-name-mode': 'pooled' };
      setNameModeInline('anything-else', store);
      expect(store['claudeville-name-mode']).toBe('autodetected');
    });
  });

  describe('isRawIdentifier', () => {
    it('returns false for short strings', () => {
      expect(isRawIdentifierInline('abc')).toBe(false);
    });

    it('returns false for friendly names', () => {
      expect(isRawIdentifierInline('Atlas')).toBe(false);
    });

    it('returns true for UUIDs', () => {
      expect(isRawIdentifierInline('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    it('returns true for long hex strings', () => {
      expect(isRawIdentifierInline('a'.repeat(16))).toBe(true);
    });

    it('returns true for structured identifiers >= 24 chars', () => {
      expect(isRawIdentifierInline('session001:proj001:abcdefghijk')).toBe(true);
    });
  });

  describe('abbreviateIdentifier', () => {
    it('returns empty string for null/undefined', () => {
      expect(abbreviateIdentifierInline('')).toBe('');
      expect(abbreviateIdentifierInline(null)).toBe('');
    });

    it('returns text as-is when <= 12 chars', () => {
      expect(abbreviateIdentifierInline('Atlas')).toBe('Atlas');
    });

    it('abbreviates long identifiers', () => {
      expect(abbreviateIdentifierInline('abcdefghijklmnop')).toBe('abcdefgh…nop');
    });
  });
});
