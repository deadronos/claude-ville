/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { i18n } from './i18n.js';

describe('i18n (real module, jsdom)', () => {
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
    // Every one of these is used as an aria-label in the TSX. If a key is
    // missing, i18n.t() returns the key itself and a screen reader announces
    // the raw identifier — so each needs a real, sentence-cased string.
    const accessibleNameKeys = [
      'agentList',
      'agentCount',
      'totalAgents',
      'agentStats',
      'viewMode',
      'focusAgent',
      'lastMessage',
      'projectPath',
      'close',
    ];

    it.each(accessibleNameKeys)('%s resolves to a real string, not the key', (key) => {
      const value = i18n.t(key);
      expect(value).not.toBe(key);
      expect(value.length).toBeGreaterThan(0);
    });

    it('uses sentence case so screen readers do not spell out uppercase', () => {
      for (const key of accessibleNameKeys) {
        expect(i18n.t(key)).toBe(i18n.t(key)[0].toUpperCase() + i18n.t(key).slice(1));
      }
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
