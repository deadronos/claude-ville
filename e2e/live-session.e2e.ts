import { spawn } from 'child_process';
import { once } from 'events';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { describe, expect, it } from 'vitest';

type StartedProcess = {
  name: string;
  commandLine: string;
  detached: boolean;
  child: ReturnType<typeof spawn>;
  getOutput: () => { stdout: string; stderr: string };
};

type SessionSummary = {
  sessionId: string;
  provider: string;
  project?: string | null;
  lastActivity?: number;
  [key: string]: unknown;
};

const repoRoot = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

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

function startProcess(
  name: string,
  command: string,
  args: string[],
  env: Record<string, string> = {},
  cwd = repoRoot,
  detached = false,
): StartedProcess {
  const child = spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached,
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
    name,
    commandLine: [command, ...args].join(' '),
    detached,
    child,
    getOutput: () => ({ stdout, stderr }),
  };
}

function startNpmScript(
  name: string,
  script: string,
  env: Record<string, string> = {},
  args: string[] = [],
) {
  const npmArgs = ['run', script];
  if (args.length > 0) {
    npmArgs.push('--', ...args);
  }

  return startProcess(name, npmCommand, npmArgs, env, repoRoot, process.platform !== 'win32');
}

function createClaudePromptWorkspace() {
  const workspace = fs.mkdtempSync(path.join(repoRoot, 'claudeville-e2e-'));
  const seedFiles = [
    'README.md',
    'package.json',
    'docs/architecture/README.md',
    'claudeville/CLAUDE.md',
  ];

  for (const relativePath of seedFiles) {
    const sourcePath = path.join(repoRoot, relativePath);
    const destinationPath = path.join(workspace, relativePath);
    if (!fs.existsSync(sourcePath)) {
      continue;
    }

    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
  }

  return workspace;
}

function createOpenClawHome(agentIds: string[] = []) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeville-openclaw-home-'));
  fs.mkdirSync(path.join(home, '.openclaw', 'agents'), { recursive: true });
  for (const agentId of agentIds) {
    fs.mkdirSync(path.join(home, '.openclaw', 'agents', agentId, 'sessions'), { recursive: true });
  }
  return home;
}

function seedOpenClawSession(
  agentId: string,
  sessionId: string,
  cwd: string,
  homeDir: string,
  promptText: string,
) {
  const sessionFilePath = path.join(homeDir, '.openclaw', 'agents', agentId, 'sessions', `${sessionId}.jsonl`);
  const script = `
const fs = require('fs');
const path = require('path');
const sessionFilePath = process.env.SESSION_FILE_PATH;
const cwd = process.env.SESSION_CWD;
const sessionId = process.env.SESSION_ID;
const promptText = process.env.SESSION_PROMPT;
const newline = String.fromCharCode(10);
fs.mkdirSync(path.dirname(sessionFilePath), { recursive: true });
const now = new Date().toISOString();
fs.writeFileSync(sessionFilePath, [
  JSON.stringify({ type: 'session', version: 3, id: sessionId, timestamp: now, cwd }),
  JSON.stringify({
    type: 'message',
    timestamp: now,
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: promptText },
        { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
      ],
      model: 'gpt-4o',
    },
  }),
].join(newline) + newline);
fs.utimesSync(sessionFilePath, new Date(), new Date());
`;

  return startProcess(
    `openclaw:${agentId}`,
    process.execPath,
    ['-e', script],
    {
      HOME: homeDir,
      SESSION_FILE_PATH: sessionFilePath,
      SESSION_CWD: cwd,
      SESSION_ID: sessionId,
      SESSION_PROMPT: promptText,
    },
    repoRoot,
    false,
  );
}

function expireOpenClawSession(sessionFilePath: string) {
  const expiredAt = new Date(Date.now() - 60 * 60 * 1000);
  fs.utimesSync(sessionFilePath, expiredAt, expiredAt);
}

async function waitForProcessExit(processHandle: StartedProcess, timeoutMs: number) {
  if (processHandle.child.exitCode !== null || processHandle.child.signalCode !== null) {
    return {
      code: processHandle.child.exitCode,
      signal: processHandle.child.signalCode,
    };
  }

  const exitPromise = once(processHandle.child, 'exit').then(([code, signal]) => ({ code, signal }));
  const timeoutPromise = delay(timeoutMs).then(() => {
    throw new Error(`Timed out waiting for ${processHandle.name} to finish after ${timeoutMs}ms`);
  });

  return await Promise.race([exitPromise, timeoutPromise]);
}

function killHandle(processHandle: StartedProcess, signal: NodeJS.Signals) {
  if (processHandle.detached && process.platform !== 'win32' && processHandle.child.pid) {
    try {
      process.kill(-processHandle.child.pid, signal);
      return;
    } catch {
      // Fall back to direct child kill below.
    }
  }

  try {
    processHandle.child.kill(signal);
  } catch {
    // Ignore best-effort cleanup failures.
  }
}

async function stopProcess(processHandle: StartedProcess) {
  if (processHandle.child.exitCode !== null || processHandle.child.signalCode !== null) {
    return;
  }

  killHandle(processHandle, 'SIGTERM');
  const exitPromise = once(processHandle.child, 'exit');
  const timeoutPromise = delay(4000).then(() => undefined);
  await Promise.race([exitPromise, timeoutPromise]);

  if (processHandle.child.exitCode === null && processHandle.child.signalCode === null) {
    killHandle(processHandle, 'SIGKILL');
    await once(processHandle.child, 'exit');
  }
}

async function waitForJson(url: string, predicate: (json: any) => boolean, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response yet';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      const text = await response.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        lastError = `Non-JSON response (${response.status}): ${text.slice(0, 200)}`;
        await delay(250);
        continue;
      }

      if (predicate(json)) {
        return json;
      }

      lastError = `Unexpected payload from ${url}: ${JSON.stringify(json).slice(0, 400)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

async function waitForText(url: string, predicate: (body: string) => boolean, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response yet';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      const text = await response.text();
      if (response.ok && predicate(text)) {
        return text;
      }
      lastError = `Unexpected response (${response.status}): ${text.slice(0, 200)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for ${url}: ${lastError}`);
}

async function fetchSessions(hubUrl: string): Promise<SessionSummary[]> {
  const response = await fetch(`${hubUrl}/api/sessions`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to fetch sessions: HTTP ${response.status}`);
  }

  const json = await response.json();
  return Array.isArray(json.sessions) ? json.sessions : [];
}

async function waitForHubSession(hubUrl: string, sessionId: string, provider = 'claude', timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot = '[]';

  while (Date.now() < deadline) {
    const sessions = await fetchSessions(hubUrl);
    const match = sessions.find((session) => session.provider === provider && session.sessionId === sessionId);
    if (match) {
      return match;
    }

    lastSnapshot = JSON.stringify(
      sessions.map((session) => ({
        sessionId: session.sessionId,
        provider: session.provider,
        project: session.project,
        lastActivity: session.lastActivity,
      })),
      null,
      2,
    );
    await delay(1000);
  }

  throw new Error(`Timed out waiting for ${provider} session ${sessionId} to reach hubreceiver. Last sessions snapshot:\n${lastSnapshot}`);
}

async function waitForHubSessionGone(hubUrl: string, sessionId: string, provider = 'claude', timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot = '[]';

  while (Date.now() < deadline) {
    const sessions = await fetchSessions(hubUrl);
    const match = sessions.find((session) => session.provider === provider && session.sessionId === sessionId);
    if (!match) {
      return;
    }

    lastSnapshot = JSON.stringify(
      sessions.map((session) => ({
        sessionId: session.sessionId,
        provider: session.provider,
        project: session.project,
        lastActivity: session.lastActivity,
      })),
      null,
      2,
    );
    await delay(1000);
  }

  throw new Error(`Timed out waiting for ${provider} session ${sessionId} to disappear from hubreceiver. Last sessions snapshot:\n${lastSnapshot}`);
}

async function launchBrowser(frontendUrl: string, hubUrl: string, browserLogs: string[] = []) {
  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    throw new Error(
      `Failed to launch Chromium for the live E2E test. Run \`npx playwright install chromium\` once, then retry.\n\n` +
      `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await context.route('**/api/**', async (route) => {
    const requestUrl = new URL(route.request().url());
    const targetUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, hubUrl).toString();
    const request = route.request();
    const headers = { ...request.headers() };
    delete headers.host;
    delete headers['content-length'];

    const response = await fetch(targetUrl, {
      method: request.method(),
      headers,
      body: request.method() === 'GET' || request.method() === 'HEAD'
        ? undefined
        : new Uint8Array(await request.postDataBuffer() ?? new ArrayBuffer(0)),
    });

    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: Buffer.from(await response.arrayBuffer()),
    });
  });

  const page = await context.newPage();
  page.on('websocket', (websocket) => {
    browserLogs.push(`[websocket] ${websocket.url()}`);
    websocket.on('framereceived', (payload) => {
      browserLogs.push(`[ws:in] ${typeof payload === 'string' ? payload : '[binary]'}`);
    });
    websocket.on('framesent', (payload) => {
      browserLogs.push(`[ws:out] ${typeof payload === 'string' ? payload : '[binary]'}`);
    });
  });
  page.on('request', (request) => {
    if (request.url().includes('/api/sessions') || request.url().includes('/api/usage')) {
      browserLogs.push(`[request] ${request.method()} ${request.url()}`);
    }
  });
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('/api/sessions') || url.includes('/api/usage')) {
      const body = await response.text();
      browserLogs.push(`[response] ${response.status()} ${url} ${body.slice(0, 300)}`);
    }
  });
  page.on('console', (message) => {
    browserLogs.push(`[console:${message.type()}] ${message.text()}`);
  });
  page.on('pageerror', (error) => {
    browserLogs.push(`[pageerror] ${error.message}`);
  });
  await page.goto(frontendUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('agentCount') !== null);
  return { browser, context, page };
}

async function getNavigationCount(page: Page) {
  return await page.evaluate(() => {
    const entries = performance.getEntriesByType('navigation');
    return entries.length || 1;
  });
}

async function waitForSidebarSession(page: Page, sessionId: string, timeoutMs = 90_000) {
  await page.waitForFunction(
    (targetSessionId) => {
      const rows = Array.from(document.querySelectorAll('#sidebar .sidebar__agent'));
      return rows.some((row) => row.getAttribute('data-session-id') === targetSessionId);
    },
    sessionId,
    { timeout: timeoutMs },
  );
}

async function waitForSidebarSessionStatus(page: Page, sessionId: string, statuses: string[], timeoutMs = 120_000) {
  await page.waitForFunction(
    ({ targetSessionId, expectedStatuses }) => {
      const rows = Array.from(document.querySelectorAll('#sidebar .sidebar__agent'));
      const row = rows.find((candidate) => candidate.getAttribute('data-session-id') === targetSessionId);
      if (!row) {
        return false;
      }

      const status = (row.getAttribute('data-status') || '').toLowerCase();
      return expectedStatuses.includes(status);
    },
    { targetSessionId: sessionId, expectedStatuses: statuses },
    { timeout: timeoutMs },
  );
}

async function waitForSidebarSessionGone(page: Page, sessionId: string, timeoutMs = 60_000) {
  await page.waitForFunction(
    (targetSessionId) => {
      const rows = Array.from(document.querySelectorAll('#sidebar .sidebar__agent'));
      return rows.every((row) => row.getAttribute('data-session-id') !== targetSessionId);
    },
    sessionId,
    { timeout: timeoutMs },
  );
}

function formatDiagnostics(processes: StartedProcess[]) {
  return processes.map((processHandle) => {
    const { stdout, stderr } = processHandle.getOutput();
    return [
      `[${processHandle.name}] ${processHandle.commandLine}`,
      '[stdout]',
      stdout || '(empty)',
      '[stderr]',
      stderr || '(empty)',
    ].join('\n');
  }).join('\n\n');
}

describe('manual live session E2E', () => {
  it('shows new sessions in the browser without a manual refresh', async () => {
    const hubPort = await getFreePort();
    const frontendPort = await getFreePort();
    const hubUrl = `http://127.0.0.1:${hubPort}`;
    const frontendUrl = `http://127.0.0.1:${frontendPort}`;
    const hubAuthToken = `claudeville-e2e-${Date.now()}`;

    const startedProcesses: StartedProcess[] = [];
    const tempProjects: string[] = [];
    const tempHomes: string[] = [];
    const browserLogs: string[] = [];
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      const openclawHome = createOpenClawHome(['e2e-alpha', 'e2e-beta']);
      tempHomes.push(openclawHome);

      const hubreceiver = startNpmScript('hubreceiver', 'dev:hubreceiver', {
        HUB_PORT: String(hubPort),
        HUB_AUTH_TOKEN: hubAuthToken,
      });
      startedProcesses.push(hubreceiver);
      await waitForJson(`${hubUrl}/health`, (json) => json?.ok === true, 30_000);

      const collector = startNpmScript('collector', 'dev:collector', {
        HOME: openclawHome,
        HUB_URL: hubUrl,
        HUB_AUTH_TOKEN: hubAuthToken,
        COLLECTOR_ID: `claudeville-e2e-${Date.now()}`,
        COLLECTOR_HOST: os.hostname(),
        FLUSH_INTERVAL_MS: '250',
        COLLECTOR_ACTIVE_THRESHOLD_MS: '300000',
      });
      startedProcesses.push(collector);
      await waitForJson(`${hubUrl}/health`, (json) => json?.ok === true, 30_000);

      const frontend = startNpmScript(
        'frontend',
        'dev:frontend',
        {
          HUB_HTTP_URL: hubUrl,
          HUB_WS_URL: `${hubUrl.replace(/^http/, 'ws')}/ws`,
          VITE_CLAUDEVILLE_REFRESH_INTERVAL_MS: '250',
        },
        ['--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'],
      );
      startedProcesses.push(frontend);
      await waitForText(frontendUrl, (text) => text.includes('__CLAUDEVILLE_CONFIG__'), 30_000);

      ({ browser, context, page } = await launchBrowser(frontendUrl, hubUrl, browserLogs));
      const initialNavigationCount = await getNavigationCount(page);
      expect(initialNavigationCount).toBeGreaterThanOrEqual(1);

      const firstProject = createClaudePromptWorkspace();
      tempProjects.push(firstProject);
      const firstSessionId = 'session-1';
      const firstAgentId = 'e2e-alpha';
      const firstSessionFile = path.join(openclawHome, '.openclaw', 'agents', firstAgentId, 'sessions', `${firstSessionId}.jsonl`);
      const firstPrompt = seedOpenClawSession(
        firstAgentId,
        firstSessionId,
        firstProject,
        openclawHome,
        'Working on the first live session',
      );
      startedProcesses.push(firstPrompt);

      await waitForProcessExit(firstPrompt, 10_000);

      const firstSession = await waitForHubSession(hubUrl, `openclaw:${firstAgentId}:${firstSessionId}`, 'openclaw', 90_000);
      await waitForSidebarSession(page, firstSession.sessionId, 90_000);
      expect(await getNavigationCount(page)).toBe(initialNavigationCount);

      await waitForSidebarSessionStatus(page, firstSession.sessionId, ['waiting', 'idle'], 120_000);
      expireOpenClawSession(firstSessionFile);
      await waitForHubSessionGone(hubUrl, firstSession.sessionId, 'openclaw', 60_000);
      await waitForSidebarSessionGone(page, firstSession.sessionId, 60_000);
      expect(await getNavigationCount(page)).toBe(initialNavigationCount);

      const secondProject = createClaudePromptWorkspace();
      tempProjects.push(secondProject);
      const secondSessionId = 'session-2';
      const secondAgentId = 'e2e-beta';
      const secondSessionFile = path.join(openclawHome, '.openclaw', 'agents', secondAgentId, 'sessions', `${secondSessionId}.jsonl`);
      const secondPrompt = seedOpenClawSession(
        secondAgentId,
        secondSessionId,
        secondProject,
        openclawHome,
        'Working on the second live session',
      );
      startedProcesses.push(secondPrompt);

      await waitForProcessExit(secondPrompt, 10_000);

      const secondSession = await waitForHubSession(hubUrl, `openclaw:${secondAgentId}:${secondSessionId}`, 'openclaw', 90_000);
      await waitForSidebarSession(page, secondSession.sessionId, 90_000);
      expect(await getNavigationCount(page)).toBe(initialNavigationCount);

      await waitForSidebarSessionStatus(page, secondSession.sessionId, ['waiting', 'idle'], 120_000);
      expireOpenClawSession(secondSessionFile);
    } catch (error) {
      const browserState = page
        ? await page.evaluate(() => {
          const agentCount = document.getElementById('agentCount')?.textContent || '(missing)';
          const projectNames = Array.from(document.querySelectorAll('#sidebar .sidebar__project-name')).map((node) => node.textContent?.trim() || '');
          const agentRows = Array.from(document.querySelectorAll('#sidebar .sidebar__agent')).map((node) => ({
            sessionId: node.getAttribute('data-session-id'),
            status: node.getAttribute('data-status'),
            name: node.querySelector('.sidebar__agent-name')?.textContent?.trim() || '',
            project: node.closest('.sidebar__project-group')?.querySelector('.sidebar__project-name')?.textContent?.trim() || '',
          }));
          return { agentCount, projectNames, agentRows };
        })
        : null;

      throw new Error(
          `${error instanceof Error ? error.message : String(error)}\n\n${formatDiagnostics(startedProcesses)}\n\n[browser]\n${JSON.stringify(browserState, null, 2)}\n\n[browser logs]\n${browserLogs.slice(-50).join('\n') || '(none)'}`,
      );
    } finally {
      if (page) {
        await page.close();
      }
      if (context) {
        await context.close();
      }
      if (browser) {
        await browser.close();
      }

      for (const processHandle of [...startedProcesses].reverse()) {
        await stopProcess(processHandle);
      }

      for (const tempProject of tempProjects) {
        fs.rmSync(tempProject, { recursive: true, force: true });
      }

      for (const tempHome of tempHomes) {
        fs.rmSync(tempHome, { recursive: true, force: true });
      }
    }
  }, 6 * 60 * 1000);
});
