/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { eventBus } from '../../domain/events/DomainEvent.js';
import { TopBar } from './TopBar.js';

describe('TopBar', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="statTime"></div>
      <span id="badgeWorking"></span>
      <span id="badgeIdle"></span>
      <span id="badgeWaiting"></span>
    `;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders stats, updates the clock, and reacts to agent events', () => {
    const world = {
      activeTime: 3661,
      getStats: vi.fn(() => ({ working: 1, idle: 2, waiting: 3 })),
    };

    const topBar = new TopBar(world as any);

    expect(document.getElementById('badgeWorking')?.textContent).toBe('1');
    expect(document.getElementById('badgeIdle')?.textContent).toBe('2');
    expect(document.getElementById('badgeWaiting')?.textContent).toBe('3');

    vi.advanceTimersByTime(1000);
    expect(document.getElementById('statTime')?.textContent).toBe('01:01:01');

    world.getStats.mockReturnValue({ working: 4, idle: 5, waiting: 6 });
    eventBus.emit('agent:updated');

    expect(document.getElementById('badgeWorking')?.textContent).toBe('4');
    expect(document.getElementById('badgeIdle')?.textContent).toBe('5');
    expect(document.getElementById('badgeWaiting')?.textContent).toBe('6');

    topBar.destroy();
  });

  it('stops updating after destroy', () => {
    const world = {
      activeTime: 10,
      getStats: vi.fn(() => ({ working: 7, idle: 8, waiting: 9 })),
    };

    const topBar = new TopBar(world as any);

    topBar.destroy();
    world.activeTime = 7200;
    world.getStats.mockReturnValue({ working: 1, idle: 1, waiting: 1 });

    eventBus.emit('agent:updated');
    vi.advanceTimersByTime(1000);

    expect(document.getElementById('badgeWorking')?.textContent).toBe('7');
    expect(document.getElementById('statTime')?.textContent).not.toBe('02:00:00');
  });
});