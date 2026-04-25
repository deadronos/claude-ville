import crypto from 'crypto';
import { spawn } from 'child_process';
import { once } from 'events';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const hubreceiverEntrypoint = path.join(repoRoot, 'hubreceiver', 'server.ts');
const collectorEntrypoint = path.join(repoRoot, 'collector', 'start.ts');
const legacyServerEntrypoint = path.join(repoRoot, 'claudeville', 'server.ts');

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonl(filePath: string, lines: string[]) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
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
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

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

function createAdapterFixtureHome() {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeville-backend-home-'));
  const workspaceDir = path.join(homeDir, 'workspace');
  fs.mkdirSync(workspaceDir, { recursive: true });

  const projectHash = sha256(workspaceDir);
  const geminiSessionFile = path.join(homeDir, '.gemini', 'tmp', projectHash, 'chats', 'session-abc.json');
  writeJson(geminiSessionFile, {
    sessionId: 'session-abc',
    projectHash,
    messages: [
      {
        type: 'gemini',
        model: 'gemini-2.5-pro',
        content: 'Gemini planning update',
        toolCalls: [{ name: 'read_file', args: { file_path: '/tmp/workspace/report.md' } }],
        timestamp: '2026-04-15T10:00:00.000Z',
      },
    ],
  });

  const openclawSessionFile = path.join(homeDir, '.openclaw', 'agents', 'agent-alpha', 'sessions', 'session-1.jsonl');
  writeJsonl(openclawSessionFile, [
    JSON.stringify({ type: 'session', version: 3, id: 'session-1', timestamp: '2026-04-15T10:00:00.000Z', cwd: workspaceDir }),
    JSON.stringify({ type: 'message', timestamp: '2026-04-15T10:00:01.000Z', message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'OpenClaw working' },
        { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
      ],
      model: 'gpt-4o',
    } }),
  ]);

  return { homeDir, workspaceDir };
}

describe('hubreceiver entrypoint', () => {
  it('accepts snapshots and serves the current state', async () => {
    const port = await getFreePort();
    const authToken = 'hubreceiver-test-token';
    const server = startTsx(hubreceiverEntrypoint, {
      HUB_PORT: String(port),
      HUB_AUTH_TOKEN: authToken,
    });

    try {
      const health = await waitForJson(`http://127.0.0.1:${port}/health`, (json) => json.ok === true);
      expect(health).toEqual({ ok: true, collectors: 0 });

      const unauthorized = await fetch(`http://127.0.0.1:${port}/api/collector/snapshot`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ collectorId: 'manual', sessions: [] }),
      });
      expect(unauthorized.status).toBe(401);

      const badJson = await fetch(`http://127.0.0.1:${port}/api/collector/snapshot`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${authToken}`,
        },
        body: '{not-json',
      });
      expect(badJson.status).toBe(400);

      const snapshot = {
        collectorId: 'manual-collector',
        hostName: 'manual-host',
        timestamp: 1_000_000,
        sessions: [
          {
            sessionId: 'manual-session',
            provider: 'claude',
            project: '/tmp/project-a',
            lastActivity: 999_999,
            model: 'claude-sonnet-4-5',
            tokens: { input: 8, output: 16 },
          },
        ],
        teams: [{ teamName: 'team-a' }],
        taskGroups: [{ groupName: 'task-a' }],
        providers: [{ provider: 'claude', name: 'Claude Code', homeDir: '/tmp/.claude' }],
        usage: {
          account: { subscriptionType: 'pro', rateLimitTier: 'high', email: 'user@example.com' },
          quota: { fiveHour: { used: 1, remaining: 99 }, sevenDay: { used: 2, remaining: 198 } },
          activity: { today: { messages: 2, sessions: 1 }, thisWeek: { messages: 2, sessions: 1 } },
          totals: { sessions: 1, messages: 2 },
          quotaAvailable: true,
        },
        sessionDetails: {
          'claude:manual-session': {
            sessionId: 'manual-session',
            toolHistory: [{ tool: 'Bash', detail: 'npm test', ts: 1_000_000 }],
            messages: [{ role: 'assistant', text: 'done', ts: 1_000_001 }],
            tokenUsage: { totalInput: 8, totalOutput: 16 },
          },
        },
      };

      const accepted = await fetch(`http://127.0.0.1:${port}/api/collector/snapshot`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(snapshot),
      });
      expect(accepted.status).toBe(200);
      expect(await accepted.json()).toEqual({ ok: true, sessions: 1 });

      const sessions = await waitForJson(`http://127.0.0.1:${port}/api/sessions`, (json) => json.count === 1);
      expect(sessions.sessions).toEqual([
        expect.objectContaining({
          sessionId: 'manual-session',
          provider: 'claude',
          project: '/tmp/project-a',
        }),
      ]);

      const missingSessionId = await fetch(`http://127.0.0.1:${port}/api/session-detail?provider=claude`);
      expect(missingSessionId.status).toBe(400);

      const detailResponse = await fetch(`http://127.0.0.1:${port}/api/session-detail?sessionId=manual-session&provider=claude`);
      expect(detailResponse.status).toBe(200);
      expect(await detailResponse.json()).toEqual({
        sessionId: 'manual-session',
        toolHistory: [{ tool: 'Bash', detail: 'npm test', ts: 1_000_000 }],
        messages: [{ role: 'assistant', text: 'done', ts: 1_000_001 }],
        tokenUsage: { totalInput: 8, totalOutput: 16 },
      });

      expect(await (await fetch(`http://127.0.0.1:${port}/api/history?lines=1`)).json()).toEqual({
        entries: [
          expect.objectContaining({
            provider: 'claude',
            sessionId: 'manual-session',
            text: 'done',
          }),
        ],
      });

      expect(await (await fetch(`http://127.0.0.1:${port}/api/usage`)).json()).toEqual(snapshot.usage);
    } catch (error) {
      const { stdout, stderr } = server.getOutput();
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n\n[hubreceiver stdout]\n${stdout}\n[hubreceiver stderr]\n${stderr}`);
    } finally {
      await stopProcess(server.child);
    }
  });
});

describe('collector and legacy server entrypoints', () => {
  it('collector publishes the temp adapter fixtures to hubreceiver', async () => {
    const { homeDir } = createAdapterFixtureHome();
    const port = await getFreePort();
    const authToken = 'collector-test-token';
    const hubreceiver = startTsx(hubreceiverEntrypoint, {
      HUB_PORT: String(port),
      HUB_AUTH_TOKEN: authToken,
    });
    const collector = startTsx(collectorEntrypoint, {
      HUB_URL: `http://127.0.0.1:${port}`,
      HUB_AUTH_TOKEN: authToken,
      COLLECTOR_ID: 'collector-test',
      COLLECTOR_HOST: 'collector-host',
      FLUSH_INTERVAL_MS: '60000',
      HOME: homeDir,
    });

    try {
      const sessions = await waitForJson(`http://127.0.0.1:${port}/api/sessions`, (json) => json.count >= 2);
      expect(sessions.sessions.map((session: any) => session.provider).sort()).toEqual(['gemini', 'openclaw']);

      const providers = await (await fetch(`http://127.0.0.1:${port}/api/providers`)).json();
      expect(providers.providers.map((provider: any) => provider.provider).sort()).toEqual(['gemini', 'openclaw']);

      const firstSession = sessions.sessions[0];
      const detail = await (await fetch(`http://127.0.0.1:${port}/api/session-detail?sessionId=${encodeURIComponent(firstSession.sessionId)}&provider=${encodeURIComponent(firstSession.provider)}`)).json();
      expect(detail.toolHistory.length).toBeGreaterThan(0);
      expect(detail.messages.length).toBeGreaterThan(0);

      const history = await (await fetch(`http://127.0.0.1:${port}/api/history?lines=5`)).json();
      expect(history.entries.length).toBeGreaterThan(0);
    } catch (error) {
      const hubOutput = hubreceiver.getOutput();
      const collectorOutput = collector.getOutput();
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n\n[hubreceiver stdout]\n${hubOutput.stdout}\n[hubreceiver stderr]\n${hubOutput.stderr}\n[collector stdout]\n${collectorOutput.stdout}\n[collector stderr]\n${collectorOutput.stderr}`);
    } finally {
      await stopProcess(collector.child);
      await stopProcess(hubreceiver.child);
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('legacy server serves adapter-backed endpoints from the same fixtures', async () => {
    const { homeDir, workspaceDir } = createAdapterFixtureHome();
    const legacy = startTsx(legacyServerEntrypoint, {
      HOME: homeDir,
    });

    try {
      const sessions = await waitForJson('http://127.0.0.1:4000/api/sessions', (json) => json.count >= 2);
      expect(sessions.sessions.map((session: any) => session.provider).sort()).toEqual(['gemini', 'openclaw']);

      const providers = await (await fetch('http://127.0.0.1:4000/api/providers')).json();
      expect(providers.providers.map((provider: any) => provider.provider).sort()).toEqual(['gemini', 'openclaw']);

      const firstSession = sessions.sessions.find((session: any) => session.provider === 'openclaw') || sessions.sessions[0];
      const detail = await (await fetch(`http://127.0.0.1:4000/api/session-detail?sessionId=${encodeURIComponent(firstSession.sessionId)}&project=${encodeURIComponent(firstSession.project || workspaceDir)}&provider=${encodeURIComponent(firstSession.provider)}`)).json();
      expect(detail.toolHistory.length).toBeGreaterThan(0);
      expect(detail.messages.length).toBeGreaterThan(0);

      const history = await (await fetch('http://127.0.0.1:4000/api/history?lines=5')).json();
      expect(history.entries.length).toBeGreaterThan(0);
    } catch (error) {
      const legacyOutput = legacy.getOutput();
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n\n[legacy stdout]\n${legacyOutput.stdout}\n[legacy stderr]\n${legacyOutput.stderr}`);
    } finally {
      await stopProcess(legacy.child);
      fs.rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
