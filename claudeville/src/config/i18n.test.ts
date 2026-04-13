/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { i18n } from './i18n.js';

describe('i18n (real module, jsdom)', () => {
  afterEach(() => {
    // Reset language to en between tests
    i18n._lang = 'en';
    localStorage.removeItem('claudeville-lang');
  });

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
  });

  describe('lang getter/setter', () => {
    it('getter returns current lang', () => {
      expect(i18n.lang).toBe('en');
    });

    it('setter updates lang and persists to localStorage', () => {
      i18n.lang = 'ko';
      expect(i18n.lang).toBe('ko');
      expect(localStorage.getItem('claudeville-lang')).toBe('ko');
    });

    it('setter emits i18n:language-changed event', async () => {
      const handler = { fn: null as any };
      handler.fn = vi.fn();
      const { eventBus } = await import('../domain/events/DomainEvent.js');
      eventBus.on('i18n:language-changed', handler.fn);
      i18n.lang = 'fr';
      expect(handler.fn).toHaveBeenCalledWith('fr');
      eventBus.off('i18n:language-changed', handler.fn);
    });

    it('setter is a no-op when setting same lang', async () => {
      i18n.lang = 'en';
      const handler = { fn: null as any };
      handler.fn = vi.fn();
      const { eventBus } = await import('../domain/events/DomainEvent.js');
      eventBus.on('i18n:language-changed', handler.fn);
      i18n.lang = 'en'; // same, should not emit
      expect(handler.fn).not.toHaveBeenCalled();
      eventBus.off('i18n:language-changed', handler.fn);
    });
  });
});
