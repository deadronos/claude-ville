/** @vitest-environment node */

import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage } from 'node:http';

const { createHubWebSocketManager } = await import('./ws.js');

// `handleUpgrade` reads only `req.headers`, so that is the whole surface these
// request doubles need to stand in for.
function makeRequest(headers: Record<string, string>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

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

    manager.handleUpgrade(makeRequest({ 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', authorization: 'Bearer secret' }), socket, 'secret');

    expect(socket.write).toHaveBeenCalledTimes(2);
    expect(String(socket.write.mock.calls[0][0])).toContain('101 Switching Protocols');
    expect(Buffer.isBuffer(socket.write.mock.calls[1][0])).toBe(true);
    expect(manager.wsClients.has(socket)).toBe(true);
    expect(socket.on).toHaveBeenCalledWith('close', expect.any(Function));
    expect(socket.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('rejects websocket upgrades without a valid token', () => {
    const manager = createHubWebSocketManager(() => ({
      sessions: [],
      teams: [],
      taskGroups: [],
      providers: [],
      usage: {},
      timestamp: 123,
    }));
    const { socket } = makeSocket();

    manager.handleUpgrade(makeRequest({ 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' }), socket, 'secret');

    expect(String(socket.write.mock.calls[0][0])).toContain('401 Unauthorized');
    expect(socket.destroy).toHaveBeenCalled();
    expect(manager.wsClients.has(socket)).toBe(false);
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

  it('carries the session project into the broadcast payload', () => {
    const manager = createHubWebSocketManager(() => ({
      sessions: [{ sessionId: 's1', project: '/repo/app' }],
      teams: [],
      taskGroups: [],
      providers: [],
      usage: {},
      timestamp: 123,
    }));

    const payload = JSON.parse(JSON.stringify(manager.buildWsPayload('update')));

    expect(payload.sessions[0]).toHaveProperty('project', '/repo/app');
  });
});