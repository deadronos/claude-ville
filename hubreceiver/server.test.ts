/** @vitest-environment node */

import { spawn } from 'child_process';
import { once } from 'events';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const entrypoint = path.join(repoRoot, 'hubreceiver', 'server.ts');
const AUTH_TOKEN = 'test-secret';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startServer(env: Record<string, string>) {
  const child = spawn(process.execPath, ['--import', 'tsx', entrypoint], {
    cwd: repoRoot,
    env: { ...process.env, HUB_AUTH_TOKEN: AUTH_TOKEN, ...env },
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

async function waitForServerPort(server: ReturnType<typeof startServer>, timeoutMs = 4000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = server.getOutput().stdout.match(/hubreceiver listening on http:\/\/[^:]+:(\d+)/);
    if (match) return Number(match[1]);
    await delay(25);
  }
  const { stdout, stderr } = server.getOutput();
  throw new Error(`server did not report a bound port\n\n[stdout]\n${stdout}\n[stderr]\n${stderr}`);
}

async function stopProcess(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), delay(3000)]);

  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
}

const running = new Set<ReturnType<typeof startServer>['child']>();

afterEach(async () => {
  for (const child of running) {
    await stopProcess(child);
  }
  running.clear();
});

describe('hubreceiver entrypoint', () => {
  it('rejects unauthenticated API requests but serves the health check', async () => {
    const server = startServer({ HUB_PORT: '0' });
    running.add(server.child);
    const port = await waitForServerPort(server);

    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/sessions`);
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: 'unauthorized' });

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, collectors: 0 });

    const authorized = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
    });
    expect(authorized.status).toBe(200);
  });

  it('accepts snapshots under the size limit and rejects oversized ones', async () => {
    const server = startServer({ HUB_PORT: '0', MAX_SNAPSHOT_BYTES: '128' });
    running.add(server.child);
    const port = await waitForServerPort(server);
    const headers = {
      authorization: `Bearer ${AUTH_TOKEN}`,
      'content-type': 'application/json',
    };

    const oversized = await fetch(`http://127.0.0.1:${port}/api/collector/snapshot`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sessions: [{ blob: 'x'.repeat(500) }] }),
    });
    expect(oversized.status).toBe(413);
    expect(oversized.headers.get('connection')).toBe('close');

    const payload = JSON.stringify({ collectorId: 'c1', sessions: [{ sessionId: 's1', lastActivity: 1 }] });
    expect(payload.length).toBeLessThanOrEqual(128);

    const accepted = await fetch(`http://127.0.0.1:${port}/api/collector/snapshot`, {
      method: 'POST',
      headers,
      body: payload,
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ ok: true, sessions: 1 });

    const sessions = await (await fetch(`http://127.0.0.1:${port}/api/sessions`, {
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
    })).json();
    expect(sessions.sessions).toHaveLength(1);
  });

  it('shuts down gracefully on SIGTERM', async () => {
    const server = startServer({ HUB_PORT: '0' });
    running.add(server.child);
    await waitForServerPort(server);

    server.child.kill('SIGTERM');

    const [code] = (await once(server.child, 'exit')) as [number | null, NodeJS.Signals | null];
    expect(code).toBe(0);
    expect(server.getOutput().stdout).toContain('hubreceiver shut down');
  });
});
