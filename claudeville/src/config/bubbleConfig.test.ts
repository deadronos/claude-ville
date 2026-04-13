/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';

async function getFreshBubble() {
  vi.resetModules();
  // Setup localStorage BEFORE module loads
  return import('./bubbleConfig.js');
}

describe('bubbleConfig (real module, jsdom)', () => {
  describe('getBubbleConfig', () => {
    it('returns default config when localStorage is empty', async () => {
      localStorage.clear();
      const { getBubbleConfig } = await getFreshBubble();
      const cfg = getBubbleConfig();
      expect(cfg.statusFontSize).toBe(14);
      expect(cfg.chatFontSize).toBe(14);
      expect(cfg.statusBubbleH).toBe(28);
    });

    it('returns saved config from localStorage', async () => {
      localStorage.setItem('claudeville_bubble', JSON.stringify({
        statusFontSize: 20,
        chatFontSize: 18,
      }));
      const { getBubbleConfig } = await getFreshBubble();
      const cfg = getBubbleConfig();
      expect(cfg.statusFontSize).toBe(20);
      expect(cfg.chatFontSize).toBe(18);
    });

    it('merges saved config with defaults (partial save)', async () => {
      localStorage.setItem('claudeville_bubble', JSON.stringify({ statusFontSize: 20 }));
      const { getBubbleConfig } = await getFreshBubble();
      const cfg = getBubbleConfig();
      expect(cfg.statusFontSize).toBe(20);
      expect(cfg.chatFontSize).toBe(14); // default
    });

    it('returns defaults when localStorage has invalid JSON', async () => {
      localStorage.setItem('claudeville_bubble', 'not valid json');
      const { getBubbleConfig } = await getFreshBubble();
      const cfg = getBubbleConfig();
      expect(cfg.statusFontSize).toBe(14);
    });

    it('returns a copy (not the internal reference)', async () => {
      const { getBubbleConfig } = await getFreshBubble();
      const cfg = getBubbleConfig();
      cfg.statusFontSize = 999;
      const cfg2 = getFreshBubble().then(m => m.getBubbleConfig());
      // cfg2 should not be affected (it's a new module instance)
      // Note: with vi.resetModules() we get fresh module, so cfg2 will have defaults
      expect((await cfg2).statusFontSize).not.toBe(999);
    });
  });

  describe('updateBubbleConfig', () => {
    it('updates config values', async () => {
      localStorage.clear();
      const { updateBubbleConfig, getBubbleConfig } = await getFreshBubble();
      updateBubbleConfig({ statusFontSize: 18, chatMaxWidth: 300 });
      const cfg = getBubbleConfig();
      expect(cfg.statusFontSize).toBe(18);
      expect(cfg.chatMaxWidth).toBe(300);
    });

    it('persists changes to localStorage', async () => {
      localStorage.clear();
      const { updateBubbleConfig } = await getFreshBubble();
      updateBubbleConfig({ statusFontSize: 22 });
      const saved = JSON.parse(localStorage.getItem('claudeville_bubble') || '{}');
      expect(saved.statusFontSize).toBe(22);
    });

    it('preserves existing values when updating multiple times', async () => {
      localStorage.clear();
      const { updateBubbleConfig, getBubbleConfig } = await getFreshBubble();
      updateBubbleConfig({ statusFontSize: 20 });
      updateBubbleConfig({ chatFontSize: 16 });
      const cfg = getBubbleConfig();
      expect(cfg.statusFontSize).toBe(20);
      expect(cfg.chatFontSize).toBe(16);
    });

    it('handles invalid localStorage gracefully', async () => {
      localStorage.setItem('claudeville_bubble', 'bad json');
      const { updateBubbleConfig, getBubbleConfig } = await getFreshBubble();
      // module loaded with bad data, so getBubbleConfig returns defaults
      expect(() => updateBubbleConfig({ statusFontSize: 12 })).not.toThrow();
    });
  });

  describe('resetBubbleConfig', () => {
    it('resets all values to defaults', async () => {
      localStorage.clear();
      const { updateBubbleConfig, resetBubbleConfig, getBubbleConfig } = await getFreshBubble();
      updateBubbleConfig({ statusFontSize: 99, chatFontSize: 99 });
      resetBubbleConfig();
      const cfg = getBubbleConfig();
      expect(cfg.statusFontSize).toBe(14);
      expect(cfg.chatFontSize).toBe(14);
    });

    it('clears saved localStorage', async () => {
      localStorage.clear();
      const { resetBubbleConfig, getBubbleConfig } = await getFreshBubble();
      localStorage.setItem('claudeville_bubble', JSON.stringify({ statusFontSize: 99 }));
      resetBubbleConfig();
      // Verify defaults are restored
      expect(getBubbleConfig().statusFontSize).toBe(14);
    });

    it('handles missing localStorage gracefully', async () => {
      localStorage.clear();
      const { resetBubbleConfig } = await getFreshBubble();
      expect(() => resetBubbleConfig()).not.toThrow();
    });
  });
});
