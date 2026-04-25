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
const commandProbe = process.platform === 'win32' ? 'where' : 'which';
const claudeCommand = process.env.CLAUDEVILLE_E2E_CLAUDE_BIN || 'claude';
const claudeProjectsDir = path.join(process.env.CLAUDE_DIR || path.join(os.homedir(), '.claude'), 'projects');

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

function startClaudePrompt(prompt: string, cwd: string) {
  return startProcess(
    `claude:${path.basename(cwd)}`,
    claudeCommand,
    ['-p', prompt],
    {
      NO_COLOR: '1',
    },
    cwd,
    false,
  );
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

async function runCommand(command: string, args: string[], cwd = repoRoot) {
  const handle = startProcess(`probe:${command}`, command, args, {}, cwd, false);
  const result = await waitForProcessExit(handle, 10_000);
  return {
    ...result,
    ...handle.getOutput(),
  };
}

async function ensureClaudeCliAvailable() {
  const result = await runCommand(commandProbe, [claudeCommand]);
  if (result.code !== 0) {
    throw new Error(
      `Claude CLI is required for the live E2E test. Checked ${claudeCommand} with ${commandProbe}.\n\n` +
      `[stdout]\n${result.stdout}\n[stderr]\n${result.stderr}`,
    );
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

function findLatestClaudeSessionFile(projectPath: string) {
  if (!fs.existsSync(claudeProjectsDir)) {
    return null;
  }

  const projectSlug = path.basename(projectPath).replace(/^[^a-zA-Z0-9]+/, '');
  if (!projectSlug) {
    return null;
  }

  let latestMatch: { sessionId: string; projectDir: string; filePath: string; mtimeMs: number } | null = null;
  const projectDirs = fs.readdirSync(claudeProjectsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());

  for (const projectDir of projectDirs) {
    if (!projectDir.name.includes(projectSlug)) {
      continue;
    }

    const projectDirPath = path.join(claudeProjectsDir, projectDir.name);
    const sessionFiles = fs.readdirSync(projectDirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'));

    for (const sessionFile of sessionFiles) {
      const filePath = path.join(projectDirPath, sessionFile.name);
      const stat = fs.statSync(filePath);
      if (!latestMatch || stat.mtimeMs >= latestMatch.mtimeMs) {
        latestMatch = {
          sessionId: sessionFile.name.replace(/\.jsonl$/, ''),
          projectDir: projectDir.name,
          filePath,
          mtimeMs: stat.mtimeMs,
        };
      }
    }
  }

  return latestMatch;
}

async function waitForClaudeSessionFile(projectPath: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastSeenProjects = '(none)';

  while (Date.now() < deadline) {
    const match = findLatestClaudeSessionFile(projectPath);
    if (match) {
      return match;
    }

    if (fs.existsSync(claudeProjectsDir)) {
      lastSeenProjects = fs.readdirSync(claudeProjectsDir).slice(-20).join('\n') || '(none)';
    }
    await delay(250);
  }

  throw new Error(`Timed out waiting for a Claude session file for ${projectPath}. Recent ~/.claude/projects entries:\n${lastSeenProjects}`);
}

async function waitForHubSession(hubUrl: string, sessionId: string, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot = '[]';

  while (Date.now() < deadline) {
    const sessions = await fetchSessions(hubUrl);
    const match = sessions.find((session) => session.provider === 'claude' && session.sessionId === sessionId);
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

  throw new Error(`Timed out waiting for Claude session ${sessionId} to reach hubreceiver. Last sessions snapshot:\n${lastSnapshot}`);
}

async function waitForHubSessionGone(hubUrl: string, sessionId: string, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let lastSnapshot = '[]';

  while (Date.now() < deadline) {
    const sessions = await fetchSessions(hubUrl);
    const match = sessions.find((session) => session.provider === 'claude' && session.sessionId === sessionId);
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

  throw new Error(`Timed out waiting for Claude session ${sessionId} to disappear from hubreceiver. Last sessions snapshot:\n${lastSnapshot}`);
}

async function launchBrowser(frontendUrl: string, hubUrl: string) {
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
    await route.continue({ url: targetUrl });
  });

  const page = await context.newPage();
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

async function waitForAgentCount(page: Page, expectedCount: number, timeoutMs = 90_000) {
  await page.waitForFunction(
    (targetCount) => {
      const countText = document.getElementById('agentCount')?.textContent || '0';
      return Number(countText) === targetCount;
    },
    expectedCount,
    { timeout: timeoutMs },
  );
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
  it('shows new Claude sessions in the browser without a manual refresh', async () => {
    await ensureClaudeCliAvailable();

    const hubPort = await getFreePort();
    const frontendPort = await getFreePort();
    const hubUrl = `http://127.0.0.1:${hubPort}`;
    const frontendUrl = `http://127.0.0.1:${frontendPort}`;
    const hubAuthToken = `claudeville-e2e-${Date.now()}`;

    const startedProcesses: StartedProcess[] = [];
    const tempProjects: string[] = [];
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      const hubreceiver = startNpmScript('hubreceiver', 'dev:hubreceiver', {
        HUB_PORT: String(hubPort),
        HUB_AUTH_TOKEN: hubAuthToken,
      });
      startedProcesses.push(hubreceiver);
      await waitForJson(`${hubUrl}/health`, (json) => json?.ok === true, 30_000);

      const collector = startNpmScript('collector', 'dev:collector', {
        HUB_URL: hubUrl,
        HUB_AUTH_TOKEN: hubAuthToken,
        COLLECTOR_ID: `claudeville-e2e-${Date.now()}`,
        COLLECTOR_HOST: os.hostname(),
        FLUSH_INTERVAL_MS: '250',
        COLLECTOR_ACTIVE_THRESHOLD_MS: '15000',
      });
      startedProcesses.push(collector);
      await waitForJson(`${hubUrl}/health`, (json) => json?.ok === true && Number(json.collectors || 0) >= 1, 30_000);

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

      ({ browser, context, page } = await launchBrowser(frontendUrl, hubUrl));
      const initialNavigationCount = await getNavigationCount(page);
      expect(initialNavigationCount).toBeGreaterThanOrEqual(1);

      const firstProject = createClaudePromptWorkspace();
      tempProjects.push(firstProject);
      const firstPrompt = startClaudePrompt('In one short sentence, explain this project.', firstProject);
      startedProcesses.push(firstPrompt);

      const firstSessionFile = await waitForClaudeSessionFile(firstProject, 60_000);
      const firstSession = await waitForHubSession(hubUrl, firstSessionFile.sessionId, 90_000);
      await waitForSidebarSession(page, firstSession.sessionId, 90_000);
      expect(await getNavigationCount(page)).toBe(initialNavigationCount);

      const firstPromptExit = await waitForProcessExit(firstPrompt, 120_000);
      if (firstPromptExit.code !== 0) {
        const output = firstPrompt.getOutput();
        throw new Error(
          `The first Claude prompt exited with code ${firstPromptExit.code}.\n\n` +
          `[stdout]\n${output.stdout}\n[stderr]\n${output.stderr}`,
        );
      }

      await waitForSidebarSessionStatus(page, firstSession.sessionId, ['waiting', 'idle'], 120_000);
      await waitForHubSessionGone(hubUrl, firstSession.sessionId, 60_000);
      await waitForSidebarSessionGone(page, firstSession.sessionId, 60_000);
      expect(await getNavigationCount(page)).toBe(initialNavigationCount);

      const secondProject = createClaudePromptWorkspace();
      tempProjects.push(secondProject);
      const secondPrompt = startClaudePrompt('In one short sentence, explain this repo.', secondProject);
      startedProcesses.push(secondPrompt);

      const secondSessionFile = await waitForClaudeSessionFile(secondProject, 60_000);
      const secondSession = await waitForHubSession(hubUrl, secondSessionFile.sessionId, 90_000);
      await waitForSidebarSession(page, secondSession.sessionId, 90_000);
      expect(await getNavigationCount(page)).toBe(initialNavigationCount);

      const secondPromptExit = await waitForProcessExit(secondPrompt, 120_000);
      if (secondPromptExit.code !== 0) {
        const output = secondPrompt.getOutput();
        throw new Error(
          `The second Claude prompt exited with code ${secondPromptExit.code}.\n\n` +
          `[stdout]\n${output.stdout}\n[stderr]\n${output.stderr}`,
        );
      }
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
        `${error instanceof Error ? error.message : String(error)}\n\n${formatDiagnostics(startedProcesses)}\n\n[browser]\n${JSON.stringify(browserState, null, 2)}`,
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
    }
  }, 6 * 60 * 1000);
});
