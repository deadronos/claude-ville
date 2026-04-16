import { spawn } from 'child_process';
import { once } from 'events';
import net from 'net';
import path from 'path';

import { chromium, type Browser, type Page } from 'playwright';
import { createServer } from 'vite';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const hubreceiverEntrypoint = path.join(repoRoot, 'hubreceiver', 'server.ts');
const viteConfigFile = path.join(repoRoot, 'vite.config.ts');

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

function createBrowserFixtureSnapshot() {
  const timestamp = Date.now();
  const project = '/Users/openclaw/Github/claude-ville/browser-fixture';

  return {
    collectorId: 'browser-fixture',
    hostName: 'browser-host',
    timestamp,
    sessions: [
      {
        sessionId: 'alpha-session',
        provider: 'claude',
        project,
        status: 'active',
        lastActivity: timestamp - 2_000,
        model: 'claude-sonnet-4-5',
        displayName: 'Alpha',
        agentName: 'Alpha',
        lastTool: 'Bash',
        lastToolInput: 'npm test',
        lastMessage: 'Alpha is compiling',
        tokens: { input: 24, output: 32 },
        tokenUsage: { totalInput: 24, totalOutput: 32 },
      },
      {
        sessionId: 'beta-session',
        provider: 'claude',
        project,
        status: 'active',
        lastActivity: timestamp - 4_000,
        model: 'claude-sonnet-4-5',
        displayName: 'Beta',
        agentName: 'Beta',
        lastTool: 'Read',
        lastToolInput: 'docs/architecture/006-r3f-components.md',
        lastMessage: 'Beta is reading docs',
        tokens: { input: 12, output: 18 },
        tokenUsage: { totalInput: 12, totalOutput: 18 },
      },
    ],
    teams: [],
    taskGroups: [],
    providers: [{ provider: 'claude', name: 'Claude Code', homeDir: '/tmp/.claude' }],
    usage: {
      account: { subscriptionType: 'pro', rateLimitTier: 'high', email: 'browser@example.com' },
      quota: {
        fiveHour: { used: 3, remaining: 97 },
        sevenDay: { used: 9, remaining: 191 },
      },
      activity: {
        today: { messages: 4, sessions: 2 },
        thisWeek: { messages: 8, sessions: 2 },
      },
      totals: { sessions: 2, messages: 8 },
      quotaAvailable: true,
    },
    sessionDetails: {
      'claude:alpha-session': {
        sessionId: 'alpha-session',
        toolHistory: [
          { tool: 'Bash', detail: 'npm test', ts: timestamp - 3_000 },
          { tool: 'Read', detail: 'docs/architecture/006-r3f-components.md', ts: timestamp - 4_000 },
        ],
        messages: [
          { role: 'assistant', text: 'Alpha is compiling', ts: timestamp - 1_000 },
          { role: 'user', text: 'Please keep the camera stable.', ts: timestamp - 2_000 },
        ],
        tokenUsage: { totalInput: 24, totalOutput: 32 },
      },
      'claude:beta-session': {
        sessionId: 'beta-session',
        toolHistory: [
          { tool: 'Read', detail: 'docs/architecture/006-r3f-components.md', ts: timestamp - 5_000 },
        ],
        messages: [
          { role: 'assistant', text: 'Beta is reading docs', ts: timestamp - 2_500 },
        ],
        tokenUsage: { totalInput: 12, totalOutput: 18 },
      },
    },
  };
}

async function postSnapshot(hubPort: number, authToken: string, snapshot: Record<string, unknown>) {
  const response = await fetch(`http://127.0.0.1:${hubPort}/api/collector/snapshot`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify(snapshot),
  });

  expect(response.status).toBe(200);
  return await response.json();
}

async function startFrontendServer() {
  const server = await createServer({
    configFile: viteConfigFile,
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
    },
  });

  await server.listen();
  const url = server.resolvedUrls?.local?.find((candidate) => candidate.includes('127.0.0.1')) || server.resolvedUrls?.local?.[0];
  if (!url) {
    await server.close();
    throw new Error('Failed to resolve the frontend dev server URL');
  }

  return { server, url };
}

async function launchBrowser(url: string, hubPort: number) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });

  await context.addInitScript(({ hubHttpUrl, hubWsUrl, seed }) => {
    const config = { hubHttpUrl, hubWsUrl };
    Object.defineProperty(window, '__CLAUDEVILLE_CONFIG__', {
      configurable: true,
      get: () => config,
      set: () => undefined,
    });

    let state = seed >>> 0;
    Math.random = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }, {
    hubHttpUrl: `http://127.0.0.1:${hubPort}`,
    hubWsUrl: `ws://127.0.0.1:${hubPort}/ws`,
    seed: 123456789,
  });

  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return { browser, page };
}

describe('ClaudeVilleApp browser selection flow', () => {
  it('keeps the world stable when focusing an agent from the sidebar', async () => {
    const authToken = 'browser-test-token';
    const hubPort = await getFreePort();
    const hubreceiver = startTsx(hubreceiverEntrypoint, {
      HUB_PORT: String(hubPort),
      HUB_AUTH_TOKEN: authToken,
    });
    const fixture = createBrowserFixtureSnapshot();
    let frontend: Awaited<ReturnType<typeof startFrontendServer>> | null = null;
    let browser: Browser | null = null;
    let page: Page | null = null;

    try {
      const health = await waitForJson(`http://127.0.0.1:${hubPort}/health`, (json) => json.ok === true);
      expect(health).toEqual({ ok: true, collectors: 0 });

      const response = await fetch(`http://127.0.0.1:${hubPort}/api/collector/snapshot`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(fixture),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, sessions: 2 });

      const sessions = await waitForJson(`http://127.0.0.1:${hubPort}/api/sessions`, (json) => json.count === 2);
      expect(sessions.sessions.map((session: any) => session.sessionId).sort()).toEqual(['alpha-session', 'beta-session']);

      frontend = await startFrontendServer();
      ({ browser, page } = await launchBrowser(frontend.url, hubPort));

      await page.waitForFunction(() => document.getElementById('agentCount')?.textContent === '2');
      await page.waitForFunction(() => document.querySelectorAll('#sidebar .sidebar__agent').length === 2);
        await page.waitForTimeout(500); // Adjusted settle delay before live-refresh update snapshot

      await page.getByRole('button', { name: 'DASHBOARD' }).click();
      await page.waitForFunction(() => document.getElementById('dashboardMode') !== null);

      const sidebarAgent = page.locator('#sidebar .sidebar__agent').filter({ hasText: 'Alpha' }).first();
      await sidebarAgent.click();

      await page.waitForFunction(() => document.getElementById('panelAgentName')?.textContent === 'Alpha');
      await page.waitForFunction(() => document.querySelector('.world-view__focus-badge')?.textContent === 'Following Alpha');
      await page.waitForFunction(() => document.getElementById('panelCurrentTool')?.textContent?.includes('Bash') === true);
      await page.waitForFunction(() => document.getElementById('panelToolHistory')?.textContent?.includes('npm test') === true);
      await page.waitForFunction(() => document.getElementById('panelMessages')?.textContent?.includes('Alpha is compiling') === true);

      const activityPanel = page.locator('#activityPanel');
      await activityPanel.waitFor({ state: 'visible' });
      expect(await page.locator('#btnModeCharacter').getAttribute('class')).toContain('topbar__mode-btn--active');

      const worldView = page.locator('.world-view');
      const canvas = page.locator('.content__canvas');
      const markerRing = page.locator('.world-view__selected-agent-ring');
      await markerRing.waitFor({ state: 'visible' });

      const canvasAfterSelection = await canvas.boundingBox();
      expect(canvasAfterSelection).not.toBeNull();
      await page.waitForTimeout(250);
      const canvasAfterSettled = await canvas.boundingBox();
      expect(canvasAfterSettled).not.toBeNull();
      expect(Math.abs((canvasAfterSelection?.width || 0) - (canvasAfterSettled?.width || 0))).toBeLessThan(2);
      expect(Math.abs((canvasAfterSelection?.height || 0) - (canvasAfterSettled?.height || 0))).toBeLessThan(2);

      await page.evaluate(() => {
        (window as any).__worldCanvas = document.querySelector('.content__canvas');
      });
      await page.waitForTimeout(2200);
      const canvasStayedMounted = await page.evaluate(() => {
        return document.querySelector('.content__canvas') === (window as any).__worldCanvas;
      });
      expect(canvasStayedMounted).toBe(true);

      const markerBox = await markerRing.boundingBox();
      const worldBox = await worldView.boundingBox();
      expect(markerBox).not.toBeNull();
      expect(worldBox).not.toBeNull();
      if (markerBox && worldBox) {
        const markerCenterX = markerBox.x + markerBox.width / 2;
        const markerCenterY = markerBox.y + markerBox.height / 2;
        const worldCenterX = worldBox.x + worldBox.width / 2;
        const worldCenterY = worldBox.y + worldBox.height / 2;
        expect(Math.abs(markerCenterX - worldCenterX)).toBeLessThan(220);
        expect(Math.abs(markerCenterY - worldCenterY)).toBeLessThan(220);
      }

      expect(await page.locator('#panelAgentName').textContent()).toBe('Alpha');
      expect(await page.locator('#panelProvider').textContent()).toBe('claude');
      expect(await page.locator('#panelModel').textContent()).toBe('sonnet-4-5');
      expect(await page.locator('#panelCurrentTool').textContent()).toContain('Bash');
      expect(await page.locator('#panelToolHistory').textContent()).toContain('npm test');
      expect(await page.locator('#panelMessages').textContent()).toContain('Alpha is compiling');
    } catch (error) {
      const hubOutput = hubreceiver.getOutput();
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n\n[hubreceiver stdout]\n${hubOutput.stdout}\n[hubreceiver stderr]\n${hubOutput.stderr}`);
    } finally {
      if (page) {
        await page.close();
      }
      if (browser) {
        await browser.close();
      }
      if (frontend) {
        await frontend.server.close();
      }
      await stopProcess(hubreceiver.child);
    }
  }, 120000);

});
