/** @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { eventBus } from '../../domain/events/DomainEvent.js';
import { useHubVillageData } from './useHubVillageData.js';

const getSessions = vi.fn();
const connect = vi.fn();
const disconnect = vi.fn();

vi.mock('../../infrastructure/HubDataSource.js', () => ({
  HubDataSource: vi.fn().mockImplementation(function HubDataSource() {
    return {
    getSessions,
    };
  }),
}));

vi.mock('../../infrastructure/WebSocketClient.js', () => ({
  WebSocketClient: vi.fn().mockImplementation(function WebSocketClient() {
    return {
    connect,
    disconnect,
    };
  }),
}));

describe('useHubVillageData', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getSessions.mockReset();
    connect.mockReset();
    disconnect.mockReset();
    getSessions.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps selection callbacks stable across session updates', async () => {
    const { result, unmount } = renderHook(() => useHubVillageData());
    const selectAgent = result.current.selectAgent;
    const selectBuilding = result.current.selectBuilding;

    await act(async () => {
      eventBus.emit('ws:update', {
        sessions: [{
          sessionId: 'pi-session',
          provider: 'pi',
          status: 'active',
          lastActivity: Date.now(),
          project: '/tmp/project',
          lastTool: 'edit',
        }],
      });
    });

    expect(result.current.selectAgent).toBe(selectAgent);
    expect(result.current.selectBuilding).toBe(selectBuilding);

    unmount();
  });
});
