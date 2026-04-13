/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ModeManager } from './ModeManager.js';

describe('ModeManager', () => {
  let manager: ModeManager;

  beforeEach(() => {
    // Build minimal DOM structure
    document.body.innerHTML = `
      <div id="characterMode"></div>
      <div id="dashboardMode" style="display:none"></div>
      <button id="btnModeCharacter" class="topbar__mode-btn--active"></button>
      <button id="btnModeDashboard"></button>
    `;
    manager = new ModeManager();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('constructor', () => {
    it('defaults to character mode', () => {
      expect(manager.getCurrentMode()).toBe('character');
    });

    it('stores references to DOM elements', () => {
      expect(manager.characterEl).not.toBeNull();
      expect(manager.dashboardEl).not.toBeNull();
      expect(manager.btnCharacter).not.toBeNull();
      expect(manager.btnDashboard).not.toBeNull();
    });
  });

  describe('switchMode', () => {
    it('switches to dashboard mode', () => {
      manager.switchMode('dashboard');
      expect(manager.getCurrentMode()).toBe('dashboard');
      expect(manager.dashboardEl!.style.display).toBe('');
      expect(manager.characterEl!.style.display).toBe('none');
    });

    it('switches back to character mode', () => {
      manager.switchMode('dashboard');
      manager.switchMode('character');
      expect(manager.getCurrentMode()).toBe('character');
      expect(manager.characterEl!.style.display).toBe('');
      expect(manager.dashboardEl!.style.display).toBe('none');
    });

    it('is a no-op when switching to the same mode', () => {
      manager.switchMode('character');
      expect(manager.getCurrentMode()).toBe('character');
    });

    it('updates active button classes when switching to dashboard', () => {
      manager.switchMode('dashboard');
      expect(manager.btnDashboard!.classList.contains('topbar__mode-btn--active')).toBe(true);
      expect(manager.btnCharacter!.classList.contains('topbar__mode-btn--active')).toBe(false);
    });

    it('updates active button classes when switching to character', () => {
      manager.switchMode('dashboard');
      manager.switchMode('character');
      expect(manager.btnCharacter!.classList.contains('topbar__mode-btn--active')).toBe(true);
      expect(manager.btnDashboard!.classList.contains('topbar__mode-btn--active')).toBe(false);
    });

    it('emits mode:changed event', async () => {
      const { eventBus } = await import('../domain/events/DomainEvent.js');
      const handler = { fn: null as any };
      handler.fn = vi.fn();
      eventBus.on('mode:changed', handler.fn);
      manager.switchMode('dashboard');
      expect(handler.fn).toHaveBeenCalledWith('dashboard');
      eventBus.off('mode:changed', handler.fn);
    });
  });

  describe('getCurrentMode', () => {
    it('returns current mode string', () => {
      expect(manager.getCurrentMode()).toBe('character');
      manager.switchMode('dashboard');
      expect(manager.getCurrentMode()).toBe('dashboard');
    });
  });

  describe('button click handlers', () => {
    it('switches to character when btnCharacter is clicked', () => {
      manager.switchMode('dashboard');
      manager.btnCharacter!.click();
      expect(manager.getCurrentMode()).toBe('character');
    });

    it('switches to dashboard when btnDashboard is clicked', () => {
      manager.btnDashboard!.click();
      expect(manager.getCurrentMode()).toBe('dashboard');
    });
  });
});
