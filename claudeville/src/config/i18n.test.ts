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
