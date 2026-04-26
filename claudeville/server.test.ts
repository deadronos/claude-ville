import { spawn } from 'child_process';
import crypto from 'crypto';
import { once } from 'events';
import net from 'net';
import path from 'path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const legacyServerEntrypoint = path.join(repoRoot, 'claudeville', 'server.ts');

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate a port')));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

function startTsx(entrypoint: string, env: Record<string, string>) {
  const child = spawn(process.execPath, ['--import', 'tsx', entrypoint], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  return {
    child,
    getOutput: () => ({ stdout, stderr }),
  };
}

async function stopProcess(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill('SIGTERM');
  const exitPromise = once(child, 'exit');
  const timeoutPromise = delay(2000).then(() => undefined);
  await Promise.race([exitPromise, timeoutPromise]);

  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
}

async function waitForJson(url: string, predicate: (json: any) => boolean, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response yet';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const text = await response.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        lastError = `Non-JSON response (${response.status}): ${text.slice(0, 200)}`;
        await delay(100);
        continue;
      }

      if (predicate(json)) {
        return json;
      }

      lastError = `Unexpected payload from ${url}: ${JSON.stringify(json).slice(0, 400)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await delay(100);
  }

  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

async function waitForText(url: string, predicate: (text: string) => boolean, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response yet';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const text = await response.text();
      if (predicate(text)) {
        return text;
      }
      lastError = `Unexpected response from ${url}: ${text.slice(0, 200)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await delay(100);
  }

  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

function createMaskedTextFrame(payload: string) {
  const payloadBuffer = Buffer.from(payload);
  const maskKey = Buffer.from([1, 2, 3, 4]);
  const header = payloadBuffer.length < 126
    ? Buffer.from([0x81, 0x80 | payloadBuffer.length])
    : Buffer.from([0x81, 0x80 | 126, payloadBuffer.length >> 8, payloadBuffer.length & 0xff]);
  const masked = Buffer.alloc(payloadBuffer.length);
  for (let index = 0; index < payloadBuffer.length; index++) {
    masked[index] = payloadBuffer[index] ^ maskKey[index % 4];
  }
  return Buffer.concat([header, maskKey, masked]);
}

function readServerTextFrames(
  socket: net.Socket,
  expectedCount: number,
  predicate: (message: string) => boolean = () => true,
  timeoutMs = 5000,
) {
  return new Promise<string[]>((resolve, reject) => {
    const messages: string[] = [];
    let buffer = Buffer.alloc(0);
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${expectedCount} websocket frame(s); received ${messages.length}`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      socket.off('data', onData);
      socket.off('error', onError);
    }

    function onError(error: Error) {
      cleanup();
      reject(error);
    }

    function onData(chunk: Buffer) {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 2) {
        const secondByte = buffer[1];
        let payloadLength = secondByte & 0x7f;
        let offset = 2;
        if (payloadLength === 126) {
          if (buffer.length < 4) return;
          payloadLength = buffer.readUInt16BE(2);
          offset = 4;
        } else if (payloadLength === 127) {
          if (buffer.length < 10) return;
          payloadLength = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }
        if (buffer.length < offset + payloadLength) return;

        const opcode = buffer[0] & 0x0f;
        const payload = buffer.slice(offset, offset + payloadLength);
        buffer = buffer.slice(offset + payloadLength);
        const message = payload.toString('utf8');
        if (opcode === 0x1 && predicate(message)) {
          messages.push(message);
          if (messages.length >= expectedCount) {
            cleanup();
            resolve(messages);
            return;
          }
        }
      }
    }

    socket.on('data', onData);
    socket.on('error', onError);
  });
}

async function connectWebSocket(port: number) {
  const socket = net.connect(port, '127.0.0.1');
  await once(socket, 'connect');
  const key = crypto.randomBytes(16).toString('base64');
  socket.write(
    [
      'GET / HTTP/1.1',
      `Host: 127.0.0.1:${port}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
      '\r\n',
    ].join('\r\n'),
  );

  let handshake = Buffer.alloc(0);
  while (!handshake.includes('\r\n\r\n')) {
    const [chunk] = await once(socket, 'data') as [Buffer];
    handshake = Buffer.concat([handshake, chunk]);
  }
  expect(handshake.toString('utf8')).toContain('101 Switching Protocols');
  return socket;
}

describe('legacy server entrypoint', () => {
  it('serves runtime config, JSON APIs, and CORS headers on a configurable port', async () => {
    const port = await getFreePort();
    const server = startTsx(legacyServerEntrypoint, {
      PORT: String(port),
    });

    try {
      const runtimeConfig = await waitForText(`http://127.0.0.1:${port}/runtime-config.js`, (text) => text.includes('window.__CLAUDEVILLE_CONFIG__'));
      expect(runtimeConfig).toContain('window.__CLAUDEVILLE_CONFIG__');

      const runtimeResponse = await fetch(`http://127.0.0.1:${port}/runtime-config.js`);
      expect(runtimeResponse.status).toBe(200);
      expect(runtimeResponse.headers.get('content-type')).toContain('application/javascript');

      const optionsResponse = await fetch(`http://127.0.0.1:${port}/api/sessions`, { method: 'OPTIONS' });
      expect(optionsResponse.status).toBe(204);
      expect(optionsResponse.headers.get('access-control-allow-origin')).toBe('*');

      const sessions = await waitForJson(`http://127.0.0.1:${port}/api/sessions`, (json) => Array.isArray(json.sessions) && typeof json.count === 'number');
      expect(sessions).toMatchObject({
        sessions: expect.any(Array),
        count: expect.any(Number),
        timestamp: expect.any(Number),
      });

      const rootResponse = await fetch(`http://127.0.0.1:${port}/`);
      expect(rootResponse.status).toBe(200);
    } catch (error) {
      const { stdout, stderr } = server.getOutput();
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n\n[legacy stdout]\n${stdout}\n[legacy stderr]\n${stderr}`);
    } finally {
      await stopProcess(server.child);
    }
  });

  it('handles websocket text frames split across TCP chunks', async () => {
    const port = await getFreePort();
    const server = startTsx(legacyServerEntrypoint, {
      PORT: String(port),
    });
    let socket: net.Socket | null = null;

    try {
      await waitForText(`http://127.0.0.1:${port}/runtime-config.js`, (text) => text.includes('window.__CLAUDEVILLE_CONFIG__'));
      socket = await connectWebSocket(port);
      const frame = createMaskedTextFrame(JSON.stringify({ type: 'ping' }));
      const responseFrames = readServerTextFrames(socket, 1, (message) => JSON.parse(message).type === 'pong');
      socket.write(frame.subarray(0, 3));
      await delay(25);
      socket.write(frame.subarray(3));

      const [message] = await responseFrames;
      expect(JSON.parse(message)).toMatchObject({ type: 'pong' });
    } catch (error) {
      const { stdout, stderr } = server.getOutput();
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n\n[legacy stdout]\n${stdout}\n[legacy stderr]\n${stderr}`);
    } finally {
      socket?.destroy();
      await stopProcess(server.child);
    }
  });

  it('handles multiple websocket text frames delivered in one TCP chunk', async () => {
    const port = await getFreePort();
    const server = startTsx(legacyServerEntrypoint, {
      PORT: String(port),
    });
    let socket: net.Socket | null = null;

    try {
      await waitForText(`http://127.0.0.1:${port}/runtime-config.js`, (text) => text.includes('window.__CLAUDEVILLE_CONFIG__'));
      socket = await connectWebSocket(port);
      const frame = createMaskedTextFrame(JSON.stringify({ type: 'ping' }));
      const responseFrames = readServerTextFrames(socket, 2, (message) => JSON.parse(message).type === 'pong');
      socket.write(Buffer.concat([frame, frame]));

      const messages = await responseFrames;
      expect(messages.map((message) => JSON.parse(message).type)).toEqual(['pong', 'pong']);
    } catch (error) {
      const { stdout, stderr } = server.getOutput();
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n\n[legacy stdout]\n${stdout}\n[legacy stderr]\n${stderr}`);
    } finally {
      socket?.destroy();
      await stopProcess(server.child);
    }
  });
});
