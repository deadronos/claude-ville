import { describe, it, expect, vi } from 'vitest';
import { logger } from '../../shared/logger.js';

// Spy on logger methods to prevent console logs during tests and track calls
vi.spyOn(logger, 'info').mockImplementation(() => {});
vi.spyOn(logger, 'log').mockImplementation(() => {});
vi.spyOn(logger, 'warn').mockImplementation(() => {});
vi.spyOn(logger, 'error').mockImplementation(() => {});

// Mock execFile to prevent spawning child processes during tests and make it instant
vi.mock('child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('child_process')>();
  return {
    ...original,
    execFile: (file: string, args: any[], options: any, callback: any) => {
      const cb = typeof options === 'function' ? options : callback;
      if (cb) {
        process.nextTick(() => cb(null, 'Logged in as test@example.com', ''));
      }
      return {} as any;
    }
  };
});

// Test the usageQuota module interface
describe('usageQuota', () => {
  describe('module interface', () => {
    it('exports fetchUsage function', async () => {
      const usageQuota = await import('./usageQuota.js');
      expect(typeof usageQuota.fetchUsage).toBe('function');
    });

    it('exports init function', async () => {
      const usageQuota = await import('./usageQuota.js');
      expect(typeof usageQuota.init).toBe('function');
    });

    it('fetchUsage returns expected structure', async () => {
      const { fetchUsage } = await import('./usageQuota.js');
      const usage = await fetchUsage();

      // Verify all expected properties exist
      expect(usage).toHaveProperty('account');
      expect(usage).toHaveProperty('quota');
      expect(usage).toHaveProperty('activity');
      expect(usage).toHaveProperty('totals');
      expect(usage).toHaveProperty('quotaAvailable');
    });

    it('account has subscription properties', async () => {
      const { fetchUsage } = await import('./usageQuota.js');
      const usage = await fetchUsage();

      expect(usage.account).toHaveProperty('subscriptionType');
      expect(usage.account).toHaveProperty('rateLimitTier');
      expect(usage.account).toHaveProperty('email');
    });

    it('quota has fiveHour and sevenDay properties', async () => {
      const { fetchUsage } = await import('./usageQuota.js');
      const usage = await fetchUsage();

      expect(usage.quota).toHaveProperty('fiveHour');
      expect(usage.quota).toHaveProperty('sevenDay');
    });

    it('activity has today and thisWeek with messages/sessions', async () => {
      const { fetchUsage } = await import('./usageQuota.js');
      const usage = await fetchUsage();

      expect(usage.activity).toHaveProperty('today');
      expect(usage.activity).toHaveProperty('thisWeek');
      expect(usage.activity.today).toHaveProperty('messages');
      expect(usage.activity.today).toHaveProperty('sessions');
      expect(usage.activity.thisWeek).toHaveProperty('messages');
      expect(usage.activity.thisWeek).toHaveProperty('sessions');
    });

    it('totals has sessions and messages counts', async () => {
      const { fetchUsage } = await import('./usageQuota.js');
      const usage = await fetchUsage();

      expect(usage.totals).toHaveProperty('sessions');
      expect(usage.totals).toHaveProperty('messages');
      expect(typeof usage.totals.sessions).toBe('number');
      expect(typeof usage.totals.messages).toBe('number');
    });

    it('quotaAvailable is a boolean', async () => {
      const { fetchUsage } = await import('./usageQuota.js');
      const usage = await fetchUsage();

      expect(typeof usage.quotaAvailable).toBe('boolean');
    });
  });

  describe('init behavior', () => {
    it('init is callable and calls the logger', async () => {
      const { init } = await import('./usageQuota.js');
      init();

      // Wait for the async fetchEmail in init
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(logger.info).toHaveBeenCalled();
    });
  });
});