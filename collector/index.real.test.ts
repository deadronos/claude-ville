import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { estimateCost } from '../shared/cost.js';

type TokenUsage = {
  totalInput?: number;
  totalOutput?: number;
  input?: number;
  output?: number;
};

type SessionDetail = {
  tokenUsage?: TokenUsage | null;
};

type ActiveSession = {
  provider: string;
  sessionId: string;
  project: string;
  model: string;
  tokens?: { input: number; output: number };
  detail?: SessionDetail | null;
};

type CollectorOptions = {
  sessions?: ActiveSession[];
  sessionDetails?: Record<string, SessionDetail | null>;
  watchPaths?: string[];
  providers?: unknown[];
  teams?: unknown[];
  taskGroups?: unknown[];
  includeClaudeAdapter?: boolean;
  fetchMock?: ReturnType<typeof vi.fn>;
};

type CollectorModule = typeof import('./index.ts');

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function drainAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

async function loadCollectorModule(): Promise<CollectorModule> {
  vi.resetModules();
  return import('./index.ts');
}

function createHarness(createCollectorRuntime: CollectorModule['createCollectorRuntime'], options: CollectorOptions = {}) {
  let watcherCallback: (() => void) | undefined;
  let intervalCallback: (() => void) | undefined;
  let nextTimeoutId = 1;

  const timeoutCallbacks = new Map<number, () => void>();
  const signalHandlers = new Map<string, () => void>();
  const fetchMock = options.fetchMock ?? vi.fn().mockResolvedValue({ ok: true, status: 202, statusText: 'Accepted' });
  const createFileWatchers = vi.fn((paths: string[], onChange: () => void) => {
    watcherCallback = onChange;
    return { watchCount: paths.length };
  });
  const getAllSessions = vi.fn().mockResolvedValue(options.sessions ?? []);
  const getAllWatchPaths = vi.fn().mockReturnValue(options.watchPaths ?? ['/tmp/provider-a']);
  const getActiveProviders = vi.fn().mockReturnValue(options.providers ?? [{ provider: 'claude' }]);
  const getSessionDetailByProvider = vi.fn().mockImplementation(async (provider: string, sessionId: string) => {
    return options.sessionDetails?.[`${provider}:${sessionId}`] ?? null;
  });
  const claudeGetTeams = vi.fn().mockResolvedValue(options.teams ?? []);
  const claudeGetTasks = vi.fn().mockResolvedValue(options.taskGroups ?? []);
  const logSpy = vi.fn();
  const errorSpy = vi.fn();
  const processOnSpy = vi.fn((event: string, handler: () => void) => {
    signalHandlers.set(event, handler);
    return process;
  });
  const processExitSpy = vi.fn();
  const setIntervalSpy = vi.fn((callback: () => void) => {
    intervalCallback = callback;
    return 1 as unknown as ReturnType<typeof setInterval>;
  });
  const setTimeoutSpy = vi.fn((callback: () => void) => {
    const timerId = nextTimeoutId++;
    timeoutCallbacks.set(timerId, () => {
      timeoutCallbacks.delete(timerId);
      callback();
    });
    return timerId as unknown as ReturnType<typeof setTimeout>;
  });
  const clearTimeoutSpy = vi.fn((timer: ReturnType<typeof setTimeout>) => {
    timeoutCallbacks.delete(Number(timer));
  });

  const runtime = createCollectorRuntime(
    {
      createFileWatchers,
      createHash,
      adapters: options.includeClaudeAdapter === false
        ? []
        : [{ provider: 'claude', getTeams: claudeGetTeams, getTasks: claudeGetTasks }],
      getAllSessions,
      getAllWatchPaths,
      getActiveProviders,
      getSessionDetailByProvider,
      fetch: fetchMock as typeof fetch,
      setTimeout: setTimeoutSpy as typeof setTimeout,
      clearTimeout: clearTimeoutSpy as typeof clearTimeout,
      setInterval: setIntervalSpy as typeof setInterval,
      console: { log: logSpy, error: errorSpy },
      process: { on: processOnSpy as typeof process.on, exit: processExitSpy as typeof process.exit },
    },
    {
      hubUrl: 'http://hub.test',
      hubAuthToken: 'test-token',
      collectorId: 'collector-test',
      collectorHost: 'collector-host',
      flushIntervalMs: 5000,
      activeThresholdMs: 120000,
    },
  );

  return {
    runtime,
    fetchMock,
    createFileWatchers,
    getAllSessions,
    getSessionDetailByProvider,
    logSpy,
    errorSpy,
    processOnSpy,
    processExitSpy,
    setIntervalSpy,
    setTimeoutSpy,
    clearTimeoutSpy,
    timeoutCallbacks,
    signalHandlers,
    get watcherCallback() {
      return watcherCallback;
    },
    get intervalCallback() {
      return intervalCallback;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('collector/index.ts real module coverage', () => {
  it('publishes a normalized snapshot on startup', async () => {
    const { createCollectorRuntime } = await loadCollectorModule();
    const detailFromSession = { tokenUsage: { totalInput: 1200, totalOutput: 300 } };
    const detailFromLookup = { tokenUsage: { input: 40, output: 10 } };
    const harness = createHarness(createCollectorRuntime, {
      sessions: [
        {
          provider: 'claude',
          sessionId: 'claude-1',
          project: '/repo',
          model: 'claude-sonnet-4-5',
          tokens: { input: 1, output: 2 },
          detail: detailFromSession,
        },
        {
          provider: 'copilot',
          sessionId: 'copilot-2',
          project: '/repo/copilot',
          model: 'claude-haiku-4-5',
        },
      ],
      sessionDetails: {
        'copilot:copilot-2': detailFromLookup,
      },
      watchPaths: ['/tmp/provider-a', '/tmp/provider-b'],
      providers: [{ provider: 'claude' }, { provider: 'copilot' }],
      teams: [{ id: 'team-1', name: 'Alpha' }],
      taskGroups: [{ id: 'task-1', title: 'Current sprint' }],
    });

    harness.runtime.attachSignalHandlers();
    await harness.runtime.main();

    expect(harness.getAllSessions).toHaveBeenCalledWith(120000);
    expect(harness.getSessionDetailByProvider).toHaveBeenCalledTimes(1);
    expect(harness.getSessionDetailByProvider).toHaveBeenCalledWith('copilot', 'copilot-2', '/repo/copilot');
    expect(harness.createFileWatchers).toHaveBeenCalledWith(['/tmp/provider-a', '/tmp/provider-b'], expect.any(Function));
    expect(harness.processOnSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(harness.processOnSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(harness.setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000);

    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = harness.fetchMock.mock.calls[0];
    expect(url).toBe('http://hub.test/api/collector/snapshot');
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-token',
      },
    });

    const snapshot = JSON.parse(String(init.body));
    expect(snapshot).toMatchObject({
      collectorId: 'collector-test',
      hostName: 'collector-host',
      providers: [{ provider: 'claude' }, { provider: 'copilot' }],
      teams: [{ id: 'team-1', name: 'Alpha' }],
      taskGroups: [{ id: 'task-1', title: 'Current sprint' }],
    });
    expect(snapshot.sessionDetails).toEqual({
      'claude:claude-1': detailFromSession,
      'copilot:copilot-2': detailFromLookup,
    });
    expect(snapshot.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sessionId: 'claude-1',
          tokens: { input: 1200, output: 300 },
          tokenUsage: detailFromSession.tokenUsage,
          estimatedCost: estimateCost('claude-sonnet-4-5', { input: 1200, output: 300 }),
        }),
        expect.objectContaining({
          sessionId: 'copilot-2',
          tokens: { input: 40, output: 10 },
          tokenUsage: detailFromLookup.tokenUsage,
          estimatedCost: estimateCost('claude-haiku-4-5', { input: 40, output: 10 }),
        }),
      ]),
    );
    expect(harness.logSpy).toHaveBeenCalledWith('[collector] watching 2 path(s)');
    expect(harness.logSpy).toHaveBeenCalledWith('[collector] published snapshot (2 sessions)');
  });

  it('skips unchanged interval publishes, debounces watcher flushes, and cleans up on signals', async () => {
    const { createCollectorRuntime } = await loadCollectorModule();
    const harness = createHarness(createCollectorRuntime, {
      sessions: [],
      includeClaudeAdapter: false,
      providers: [{ provider: 'copilot' }],
    });

    harness.runtime.attachSignalHandlers();
    await harness.runtime.main();

    expect(harness.fetchMock).toHaveBeenCalledTimes(1);

    harness.intervalCallback?.();
    await drainAsyncWork();
    expect(harness.fetchMock).toHaveBeenCalledTimes(1);

    harness.watcherCallback?.();
    harness.watcherCallback?.();
    expect(harness.setTimeoutSpy).toHaveBeenCalledTimes(2);
    expect(harness.clearTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(harness.timeoutCallbacks.size).toBe(1);

    const flushCallback = Array.from(harness.timeoutCallbacks.values())[0];
    flushCallback?.();
    await drainAsyncWork();
    expect(harness.fetchMock).toHaveBeenCalledTimes(2);
    expect(harness.logSpy).toHaveBeenCalledWith('[collector] published snapshot (0 sessions)');

    harness.watcherCallback?.();
    const pendingTimerId = Array.from(harness.timeoutCallbacks.keys())[0];
    expect(pendingTimerId).toBeDefined();

    harness.signalHandlers.get('SIGINT')?.();
    harness.signalHandlers.get('SIGTERM')?.();

    expect(harness.clearTimeoutSpy).toHaveBeenLastCalledWith(pendingTimerId as unknown as ReturnType<typeof setTimeout>);
    expect(harness.processExitSpy).toHaveBeenNthCalledWith(1, 0);
    expect(harness.processExitSpy).toHaveBeenNthCalledWith(2, 0);
  });

  it('keeps dirty state on failures and retries after an in-flight publish finishes', async () => {
    const { createCollectorRuntime } = await loadCollectorModule();
    const firstResponse = createDeferred<{ ok: boolean; status: number; statusText: string }>();
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => firstResponse.promise)
      .mockResolvedValueOnce({ ok: true, status: 202, statusText: 'Accepted' });
    const harness = createHarness(createCollectorRuntime, {
      sessions: [
        {
          provider: 'claude',
          sessionId: 'claude-1',
          project: '/repo',
          model: 'claude-sonnet-4-5',
        },
      ],
      fetchMock,
    });

    const mainPromise = harness.runtime.main();
  await drainAsyncWork();
    expect(harness.fetchMock).toHaveBeenCalledTimes(1);

    harness.watcherCallback?.();
    const queuedFlush = Array.from(harness.timeoutCallbacks.values())[0];
    queuedFlush?.();
    await drainAsyncWork();
    expect(harness.fetchMock).toHaveBeenCalledTimes(1);

    firstResponse.resolve({ ok: false, status: 503, statusText: 'Service Unavailable' });
    await mainPromise;
    await drainAsyncWork();

    expect(harness.errorSpy).toHaveBeenCalledWith('[collector] publish failed:', 'hub rejected snapshot: 503 Service Unavailable');
    expect(harness.intervalCallback).toEqual(expect.any(Function));

    harness.intervalCallback?.();
    await drainAsyncWork();

    expect(harness.fetchMock).toHaveBeenCalledTimes(2);
    expect(harness.logSpy).toHaveBeenCalledWith('[collector] published snapshot (1 sessions)');
  });
});
