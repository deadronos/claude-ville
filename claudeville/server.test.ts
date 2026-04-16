import { spawn } from 'child_process';
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
});
