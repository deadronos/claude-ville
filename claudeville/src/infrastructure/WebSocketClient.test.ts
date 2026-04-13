/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock getHubWsUrl before importing WebSocketClient
vi.mock('../config/runtime.js', () => ({
  getHubWsUrl: vi.fn(() => 'ws://localhost:3030/ws'),
}));

// Stub global WebSocket class
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState: number;
  onopen: ((event: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;
  onclose: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
  }

  send(_data: string) {}
  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose({});
  }

  // Test helpers
  _simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) this.onopen({});
  }
  _simulateMessage(data: any) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(data) });
  }
  _simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose({});
  }
}

vi.stubGlobal('WebSocket', MockWebSocket);

import { WebSocketClient } from './WebSocketClient.js';

describe('WebSocketClient', () => {
  let client: WebSocketClient;

  beforeEach(() => {
    client = new WebSocketClient();
  });

  afterEach(() => {
    client.disconnect();
  });

  describe('constructor', () => {
    it('starts disconnected', () => {
      expect(client.isConnected).toBe(false);
    });

    it('starts with null ws', () => {
      expect(client.ws).toBeNull();
    });

    it('starts with zero reconnect attempts', () => {
      expect(client.reconnectAttempts).toBe(0);
    });
  });

  describe('connect()', () => {
    it('creates a WebSocket', () => {
      client.connect();
      expect(client.ws).not.toBeNull();
    });

    it('is a no-op when already open', () => {
      client.connect();
      const ws = client.ws as any;
      ws._simulateOpen();
      const originalClose = ws.close.bind(ws);
      client.connect(); // should not re-create
      expect(client.ws).toBe(ws);
    });

    it('emits ws:connected on open', async () => {
      const { eventBus } = await import('../domain/events/DomainEvent.js');
      const handler = vi.fn();
      eventBus.on('ws:connected', handler);

      client.connect();
      (client.ws as any)._simulateOpen();

      expect(handler).toHaveBeenCalled();
      expect(client.isConnected).toBe(true);
      eventBus.off('ws:connected', handler);
    });
  });

  describe('disconnect()', () => {
    it('sets connected to false', () => {
      client.connect();
      (client.ws as any)._simulateOpen();
      client.disconnect();
      expect(client.isConnected).toBe(false);
    });

    it('sets ws to null', () => {
      client.connect();
      client.disconnect();
      expect(client.ws).toBeNull();
    });

    it('clears reconnect timer', () => {
      client.connect();
      client.disconnect();
      expect(client.reconnectTimer).toBeNull();
    });
  });

  describe('send()', () => {
    it('sends data when connected', () => {
      client.connect();
      const ws = client.ws as any;
      ws._simulateOpen();
      const sendSpy = vi.spyOn(ws, 'send');
      client.send({ type: 'ping' });
      expect(sendSpy).toHaveBeenCalledWith(JSON.stringify({ type: 'ping' }));
    });

    it('is a no-op when not connected', () => {
      client.connect();
      (client.ws as any).readyState = MockWebSocket.CONNECTING;
      const sendSpy = vi.spyOn(client.ws, 'send');
      client.send({ type: 'ping' });
      expect(sendSpy).not.toHaveBeenCalled();
    });
  });

  describe('incoming message handling', () => {
    it('emits ws:init for init type', async () => {
      const { eventBus } = await import('../domain/events/DomainEvent.js');
      const handler = vi.fn();
      eventBus.on('ws:init', handler);

      client.connect();
      (client.ws as any)._simulateOpen();
      (client.ws as any)._simulateMessage({ type: 'init', sessions: [{ sessionId: 's1' }] });

      expect(handler).toHaveBeenCalledWith({ type: 'init', sessions: [{ sessionId: 's1' }] });
      eventBus.off('ws:init', handler);
    });

    it('emits ws:update for update type', async () => {
      const { eventBus } = await import('../domain/events/DomainEvent.js');
      const handler = vi.fn();
      eventBus.on('ws:update', handler);

      client.connect();
      (client.ws as any)._simulateOpen();
      (client.ws as any)._simulateMessage({ type: 'update', sessions: [] });

      expect(handler).toHaveBeenCalled();
      eventBus.off('ws:update', handler);
    });

    it('emits usage:updated when usage included in init', async () => {
      const { eventBus } = await import('../domain/events/DomainEvent.js');
      const handler = vi.fn();
      eventBus.on('usage:updated', handler);

      client.connect();
      (client.ws as any)._simulateOpen();
      (client.ws as any)._simulateMessage({ type: 'init', usage: { total: 100 } });

      expect(handler).toHaveBeenCalledWith({ total: 100 });
      eventBus.off('usage:updated', handler);
    });

    it('emits ws:message for unknown type', async () => {
      const { eventBus } = await import('../domain/events/DomainEvent.js');
      const handler = vi.fn();
      eventBus.on('ws:message', handler);

      client.connect();
      (client.ws as any)._simulateOpen();
      (client.ws as any)._simulateMessage({ type: 'unknown', data: 42 });

      expect(handler).toHaveBeenCalledWith({ type: 'unknown', data: 42 });
      eventBus.off('ws:message', handler);
    });

    it('ignores pong type silently', async () => {
      const { eventBus } = await import('../domain/events/DomainEvent.js');
      const handler = vi.fn();
      eventBus.on('ws:message', handler);
      eventBus.on('ws:init', handler);
      eventBus.on('ws:update', handler);

      client.connect();
      (client.ws as any)._simulateOpen();
      (client.ws as any)._simulateMessage({ type: 'pong' });

      expect(handler).not.toHaveBeenCalled();
    });

    it('handles invalid JSON gracefully', async () => {
      client.connect();
      (client.ws as any)._simulateOpen();
      expect(() => {
        (client.ws as any).onmessage!({ data: 'not json' });
      }).not.toThrow();
    });
  });

  describe('disconnect handling', () => {
    it('emits ws:disconnected on close', async () => {
      const { eventBus } = await import('../domain/events/DomainEvent.js');
      const handler = vi.fn();
      eventBus.on('ws:disconnected', handler);

      client.connect();
      (client.ws as any)._simulateOpen();
      (client.ws as any)._simulateClose();

      expect(handler).toHaveBeenCalled();
      expect(client.isConnected).toBe(false);
      eventBus.off('ws:disconnected', handler);
    });

    it('schedules reconnect after disconnect', async () => {
      vi.useFakeTimers();
      client.connect();
      (client.ws as any)._simulateOpen();
      (client.ws as any)._simulateClose();

      expect(client.reconnectTimer).not.toBeNull();
      vi.useRealTimers();
    });
  });

  describe('reconnect logic', () => {
    it('increments reconnectAttempts on reconnect', async () => {
      // Must call useFakeTimers BEFORE creating the client so the setTimeout is mocked
      vi.useFakeTimers();
      const reconnectClient = new WebSocketClient();
      reconnectClient.connect();
      (reconnectClient.ws as any)._simulateOpen();
      (reconnectClient.ws as any)._simulateClose();

      expect(reconnectClient.reconnectTimer).not.toBeNull();
      // Advance by enough to trigger the scheduled reconnect (WS_RECONNECT_INTERVAL * 2^0 = 3000ms)
      vi.advanceTimersByTime(3001);
      expect(reconnectClient.reconnectAttempts).toBeGreaterThan(0);
      vi.useRealTimers();
    });

    it('schedules reconnect on disconnect', () => {
      client.connect();
      (client.ws as any)._simulateOpen();
      (client.ws as any)._simulateClose();
      expect(client.reconnectTimer).not.toBeNull();
    });
  });
});
