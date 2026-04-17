/** @vitest-environment node */

import { describe, expect, it, vi } from 'vitest';

const { createHubWebSocketManager } = await import('./ws.ts');

function makeSocket() {
  const listeners = new Map<string, () => void>();
  const socket = {
    destroyed: false,
    writable: true,
    write: vi.fn((data: unknown, callback?: (error?: unknown) => void) => {
      if (callback) {
        callback();
      }
      return true;
    }),
    on: vi.fn((event: string, handler: () => void) => {
      listeners.set(event, handler);
      return socket;
    }),
    destroy: vi.fn(),
  } as any;

  return { socket, listeners };
}

describe('hubreceiver websocket manager', () => {
  it('sends the handshake and init payload on upgrade', () => {
    const state = {
      sessions: [{ sessionId: 's1' }],
      teams: [],
      taskGroups: [],
      providers: [],
      usage: {},
      timestamp: 123,
    };

    const manager = createHubWebSocketManager(() => state);
    const { socket } = makeSocket();

    manager.handleUpgrade({ headers: { 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' } }, socket);

    expect(socket.write).toHaveBeenCalledTimes(2);
    expect(String(socket.write.mock.calls[0][0])).toContain('101 Switching Protocols');
    expect(Buffer.isBuffer(socket.write.mock.calls[1][0])).toBe(true);
    expect(manager.wsClients.has(socket)).toBe(true);
    expect(socket.on).toHaveBeenCalledWith('close', expect.any(Function));
    expect(socket.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('broadcasts payloads to connected clients', () => {
    const manager = createHubWebSocketManager(() => ({
      sessions: [],
      teams: [],
      taskGroups: [],
      providers: [],
      usage: {},
      timestamp: 123,
    }));
    const { socket } = makeSocket();
    manager.wsClients.add(socket);

    manager.broadcast('update');

    expect(socket.write).toHaveBeenCalledTimes(1);
    expect(Buffer.isBuffer(socket.write.mock.calls[0][0])).toBe(true);
  });
});