/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionWatcher } from './SessionWatcher.js';

describe('SessionWatcher', () => {
  let mockAgentManager: any;
  let mockWsClient: any;
  let mockDataSource: any;
  let watcher: SessionWatcher;

  beforeEach(() => {
    vi.useFakeTimers();

    mockAgentManager = {
      handleWebSocketMessage: vi.fn(),
    };

    mockWsClient = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      isConnected: false,
    };

    mockDataSource = {
      getSessions: vi.fn().mockResolvedValue([]),
      getUsage: vi.fn().mockResolvedValue(null),
    };

    watcher = new SessionWatcher(mockAgentManager, mockWsClient, mockDataSource);
  });

  afterEach(() => {
    watcher.stop();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('stores references to dependencies', () => {
      expect(watcher.agentManager).toBe(mockAgentManager);
      expect(watcher.wsClient).toBe(mockWsClient);
      expect(watcher.dataSource).toBe(mockDataSource);
    });

    it('starts with running=false', () => {
      expect(watcher.running).toBe(false);
    });

    it('starts with no pollTimer', () => {
      expect(watcher.pollTimer).toBeNull();
    });
  });

  describe('start()', () => {
    it('sets running to true', () => {
      watcher.start();
      expect(watcher.running).toBe(true);
    });

    it('calls wsClient.connect()', () => {
      watcher.start();
      expect(mockWsClient.connect).toHaveBeenCalled();
    });

    it('starts polling as fallback when ws not connected', () => {
      watcher.start();
      // Since isConnected is false, polling should have started
      // _startPolling calls _poll immediately, then sets interval
      expect(mockDataSource.getSessions).toHaveBeenCalled();
    });

    it('still starts polling even when ws is already connected', () => {
      mockWsClient.isConnected = true;
      watcher.start();
      // Polling should run regardless of WS connection state
      expect(mockDataSource.getSessions).toHaveBeenCalled();
    });

    it('is a no-op if already running', () => {
      watcher.start();
      const callCount = mockWsClient.connect.mock.calls.length;
      watcher.start();
      expect(mockWsClient.connect.mock.calls.length).toBe(callCount);
    });

    it('subscribes to ws:init event', async () => {
      const { eventBus } = await import('../domain/events/DomainEvent.js');
      watcher.start();
      mockAgentManager.handleWebSocketMessage.mockClear();
      eventBus.emit('ws:init', { sessions: [{ sessionId: 's1' }] });
      expect(mockAgentManager.handleWebSocketMessage).toHaveBeenCalledWith({ sessions: [{ sessionId: 's1' }] });
    });

    it('subscribes to ws:update event', async () => {
      const { eventBus } = await import('../domain/events/DomainEvent.js');
      watcher.start();
      mockAgentManager.handleWebSocketMessage.mockClear();
      eventBus.emit('ws:update', { sessions: [{ sessionId: 's2' }] });
      expect(mockAgentManager.handleWebSocketMessage).toHaveBeenCalled();
    });

    it('starts polling on ws:disconnected event', async () => {
      const { eventBus } = await import('../domain/events/DomainEvent.js');
      // Create a separate watcher so we can test disconnect WITHOUT it having
      // already started polling from start() (which would set pollTimer != null)
      const watcher2 = new SessionWatcher(mockAgentManager, mockWsClient, mockDataSource);
      watcher2.start();
      mockDataSource.getSessions.mockClear();
      // watcher2.start() sets isConnected=false so polling already started,
      // but we want to test the DISCONNECT event triggering _startPolling.
      // Simulate being in a connected state first:
      mockWsClient.isConnected = true;
      watcher2['_stopPolling'](); // clear the initial pollTimer
      mockDataSource.getSessions.mockClear();
      eventBus.emit('ws:disconnected');
      // _startPolling calls _poll() which synchronously calls getSessions
      expect(mockDataSource.getSessions).toHaveBeenCalled();
      watcher2.stop();
    });

    it('does a catch-up poll on ws:connected event', async () => {
      const { eventBus } = await import('../domain/events/DomainEvent.js');
      watcher.start();
      const callsAfterStart = mockDataSource.getSessions.mock.calls.length;
      // Simulate disconnect then connect
      eventBus.emit('ws:disconnected');
      eventBus.emit('ws:connected');
      // After connect, a catch-up poll should run once while the fallback timer stays alive.
      expect(mockDataSource.getSessions.mock.calls.length).toBe(callsAfterStart + 1);
    });
  });

  describe('stop()', () => {
    it('sets running to false', () => {
      watcher.start();
      watcher.stop();
      expect(watcher.running).toBe(false);
    });

    it('clears pollTimer', () => {
      watcher.start();
      watcher.stop();
      expect(watcher.pollTimer).toBeNull();
    });

    it('disconnects wsClient', () => {
      watcher.start();
      watcher.stop();
      expect(mockWsClient.disconnect).toHaveBeenCalled();
    });

    it('is safe to call when not running', () => {
      expect(() => watcher.stop()).not.toThrow();
    });
  });

  describe('_poll()', () => {
    it('calls dataSource.getSessions and getUsage', async () => {
      const sessions = [{ sessionId: 's1' }];
      const usage = { total: 100 };
      mockDataSource.getSessions.mockResolvedValue(sessions);
      mockDataSource.getUsage.mockResolvedValue(usage);

      watcher.start();
      await watcher._poll();

      expect(mockDataSource.getSessions).toHaveBeenCalled();
      expect(mockDataSource.getUsage).toHaveBeenCalled();
    });

    it('calls handleWebSocketMessage with sessions', async () => {
      const sessions = [{ sessionId: 's1' }, { sessionId: 's2' }];
      mockDataSource.getSessions.mockResolvedValue(sessions);

      await watcher._poll();

      expect(mockAgentManager.handleWebSocketMessage).toHaveBeenCalledWith({ sessions });
    });

    it('emits usage:updated event when usage is returned', async () => {
      const { eventBus } = await import('../domain/events/DomainEvent.js');
      const usage = { total: 100 };
      mockDataSource.getUsage.mockResolvedValue(usage);

      const handler = vi.fn();
      eventBus.on('usage:updated', handler);

      await watcher._poll();
      expect(handler).toHaveBeenCalledWith(usage);

      eventBus.off('usage:updated', handler);
    });

    it('emits nothing for null usage', async () => {
      const { eventBus } = await import('../domain/events/DomainEvent.js');
      mockDataSource.getUsage.mockResolvedValue(null);

      const handler = vi.fn();
      eventBus.on('usage:updated', handler);

      await watcher._poll();
      expect(handler).not.toHaveBeenCalled();

      eventBus.off('usage:updated', handler);
    });

    it('handles errors gracefully', async () => {
      mockDataSource.getSessions.mockRejectedValue(new Error('Network error'));
      await watcher._poll(); // should not throw
      expect(mockAgentManager.handleWebSocketMessage).not.toHaveBeenCalled();
    });
  });

  describe('_startPolling()', () => {
    it('is a no-op if pollTimer already running', () => {
      watcher.start(); // starts polling
      const calls = mockDataSource.getSessions.mock.calls.length;
      watcher['_startPolling'](); // try to start again
      expect(mockDataSource.getSessions.mock.calls.length).toBe(calls);
    });
  });

  describe('_stopPolling()', () => {
    it('clears pollTimer', () => {
      watcher.start();
      expect(watcher.pollTimer).not.toBeNull();
      watcher['_stopPolling']();
      expect(watcher.pollTimer).toBeNull();
    });

    it('is safe to call with no timer', () => {
      expect(() => watcher['_stopPolling']()).not.toThrow();
    });
  });
});
