import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { collectScanByMtime } from './scan-utils';

let tmpDir = '';

const HOUR_MS = 60 * 60 * 1000;

const sessionDir = () => path.join(tmpDir, 'session-state');
const eventsFile = (name: string) => path.join(sessionDir(), name, 'events.jsonl');

/** Create a session dir holding `events.jsonl`, the shape every JSONL-family adapter uses. */
function makeSession(name: string, contents = '{}\n') {
  fs.mkdirSync(path.join(sessionDir(), name), { recursive: true });
  fs.writeFileSync(eventsFile(name), contents);
  return eventsFile(name);
}

/**
 * Run `fn` with DEBUG on, collecting what debugAdapterError wrote to console.debug.
 * Restores both DEBUG and the console spy in `finally`, so a failing assertion
 * cannot leak DEBUG=1 into a later test.
 */
async function withDebug<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const original = process.env.DEBUG;
  const spy = vi.spyOn(console, 'debug').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  process.env.DEBUG = '1';
  try {
    const result = await fn();
    return { result, lines };
  } finally {
    spy.mockRestore();
    if (original === undefined) delete process.env.DEBUG;
    else process.env.DEBUG = original;
  }
}

type ScanOptions = Parameters<typeof collectScanByMtime>[0];
type ScanRecord = { sessionId: string; filePath: string; mtime: number };

function scanOptions(overrides: Partial<ScanOptions> = {}): ScanOptions {
  return {
    dir: sessionDir(),
    scope: 'test',
    operation: 'scanAllSessions',
    thresholdMs: HOUR_MS,
    fileFor: eventsFile,
    build: (candidate) => ({ sessionId: candidate.name, filePath: candidate.filePath, mtime: candidate.mtimeMs }),
    ...overrides,
  };
}

const idsOf = (records: ScanRecord[]) => records.map((r) => r.sessionId).sort();

describe('collectScanByMtime', () => {
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeville-scan-utils-'));
  });

  afterEach(() => {
    fs.rmSync(sessionDir(), { recursive: true, force: true });
  });

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns a record for every fresh file under thresholdMs', async () => {
    makeSession('aaa');
    makeSession('bbb');

    const result = await collectScanByMtime<ScanRecord>(scanOptions());

    expect(idsOf(result)).toEqual(['aaa', 'bbb']);
    const bbb = result.find((r) => r.sessionId === 'bbb');
    expect(bbb?.filePath).toBe(eventsFile('bbb'));
    expect(bbb?.mtime).toBeGreaterThan(0);
  });

  it('drops files older than thresholdMs', async () => {
    const fresh = makeSession('fresh');
    const stale = makeSession('stale');
    const twoHoursAgo = new Date(Date.now() - 2 * HOUR_MS);
    fs.utimesSync(stale, twoHoursAgo, twoHoursAgo);

    const result = await collectScanByMtime<ScanRecord>(scanOptions());

    expect(idsOf(result)).toEqual(['fresh']);
    expect(result[0].filePath).toBe(fresh);
  });

  it('skips a child whose fileFor returns null without ever stat-ing it', async () => {
    // Two children: one fileFor rejects, one points at a file that is not there.
    // The `!filePath` guard returns before stat and therefore logs nothing; only
    // the genuinely-missing file reaches the stat-throw path. Exactly one log
    // line, naming the missing file — so deleting the guard (which would send
    // `null` into fs.promises.stat and log a second line) is caught here.
    makeSession('no-file');
    fs.mkdirSync(path.join(sessionDir(), 'missing'), { recursive: true });

    const { result, lines } = await withDebug(() => collectScanByMtime<ScanRecord>(scanOptions({
      fileFor: (name) => (name === 'no-file' ? null : eventsFile(name)),
    })));

    expect(result).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('scanAllSessions stat');
    expect(lines[0]).toContain(eventsFile('missing'));
    expect(lines[0]).not.toContain('no-file');
  });

  it('returns [] when the base dir does not exist', async () => {
    const result = await collectScanByMtime<ScanRecord>(scanOptions({ dir: path.join(tmpDir, 'no-such-dir') }));

    expect(result).toEqual([]);
  });

  it('filters out records for which build returns null', async () => {
    makeSession('kept');
    makeSession('dropped');

    const result = await collectScanByMtime<ScanRecord>(scanOptions({
      build: (candidate) => (candidate.name === 'dropped' ? null : { sessionId: candidate.name, filePath: '', mtime: 0 }),
    }));

    expect(result).toEqual([{ sessionId: 'kept', filePath: '', mtime: 0 }]);
  });

  it('skips a child whose candidate file is missing', async () => {
    makeSession('present');
    fs.mkdirSync(path.join(sessionDir(), 'empty'), { recursive: true });

    const result = await collectScanByMtime<ScanRecord>(scanOptions());

    expect(idsOf(result)).toEqual(['present']);
  });

  it('ignores plain files sitting in the scanned dir', async () => {
    // fileFor resolves a `*.jsonl` name to that name's own path — the shape an
    // adapter would use if its sessions were `.jsonl` files sitting directly in
    // the scanned dir. (It is NOT pi's shape: pi's sessions are one level below
    // its project dirs, `pi.ts:249`, which is why pi does not fit this helper.)
    // For a stray plain file that path EXISTS, so without the isDirectory()
    // filter it would stat cleanly and get built as a record.
    makeSession('real-session');
    fs.writeFileSync(path.join(sessionDir(), 'stray.jsonl'), '{}\n');

    const result = await collectScanByMtime<ScanRecord>(scanOptions({
      fileFor: (name) => (name.endsWith('.jsonl') ? path.join(sessionDir(), name) : eventsFile(name)),
    }));

    expect(fs.existsSync(path.join(sessionDir(), 'stray.jsonl'))).toBe(true);
    expect(idsOf(result)).toEqual(['real-session']);
  });

  it('returns records in readdir order, without sorting or reversing', async () => {
    makeSession('alpha');
    makeSession('mike');
    makeSession('zulu');

    // readdir order is filesystem-dependent, so the expectation is derived from
    // readdir rather than hardcoded. But on APFS and ext4 readdir hands back
    // alphabetical order, which would make "no sort" indistinguishable from
    // "sorted" to any black-box assertion. So the fixture also pins each
    // session's mtime in REVERSE enumeration order, which makes mtime order and
    // readdir order provably different — a helper that sorted by mtime (or
    // reversed) now shows up as a sequence mismatch on every filesystem.
    const expectedOrder = fs.readdirSync(sessionDir(), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    const base = Date.now() - HOUR_MS / 2;
    expectedOrder.forEach((name, i) => {
      const when = new Date(base + (expectedOrder.length - 1 - i) * 1000);
      fs.utimesSync(eventsFile(name), when, when);
    });

    const result = await collectScanByMtime<ScanRecord>(scanOptions());

    expect(expectedOrder).toHaveLength(3);
    expect(result.map((r) => r.sessionId)).toEqual(expectedOrder);

    // Fixture validity: if mtime order ever equals readdir order this test
    // would pass even against a sorting implementation, so fail loudly instead.
    const byMtime = [...result].sort((a, b) => a.mtime - b.mtime).map((r) => r.sessionId);
    expect(byMtime).not.toEqual(expectedOrder);
    expect([...result].reverse().map((r) => r.sessionId)).not.toEqual(expectedOrder);
  });

  it('builds every candidate concurrently rather than one at a time', async () => {
    // `Promise.all` is load-bearing for wall-clock: a sequential loop would stat
    // and build one session directory at a time, serialising every adapter's scan.
    // Nothing else in this file objects to that — the readdir-order case above
    // still passes, because a sequential push loop preserves readdir order just
    // as well as a concurrent one. This is the case that catches it.
    //
    // Concurrency is OBSERVED, not timed: no wall-clock threshold appears here.
    //
    // The naive version of this check — bump a counter on entry, `await
    // setImmediate`, and assert the peak equals the child count — is NOT
    // deterministic, and was measured failing here: with 6 children the peak
    // reached 6 in only 6 of 40 runs (most often 4 or 5), because libuv's fs
    // threadpool completes the `stat` calls in waves and the first `setImmediate`
    // reaches the loop's check phase as soon as one wave has drained. With 2
    // children the peak was 1 — indistinguishable from a sequential scan — in 31
    // of 40 runs. So the peak is made provable instead of merely observed: a
    // barrier means no build can finish until all `children` have started, so the
    // peak in-flight count can ONLY be `children` if the implementation genuinely
    // began them all before awaiting any. A sequential loop blocks inside the
    // first build and never enters the second, so its peak is stuck at 1.
    //
    // The watchdog exists so the sequential mutant FAILS instead of hanging. It
    // releases the barrier after `WATCHDOG_TURNS` idle event-loop turns, letting
    // the scan complete so the peak assertion can report the real peak of 1. A
    // concurrent scan needs ~3-4 turns (measured, max 4 across idle / 2.4x /
    // 6.4x CPU load), so the two cases are roughly 25x apart — about 1.5 orders
    // of magnitude, not the 1000x first claimed. The watchdog counts event-loop
    // iterations rather than elapsed time: libuv dispatches completed threadpool
    // requests in the poll phase of each iteration, so a queued `stat` lands
    // within ~1 turn. 100 turns would need 100 consecutive poll phases with no
    // fs callback completing. This is a liveness backstop, not a race.
    //
    // This pins UNBOUNDED concurrency: a deliberate move to bounded concurrency
    // (e.g. LIMIT=8, to avoid EMFILE on a 10k-child session dir) turns this red
    // even though it would improve wall-clock. That is intentional — the hazard
    // being guarded is silent serialization — but be aware before changing it.
    const children = ['s1', 's2', 's3', 's4', 's5', 's6'];
    for (const name of children) makeSession(name);

    const WATCHDOG_TURNS = 100;
    let inFlight = 0;
    let peakInFlight = 0;
    let entered = 0;
    let idleTurns = 0;
    let releaseBarrier!: () => void;
    const allEntered = new Promise<void>((resolve) => { releaseBarrier = resolve; });

    const watchdog = (async () => {
      while (entered < children.length && idleTurns < WATCHDOG_TURNS) {
        await new Promise((resolve) => setImmediate(resolve));
        idleTurns += 1;
      }
      releaseBarrier();
    })();

    const result = await collectScanByMtime<ScanRecord>(scanOptions({
      build: async (candidate) => {
        inFlight += 1;
        peakInFlight = Math.max(peakInFlight, inFlight);
        entered += 1;
        idleTurns = 0; // a new entrant means the scan is making progress
        if (entered === children.length) releaseBarrier();
        await allEntered;
        inFlight -= 1;
        return { sessionId: candidate.name, filePath: candidate.filePath, mtime: candidate.mtimeMs };
      },
    }));
    await watchdog;

    // Every child still produced its record — the barrier delays finishing, it
    // does not change what is produced or its order.
    expect(idsOf(result)).toEqual([...children].sort());
    // All six were in flight together. A sequential loop holds this at 1.
    expect(peakInFlight).toBe(children.length);
  });

  it('returns [] and logs when dir is a file rather than a directory', async () => {
    // existsSync passes for a plain file, so readdir is reached and throws
    // ENOTDIR — the only way to cover the outer catch without mocking fs.
    const notADir = path.join(tmpDir, 'plain-file');
    fs.writeFileSync(notADir, 'x\n');

    const { result, lines } = await withDebug(() => collectScanByMtime<ScanRecord>(
      scanOptions({ dir: notADir }),
    ));

    expect(result).toEqual([]);
    expect(lines).toHaveLength(1);
    // The outer catch logs the bare operation; the per-candidate catch would
    // have appended " stat". Matching the full label keeps this immune to
    // whatever random characters mkdtemp put in the path.
    expect(lines[0]).toMatch(/^\[test\] scanAllSessions /);
    expect(lines[0]).not.toContain('scanAllSessions stat');
    expect(lines[0]).toContain('ENOTDIR');
  });
});