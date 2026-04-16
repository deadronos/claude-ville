/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Toast } from './Toast.js';

describe('Toast', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="toastContainer"></div>';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('renders toasts, enforces the cap, and auto-dismisses them', () => {
    const toast = new Toast();

    for (let index = 1; index <= 6; index += 1) {
      toast.show(`Toast ${index}`, index % 2 === 0 ? 'success' : 'info');
    }

    expect(document.querySelectorAll('#toastContainer .toast')).toHaveLength(5);
    expect(document.getElementById('toastContainer')?.textContent).not.toContain('Toast 1');

    vi.advanceTimersByTime(3000);
    expect(document.querySelectorAll('#toastContainer .toast--fadeout')).toHaveLength(5);

    vi.advanceTimersByTime(300);
    expect(document.querySelectorAll('#toastContainer .toast')).toHaveLength(0);

    toast.destroy();
  });

  it('clears timers and removes remaining toasts on destroy', () => {
    const toast = new Toast();

    toast.show('Keep me', 'warning');
    toast.show('And me', 'info');

    expect(document.querySelectorAll('#toastContainer .toast')).toHaveLength(2);

    toast.destroy();

    expect(document.querySelectorAll('#toastContainer .toast')).toHaveLength(0);
    expect(toast.toasts).toHaveLength(0);
  });
});