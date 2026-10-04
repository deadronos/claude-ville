/**
 * Characterization test for the codex adapter.
 *
 * codex.test.ts is 568 lines / 30 tests, but it is the same shape
 * copilot.test.ts had before copilot.fixture.test.ts existed: it redefines
 * readLines/parseJsonLines inline and asserts against those copies, so it would
 * stay green through an arbitrary rewrite of the shipped adapter. Only its two
 * `codex token usage` cases touch shipped code at all (through getSessionDetail
 * with an explicit filePath), and both are single happy paths — so no
 * truncation cap, no maxItems slice, no directory fan-out limit, no mtime
 * threshold and no `session_meta` head window is pinned anywhere in the suite.
 *
 * This file drives the SHIPPED CodexAdapter against a synthetic
 * ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl tree so that a later conversion
 * to the shared pipeline helpers (collectJsonl / collectScanByMtime / foldJsonl)
 * can be verified as behaviour-preserving rather than merely asserted to be.
 *
 * The load-bearing case is the token fold. codex's getTokenUsage walks its window
 * NEWEST-FIRST and returns the FIRST `thread_token_usage` it meets, remembering
 * the FIRST `info.total_token_usage` it meets only as a fallback. A conversion
 * has to reproduce that with `reverse: true` plus `until`, and walking forwards
 * would silently answer with a different reading on every real rollout, because
 * a thread reading is always older than the totals that follow it.
 *
 * Two behaviours are deliberately NOT pinned, and one of them is a defect:
 *
 * - `scanRecentRollouts` lists each day directory with a bare `readdir`
 *   (codex.ts:223, no `withFileTypes`), so a DIRECTORY named `rollout-*.jsonl`
 *   passes the name filter, stats fine, and is emitted as a session whose
 *   project/model/lastMessage/lastTool are all null — `parseRollout` swallows
 *   the EISDIR from `readLines` and yields an empty detail. Asserting that
 *   would freeze the bug, so no fixture here creates one; see the report.
 * - The `d.isDirectory()` filter on the sessions root (codex.ts:194) is defence
 *   in depth with no observable difference: dropping it makes `readdir` raise
 *   ENOTDIR, which the per-year catch already discards. As in
 *   copilot.fixture.test.ts, the loose file is written to document that no
 *   assertion here can pin it.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sessionsOf } from './fixtureHelpers';

let tmpHome = '';
let CodexAdapter: any;
const originalHome = process.env.HOME;

let workspaceAlpha = '';
let workspaceDelta = '';
let workspaceEpsilon = '';
let workspaceGamma = '';

let alphaFile = '';
let deltaFile = '';
let epsilonFile = '';
let gammaFile = '';
let alphaMtime = 0;
let deltaMtime = 0;
let epsilonMtime = 0;
let gammaMtime = 0;

const sessionsRoot = () => path.join(tmpHome, '.codex', 'sessions');

/**
 * codex.ts:321 derives the session id from the file name alone —
 * `codex-` plus the name with its `rollout-` prefix and `.jsonl` suffix
 * stripped. `payload.id` is never read, so the two can disagree; ALPHA's
 * payload.id below is deliberately different from its file name.
 */
const sessionIdOf = (fileName: string) =>
  `codex-${fileName.replace('rollout-', '').replace('.jsonl', '')}`;

const ALPHA_FILE = 'rollout-2024-01-22T10-30-00-alpha1.jsonl';
const DELTA_FILE = 'rollout-2025-01-22T10-30-00-delta1.jsonl';
const EPSILON_FILE = 'rollout-2025-02-22T10-30-00-eps1.jsonl';
const GAMMA_FILE = 'rollout-2026-01-22T10-30-00-gam1.jsonl';

const ALPHA_ID = sessionIdOf(ALPHA_FILE);
const DELTA_ID = sessionIdOf(DELTA_FILE);
const EPSILON_ID = sessionIdOf(EPSILON_FILE);
const GAMMA_ID = sessionIdOf(GAMMA_FILE);

/** Writes `rollout-<name>` into <sessions>/<year>/<month>/<day>/. */
function writeRollout(year: string, month: string, day: string, name: string, entries: unknown[]) {
  const file = path.join(sessionsRoot(), year, month, day, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

const rollout = (year: string, month: string, day: string, name: string, entries: unknown[]) =>
  writeRollout(year, month, day, `rollout-${name}.jsonl`, entries);

/**
 * Runs `fn` against a THROWAWAY home directory with its own fresh module
 * instance, then restores HOME and leaves the suite's own adapter alone.
 * `SESSIONS_DIR` is derived from `os.homedir()` at module load (codex.ts:20-21),
 * so pointing HOME elsewhere and re-importing is what moves the tree. Cases that
 * build their own tree use this so that — with the suite running in shuffled order
 * and in parallel with the other adapters' fixtures — they cannot perturb the
 * shared fixture's exact-set assertions. Same re-import shape as
 * claude.fixture.test.ts's `withTempClaudeDir`.
 */
async function withTempCodexHome<T>(fn: (Adapter: any, root: string) => Promise<T>): Promise<T> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeville-codex-case-'));
  const prior = process.env.HOME;
  process.env.HOME = root;
  vi.resetModules();
  try {
    const { CodexAdapter: Fresh } = await import('./codex.js');
    return await fn(Fresh, root);
  } finally {
    if (prior === undefined) delete process.env.HOME;
    else process.env.HOME = prior;
    vi.resetModules();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * codex.ts:229 compares `now - stat.mtimeMs > activeThresholdMs` against a `now`
 * captured once at the top of the scan (codex.ts:189). The ages below are minutes
 * or tens of minutes against thresholds of the same magnitude, which leaves no
 * boundary to race while still pinning the comparison's SIGN: `mtimeMs - now >
 * threshold` would admit every stale fixture here.
 */
function backdate(file: string, msAgo: number) {
  const when = new Date(Date.now() - msAgo);
  fs.utimesSync(file, when, when);
  return fs.statSync(file).mtimeMs;
}

function removeMonth(year: string, month: string) {
  fs.rmSync(path.join(sessionsRoot(), year, month), { recursive: true, force: true });
}
function removeYear(year: string) {
  fs.rmSync(path.join(sessionsRoot(), year), { recursive: true, force: true });
}

const T0 = Date.UTC(2024, 0, 1, 0, 0, 0);
const at = (i: number) => new Date(T0 + i * 1000).toISOString();
const tsOf = (i: number) => new Date(at(i)).getTime();

const MINUTE = 60 * 1000;

/** `event_msg` lines that no reader treats as a tool, message or usage record. */
const filler = (n: number, from: number) =>
  Array.from({ length: n }, (_, i) => ({ type: 'event_msg', payload: { type: 'filler', i: from + i } }));

/**
 * JSON-stringifies to 108 chars — past the 60-char cap parseRollout applies to
 * `lastToolInput` (codex.ts:75) and past the 80-char cap getToolHistory applies
 * to a tool `detail` (codex.ts:120), so the exact prefix and its length pin
 * which site produced the string. `z` padding is past parseRollout's 80-char
 * `lastMessage` cap (codex.ts:86) and past getRecentMessages' 200-char cap
 * (codex.ts:170).
 */
const LONG_ARGS = { path: 'p'.repeat(30), q: 'q'.repeat(60) };
const LONG_ARGS_JSON = JSON.stringify(LONG_ARGS);
const LONG_STRING_ARGS = 's'.repeat(100);
const LONG_TEXT = 'z'.repeat(260);

const sessionMeta = (id: string, cwd: string, extra: Record<string, unknown> = {}) => ({
  type: 'session_meta',
  payload: { id, cwd, cli_version: '0.9.0', ...extra },
});

const assistantMessage = (text: string, i: number) => ({
  type: 'response_item',
  payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
  timestamp: at(i),
});

const functionCall = (name: string, args: unknown, i: number) => ({
  type: 'response_item',
  payload: { type: 'function_call', name, arguments: args },
  timestamp: at(i),
});

const totalUsage = (input: number, output: number) => ({
  type: 'event_msg',
  payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, output_tokens: output } } },
});

const threadUsage = (payload: Record<string, unknown>) => ({
  type: 'token_usage_record',
  payload: { thread_token_usage: payload },
});

describe('CodexAdapter fixtures', () => {
  beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeville-codex-'));
    workspaceAlpha = path.join(tmpHome, 'workspace', 'alpha');
    workspaceDelta = path.join(tmpHome, 'workspace', 'delta');
    workspaceEpsilon = path.join(tmpHome, 'workspace', 'epsilon');
    workspaceGamma = path.join(tmpHome, 'workspace', 'gamma');
    for (const dir of [workspaceAlpha, workspaceDelta, workspaceEpsilon, workspaceGamma]) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.mkdirSync(sessionsRoot(), { recursive: true });
    // A loose file at the top of the sessions root. codex.ts:194 keeps only
    // `d.isDirectory()` children, so this is not scanned as a year — and, as in
    // copilot.fixture.test.ts, dropping that filter is NOT observable through
    // the adapter: `readdir` on a file raises ENOTDIR, which the per-year catch
    // (codex.ts:251) already discards. The filter is defence in depth, so no
    // assertion here can pin it.
    fs.writeFileSync(path.join(sessionsRoot(), 'README.md'), 'not a year dir\n');

    // payload.id deliberately differs from the file name: codex derives the id
    // from the file name only.
    alphaFile = writeRollout('2024', '01', '22', ALPHA_FILE, [
      sessionMeta('a-different-payload-id', workspaceAlpha, { model: 'gpt-5-codex' }),
      functionCall('shell', '{"command":["ls","-la"]}', 1),
      assistantMessage('alpha done', 2),
      totalUsage(111, 11),
      totalUsage(222, 22),
    ]);
    alphaMtime = backdate(alphaFile, 2 * MINUTE);

    deltaFile = writeRollout('2025', '01', '22', DELTA_FILE, [
      // No `model` anywhere in this file, and a payload.cwd, so the row resolves
      // through the `detail.project || null` and `detail.model || 'codex'`
      // fallbacks (codex.ts:328-331).
      sessionMeta('delta1', workspaceDelta),
      assistantMessage('delta output', 2),
      totalUsage(333, 33),
    ]);
    deltaMtime = backdate(deltaFile, 8 * MINUTE);

    // Straddles the two thresholds: outside the 5-minute argument the listing
    // tests pass, inside the 30-minute window getSessionDetail hard-codes for
    // its own id-only rescan (codex.ts:355). That constant is otherwise
    // invisible.
    epsilonFile = writeRollout('2025', '02', '22', EPSILON_FILE, [
      sessionMeta('eps1', workspaceEpsilon, { model: 'gpt-5-codex' }),
      // The thread reading is OLDER than the total below it, which is the whole
      // point: walking newest-first, the total is met first and remembered as a
      // fallback, and only then does the thread reading win.
      threadUsage({ input_tokens: 7000, output_tokens: 700, total_tokens: 7700 }),
      functionCall('apply_patch', '{"input":"*** Begin Patch"}', 1),
      assistantMessage('epsilon done', 2),
      totalUsage(999, 99),
    ]);
    epsilonMtime = backdate(epsilonFile, MINUTE);

    gammaFile = writeRollout('2026', '01', '22', GAMMA_FILE, [
      sessionMeta('gam1', workspaceGamma),
      assistantMessage('gamma done', 1),
    ]);
    gammaMtime = backdate(gammaFile, 3 * MINUTE);

    // Siblings in GAMMA's day directory that the name filter (codex.ts:224)
    // must reject. `rollout-…jsonl.bak` contains ".jsonl" but does not END with
    // it, so an `includes` filter would list it; `other-…jsonl` ends with it but
    // does not START with `rollout-`.
    const gammaDir = path.dirname(gammaFile);
    fs.writeFileSync(path.join(gammaDir, GAMMA_FILE + '.bak'), 'not jsonl\n');
    fs.writeFileSync(path.join(gammaDir, GAMMA_FILE.replace('rollout-', 'other-')), 'not a rollout\n');
    fs.writeFileSync(path.join(gammaDir, 'notes.txt'), 'ignored\n');

    process.env.HOME = tmpHome;
    vi.resetModules();
    ({ CodexAdapter } = await import('./codex.js'));
  });

  afterAll(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('resolves its home and watch path from the injected HOME', () => {
    const adapter = new CodexAdapter();
    expect(adapter.isAvailable()).toBe(true);
    expect(adapter.homeDir).toBe(path.join(tmpHome, '.codex'));
    expect(adapter.name).toBe('Codex CLI');
    expect(adapter.provider).toBe('codex');
    expect(adapter.getWatchPaths()).toEqual([
      { type: 'directory', path: sessionsRoot(), recursive: true, filter: '.jsonl' },
    ]);
  });

  // The listing length pins four things at once: the mtime filter rejects DELTA
  // (8 minutes), the `rollout-`/`.jsonl` name filter rejects the three siblings
  // in GAMMA's day directory, and the top-3-year fan-out keeps all three base
  // years. That is why every other case writes and removes its own directories
  // in-body.
  it('lists in-window rollouts newest-first, with the full summary field set', async () => {
    const adapter = new CodexAdapter();
    const sessions = await sessionsOf(adapter, 5 * MINUTE);

    expect(sessions).toHaveLength(3);
    expect(sessions.map((s: any) => s.sessionId)).toEqual([EPSILON_ID, ALPHA_ID, GAMMA_ID]);
    expect(sessions.some((s: any) => s.sessionId === DELTA_ID)).toBe(false);

    expect(sessions[1]).toEqual({
      // Derived from the FILE NAME, not from session_meta's payload.id.
      sessionId: ALPHA_ID,
      provider: 'codex',
      agentId: null,
      agentType: 'main',
      model: 'gpt-5-codex',
      status: 'active',
      lastActivity: alphaMtime,
      project: workspaceAlpha,
      lastMessage: 'alpha done',
      lastTool: 'shell',
      lastToolInput: '{"command":["ls","-la"]}',
      parentSessionId: null,
      filePath: alphaFile,
    });

    // Pin the id derivation itself rather than trusting the constant: the
    // adapter has to strip `rollout-` and `.jsonl` and prepend `codex-`.
    expect(sessionIdOf(ALPHA_FILE)).toBe(sessions[1].sessionId);
    expect(sessions[1].sessionId).not.toContain('a-different-payload-id');

    // EPSILON's row: the newest entry that carries a tool is the function_call,
    // and parseRollout walks backwards with a `!detail.lastTool` guard
    // (codex.ts:70), so only the LAST tool-bearing entry is ever recorded.
    expect(sessions[0]).toMatchObject({
      sessionId: EPSILON_ID,
      model: 'gpt-5-codex',
      project: workspaceEpsilon,
      lastTool: 'apply_patch',
      lastToolInput: '{"input":"*** Begin Patch"}',
      lastMessage: 'epsilon done',
      lastActivity: epsilonMtime,
    });
  });

  it('falls back to model "codex" when no entry names one', async () => {
    const adapter = new CodexAdapter();
    const sessions = await sessionsOf(adapter, 5 * MINUTE);
    const gamma = sessions.find((s: any) => s.sessionId === GAMMA_ID);

    // Neither session_meta.payload.model, turn_context.payload.model nor
    // event_msg.payload.model appears anywhere in GAMMA's file, so
    // codex.ts:328's `detail.model || 'codex'` is what answers. project is
    // still read, from session_meta's payload.cwd (codex.ts:54).
    expect(gamma).toEqual({
      sessionId: GAMMA_ID,
      provider: 'codex',
      agentId: null,
      agentType: 'main',
      model: 'codex',
      status: 'active',
      lastActivity: gammaMtime,
      project: workspaceGamma,
      lastMessage: 'gamma done',
      // No tool-bearing entry at all, so these two stay null rather than ''.
      lastTool: null,
      lastToolInput: null,
      parentSessionId: null,
      filePath: gammaFile,
    });
  });

  // codex.ts:189 captures `now` once; codex.ts:229 drops anything older than the
  // supplied threshold. A 40-minute-old rollout against 45- and 35-minute
  // windows straddles the comparison with five minutes of margin on each side,
  // and sits far enough from the base fixtures' 1–8 minute ages that their
  // membership does not depend on how long this file has been running.
  it('filters rollouts by mtime against the supplied threshold', async () => {
    const adapter = new CodexAdapter();
    const stale = rollout('2026', '03', '01', 'stale1', [
      sessionMeta('stale1', path.join(tmpHome, 'workspace', 'stale')),
      assistantMessage('stale output', 1),
    ]);
    backdate(stale, 40 * MINUTE);

    try {
      const wide = await sessionsOf(adapter, 45 * MINUTE);
      expect(wide.map((s: any) => s.sessionId)).toContain(sessionIdOf('rollout-stale1.jsonl'));
      // The four base fixtures stay in at both widths — 45 and 35 minutes are
      // far outside their 1–8 minute ages.
      for (const id of [ALPHA_ID, DELTA_ID, EPSILON_ID, GAMMA_ID]) {
        expect(wide.map((s: any) => s.sessionId)).toContain(id);
      }

      const narrow = await sessionsOf(adapter, 35 * MINUTE);
      expect(narrow.map((s: any) => s.sessionId)).not.toContain(sessionIdOf('rollout-stale1.jsonl'));
      for (const id of [ALPHA_ID, DELTA_ID, EPSILON_ID, GAMMA_ID]) {
        expect(narrow.map((s: any) => s.sessionId)).toContain(id);
      }
    } finally {
      removeMonth('2026', '03');
    }
  });

  // codex.ts:193-198 sorts the year directories newest-first and keeps 3.
  // Three base years exist, so a fourth, NEWER one pushes the oldest (ALPHA,
  // 2024) out of the fan-out entirely — its mtime is irrelevant at that point.
  // Uses the 30-minute window so all four base fixtures are inside it and only
  // the year fan-out is under test.
  it('scans at most the 3 newest year directories', async () => {
    const adapter = new CodexAdapter();
    expect((await sessionsOf(adapter, 30 * MINUTE)).map((s: any) => s.sessionId)).toContain(ALPHA_ID);

    rollout('2027', '01', '01', 'yr2027', [
      sessionMeta('yr2027', path.join(tmpHome, 'workspace', 'yr2027')),
      assistantMessage('from 2027', 1),
    ]);

    try {
      const ids = (await sessionsOf(adapter, 30 * MINUTE)).map((s: any) => s.sessionId);
      expect(ids).toContain(sessionIdOf('rollout-yr2027.jsonl'));
      expect(ids).not.toContain(ALPHA_ID);
      expect(ids).toContain(DELTA_ID);
      expect(ids).toContain(EPSILON_ID);
      expect(ids).toContain(GAMMA_ID);
    } finally {
      removeYear('2027');
    }
  });

  // codex.ts:203-208 sorts the month directories newest-first and keeps 6. 2026
  // has one base month (01, holding GAMMA); adding 02–07 makes seven, so 01 is
  // the one that falls off.
  it('scans at most the 6 newest month directories', async () => {
    const adapter = new CodexAdapter();
    expect((await sessionsOf(adapter, 5 * MINUTE)).map((s: any) => s.sessionId)).toContain(GAMMA_ID);

    const added = ['02', '03', '04', '05', '06', '07'].map((month) => ({
      month,
      id: sessionIdOf(`rollout-mon${month}.jsonl`),
      file: rollout('2026', month, '01', `mon${month}`, [
        sessionMeta(`mon${month}`, path.join(tmpHome, 'workspace', `mon${month}`)),
        assistantMessage(`from month ${month}`, 1),
      ]),
    }));

    try {
      const ids = (await sessionsOf(adapter, 5 * MINUTE)).map((s: any) => s.sessionId);
      for (const { id } of added) expect(ids).toContain(id);
      expect(ids).not.toContain(GAMMA_ID);
    } finally {
      for (const { month } of added) removeMonth('2026', month);
    }
  });

  // codex.ts:213-218 sorts the day directories newest-first and keeps 14.
  // Fifteen day directories in one month means the numerically smallest is
  // dropped, whatever its mtime.
  it('scans at most the 14 newest day directories', async () => {
    const adapter = new CodexAdapter();
    const days = Array.from({ length: 15 }, (_, i) => String(i + 1).padStart(2, '0'));
    const written = days.map((day) => ({
      day,
      id: sessionIdOf(`rollout-day${day}.jsonl`),
      file: rollout('2026', '04', day, `day${day}`, [
        sessionMeta(`day${day}`, path.join(tmpHome, 'workspace', `day${day}`)),
        assistantMessage(`from day ${day}`, 1),
      ]),
    }));

    try {
      const ids = (await sessionsOf(adapter, 5 * MINUTE)).map((s: any) => s.sessionId);
      for (const { id } of written.filter(({ day }) => day !== '01')) {
        expect(ids).toContain(id);
      }
      // Day 01 sorts last and falls outside the 14-day fan-out.
      expect(ids).not.toContain(written[0].id);
    } finally {
      removeMonth('2026', '04');
    }
  });

  // codex.ts:49 reads the first 5 lines for `session_meta` and BREAKS on the
  // first one it finds, so a session_meta past that window is invisible to the
  // row — even though the tail window does see the line.
  it('reads session_meta only from the first 5 lines', async () => {
    const adapter = new CodexAdapter();
    rollout('2026', '05', '01', 'latemeta1', [
      ...filler(4, 0),
      functionCall('kept_shell', '{}', 4),
      sessionMeta('late1', path.join(tmpHome, 'workspace', 'latemeta')),
      assistantMessage('late output', 6),
    ]);

    try {
      const row = (await sessionsOf(adapter, 5 * MINUTE)).find(
        (s: any) => s.sessionId === sessionIdOf('rollout-latemeta1.jsonl'),
      );
      expect(row).toMatchObject({
        // model falls back because the head window never saw session_meta, and
        // the tail loop only reads model from turn_context / event_msg
        // (codex.ts:91-96), neither of which appears here.
        model: 'codex',
        // project is null, not the workspace: `payload.cwd` is only read from
        // session_meta (codex.ts:54).
        project: null,
        // Both of these come from the tail window and are unaffected.
        lastTool: 'kept_shell',
        lastToolInput: '{}',
        lastMessage: 'late output',
      });
    } finally {
      removeMonth('2026', '05');
    }
  });

  // parseRollout's row reads a 50-line tail (codex.ts:60) — NARROWER than both
  // getToolHistory's 100 (codex.ts:108) and getRecentMessages' 60
  // (codex.ts:143). 67 lines with the function_call at index 5 and the message
  // at index 56 puts the call outside all three windows and the message inside
  // the 60- and 50-line ones, so a null `lastTool` here is the WINDOW and not a
  // missing tool: getToolHistory still returns it.
  it('reads the session row from a 50-line tail, narrower than the detail readers', async () => {
    const adapter = new CodexAdapter();
    const file = rollout('2026', '06', '01', 'tail1', [
      sessionMeta('tail1', path.join(tmpHome, 'workspace', 'tail')),
      ...filler(4, 0),
      functionCall('buried_shell', '{}', 5),
      ...filler(50, 100),
      assistantMessage('surfaced msg', 56),
      ...filler(10, 200),
    ]);

    try {
      const row = (await sessionsOf(adapter, 5 * MINUTE)).find(
        (s: any) => s.sessionId === sessionIdOf('rollout-tail1.jsonl'),
      );
      expect(row).toMatchObject({
        lastTool: null,
        lastToolInput: null,
        lastMessage: 'surfaced msg',
      });

      const detail = await adapter.getSessionDetail(sessionIdOf('rollout-tail1.jsonl'), null, file);
      expect(detail.toolHistory).toEqual([{ tool: 'buried_shell', detail: '{}', ts: tsOf(5) }]);
      expect(detail.messages).toEqual([{ role: 'assistant', text: 'surfaced msg', ts: tsOf(56) }]);
    } finally {
      removeMonth('2026', '06');
    }
  });

  // The other three line windows, each proved by pushing the interesting entry
  // just outside the reader's own count. Each padded file is paired with a short
  // control carrying the SAME interesting entries, so an empty result cannot be
  // confused with "this file has no tool / message / usage at all".
  it('bounds each detail reader by its own line window', async () => {
    const adapter = new CodexAdapter();

    // getToolHistory: count 100. The call is at index 1 of 102 lines.
    const toolFile = rollout('2026', '07', '01', 'wintool1', [
      sessionMeta('wintool1', path.join(tmpHome, 'workspace', 'win')),
      functionCall('hidden_shell', '{}', 1),
      ...filler(100, 0),
    ]);

    // getRecentMessages: count 60. The message is at index 1 of 72 lines.
    const msgFile = rollout('2026', '07', '02', 'winmsg1', [
      sessionMeta('winmsg1', path.join(tmpHome, 'workspace', 'win')),
      assistantMessage('hidden msg', 1),
      ...filler(70, 0),
    ]);

    // getTokenUsage: count 300. Both readings sit at indices 1 and 2 of 314.
    const usagePayload = [
      threadUsage({ input_tokens: 7000, output_tokens: 700 }),
      totalUsage(999, 99),
    ];
    const paddedUsageFile = rollout('2026', '07', '03', 'winusage1', [
      sessionMeta('winusage1', path.join(tmpHome, 'workspace', 'win')),
      ...usagePayload,
      ...filler(310, 0),
    ]);
    const controlUsageFile = rollout('2026', '07', '04', 'winusage2', [
      sessionMeta('winusage2', path.join(tmpHome, 'workspace', 'win')),
      ...usagePayload,
    ]);

    try {
      expect((await adapter.getSessionDetail('codex-wintool1', null, toolFile)).toolHistory).toEqual([]);
      expect((await adapter.getSessionDetail('codex-winmsg1', null, msgFile)).messages).toEqual([]);
      expect((await adapter.getSessionDetail('codex-winusage1', null, paddedUsageFile)).tokenUsage).toBeNull();
      // Control: unpadded, the same readings resolve — so `null` above is the
      // 300-line window, not an absent reading.
      expect((await adapter.getSessionDetail('codex-winusage2', null, controlUsageFile)).tokenUsage).toEqual({
        input: 7000,
        output: 700,
      });
    } finally {
      removeMonth('2026', '07');
    }
  });

  // The four truncation sites, all four of them distinct: parseRollout's
  // `lastToolInput` at 60 (codex.ts:75), its `lastMessage` at 80
  // (codex.ts:86), getToolHistory's `detail` at 80 (codex.ts:120) and
  // getRecentMessages' `text` at 200 (codex.ts:170). The same over-long payloads
  // feed the two 60/80 tool caps so that LENGTH, not just the prefix, tells them
  // apart — a 60-char prefix is itself a prefix of the 80-char result.
  //
  // The string-argument call is written FIRST, not last: parseRollout walks its
  // tail window FORWARD (see the maxItems case below), so the row's 60-char cap
  // lands on whichever call comes first in the file.
  it('caps payloads at 60/80/200 chars', async () => {
    expect(LONG_ARGS_JSON).toHaveLength(108);

    const adapter = new CodexAdapter();
    const file = rollout('2026', '08', '01', 'zeta1', [
      sessionMeta('zeta1', path.join(tmpHome, 'workspace', 'zeta'), { model: 'gpt-5-codex' }),
      // String arguments — the first tool in the window, so this is the call the
      // row records (codex.ts:72-74).
      functionCall('shell', LONG_STRING_ARGS, 1),
      // Object arguments: the JSON.stringify branch (codex.ts:74).
      functionCall('read_file', LONG_ARGS, 2),
      assistantMessage(LONG_TEXT, 3),
    ]);

    try {
      const row = (await sessionsOf(adapter, 5 * MINUTE)).find(
        (s: any) => s.sessionId === sessionIdOf('rollout-zeta1.jsonl'),
      );
      expect(row).toMatchObject({ model: 'gpt-5-codex', lastTool: 'shell' });
      // codex.ts:75 — the row's tool input, capped at 60.
      expect(row.lastToolInput).toBe('s'.repeat(60));
      expect(row.lastToolInput).toHaveLength(60);
      // codex.ts:86 — the row's message, capped at 80.
      expect(row.lastMessage).toBe('z'.repeat(80));
      expect(row.lastMessage).toHaveLength(80);

      const detail = await adapter.getSessionDetail(row.sessionId, null, file);
      expect(detail.toolHistory).toEqual([
        // codex.ts:120 — the same 100-char string, capped at 80 rather than 60.
        { tool: 'shell', detail: 's'.repeat(80), ts: tsOf(1) },
        // codex.ts:120 again, for the JSON-stringified object: 108 chars in, 80
        // out, from the same payload shape the row's cap saw.
        {
          tool: 'read_file',
          detail: '{"path":"' + 'p'.repeat(30) + '","q":"' + 'q'.repeat(34),
          ts: tsOf(2),
        },
      ]);
      expect(detail.toolHistory[1].detail).toHaveLength(80);
      // codex.ts:170 — the same over-long text keeps 200 chars in the detail even
      // though the row kept only 80.
      expect(detail.messages).toEqual([{ role: 'assistant', text: 'z'.repeat(200), ts: tsOf(3) }]);
    } finally {
      removeMonth('2026', '08');
    }
  });

  // getToolHistory's maxItems default is 15 (codex.ts:105) and
  // getRecentMessages' is 5 (codex.ts:140), both applied as `slice(-maxItems)`
  // over a FORWARD walk — so the OLDEST entries are the ones dropped and the
  // surviving order is file order, not reverse. The happy-path fixtures above
  // carry at most one tool and one message, so they cannot observe either.
  //
  // This is also the only fixture that pins the direction of parseRollout's own
  // walk, and the direction is the opposite of what the field names suggest.
  // `detail.lastTool` / `detail.lastMessage` / `detail.lastToolInput` are filled
  // by a `!detail.lastTool` / `!detail.lastMessage` guard inside a loop over
  // `entries` IN FILE ORDER (codex.ts:63), so the FIRST tool-bearing and FIRST
  // text-bearing entry of the tail window win — not the last, and not the
  // newest. Only the WINDOW is the tail (codex.ts:60).
  //
  // A conversion that reached for `foldJsonl` with `reverse: true` here — the
  // natural reading of "lastTool" — would answer tool_19 / msg 8 and change every
  // session row in the UI. Every other fixture in this file carries at most one
  // tool and one message per file, so all of them pass either way.
  it('keeps the LAST 15 tools and 5 messages in the detail, but the FIRST of each in the row', async () => {
    const adapter = new CodexAdapter();
    const entries: unknown[] = [sessionMeta('eta1', path.join(tmpHome, 'workspace', 'eta'), { model: 'gpt-5-codex' })];
    for (let i = 0; i < 20; i++) {
      entries.push(functionCall(`tool_${String(i).padStart(2, '0')}`, { n: i }, 10 + i));
    }
    for (let i = 1; i <= 8; i++) {
      entries.push(assistantMessage(`msg ${i}`, 40 + i));
    }
    const file = rollout('2026', '09', '01', 'eta1', entries);

    try {
      const row = (await sessionsOf(adapter, 5 * MINUTE)).find(
        (s: any) => s.sessionId === sessionIdOf('rollout-eta1.jsonl'),
      );
      // First-in-window, not last: tool_00 / msg 1, not tool_19 / msg 8.
      expect(row).toMatchObject({ lastTool: 'tool_00', lastToolInput: '{"n":0}', lastMessage: 'msg 1' });

      const detail = await adapter.getSessionDetail(row.sessionId, null, file);
      expect(detail.toolHistory).toHaveLength(15);
      expect(detail.toolHistory.map((t: any) => t.tool)).toEqual(
        Array.from({ length: 15 }, (_, i) => `tool_${String(i + 5).padStart(2, '0')}`),
      );
      expect(detail.toolHistory[0].detail).toBe('{"n":5}');
      expect(detail.toolHistory[14]).toEqual({ tool: 'tool_19', detail: '{"n":19}', ts: tsOf(29) });

      expect(detail.messages).toHaveLength(5);
      expect(detail.messages.map((m: any) => m.text)).toEqual(['msg 4', 'msg 5', 'msg 6', 'msg 7', 'msg 8']);
      // No usage entry anywhere in this file.
      expect(detail.tokenUsage).toBeNull();
    } finally {
      removeMonth('2026', '09');
    }
  });

  // Both tool-bearing shapes codex recognises, plus the two fallbacks around
  // them: `payload.name || payload.type` (codex.ts:71, codex.ts:125) and the
  // arguments-before-command precedence in the detail builder
  // (codex.ts:72-78, codex.ts:117-123). The happy-path fixtures above only ever
  // write `function_call` with a `name` and a string `arguments`, so without this
  // case none of those four branches are observable.
  //
  // The first `command_execution` is also the one the row records (first tool in
  // the window), and it carries only `command` — so its 60-char cap comes from
  // the command branch while its 80-char detail comes from the same string.
  it('reads command_execution entries, and falls back to the payload type as the tool name', async () => {
    const adapter = new CodexAdapter();
    const file = rollout('2026', '12', '01', 'cmdexec1', [
      sessionMeta('cmdexec1', path.join(tmpHome, 'workspace', 'cmd'), { model: 'gpt-5-codex' }),
      // No `name`: codex.ts:71 falls back to the payload type. Only `command`,
      // so codex.ts:77 supplies the input.
      { type: 'response_item', payload: { type: 'command_execution', command: 'c'.repeat(100) }, timestamp: at(1) },
      // `arguments` wins over `command` when both are present
      // (codex.ts:72 takes the first branch), so `command` is never read here.
      { type: 'response_item', payload: { type: 'command_execution', command: 'short cmd', arguments: { cmd: 'ignored' } }, timestamp: at(2) },
      // Neither `name` nor `arguments`: the tool name falls back to the payload
      // type and the detail stays ''.
      { type: 'response_item', payload: { type: 'function_call' }, timestamp: at(3) },
    ]);

    try {
      const row = (await sessionsOf(adapter, 5 * MINUTE)).find(
        (s: any) => s.sessionId === sessionIdOf('rollout-cmdexec1.jsonl'),
      );
      expect(row).toMatchObject({ lastTool: 'command_execution' });
      // codex.ts:77 — the command branch of the 60-char cap.
      expect(row.lastToolInput).toBe('c'.repeat(60));
      expect(row.lastToolInput).toHaveLength(60);

      const detail = await adapter.getSessionDetail(row.sessionId, null, file);
      expect(detail.toolHistory).toEqual([
        { tool: 'command_execution', detail: 'c'.repeat(80), ts: tsOf(1) },
        { tool: 'command_execution', detail: '{"cmd":"ignored"}', ts: tsOf(2) },
        { tool: 'function_call', detail: '', ts: tsOf(3) },
      ]);
      expect(detail.messages).toEqual([]);
      expect(detail.tokenUsage).toBeNull();
    } finally {
      removeMonth('2026', '12');
    }
  });

  // Two shapes every other fixture here avoids: entries with no `timestamp`, and a
  // rollout file that is completely empty. Both are ordinary in practice — a
  // rollout killed mid-write leaves an empty file, and not every codex entry
  // carries a top-level timestamp.
  it('defaults a missing timestamp to 0, and reads a zero-byte rollout as empty', async () => {
    const adapter = new CodexAdapter();
    const noTimestamps = rollout('2026', '02', '01', 'nots1', [
      sessionMeta('nots1', path.join(tmpHome, 'workspace', 'nots'), { model: 'gpt-5-codex' }),
      { type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: '{}' } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'no timestamp' }] } },
    ]);
    const blankPath = path.join(sessionsRoot(), '2026', '02', '02', 'rollout-blank1.jsonl');
    fs.mkdirSync(path.dirname(blankPath), { recursive: true });
    fs.writeFileSync(blankPath, '');

    try {
      const ids = (await sessionsOf(adapter, 5 * MINUTE)).map((s: any) => s.sessionId);
      expect(ids).toContain(sessionIdOf('rollout-nots1.jsonl'));
      expect(ids).toContain(sessionIdOf('rollout-blank1.jsonl'));

      const nots = await adapter.getSessionDetail('codex-nots1', null, noTimestamps);
      // codex.ts:127 and codex.ts:171 both fall back to ts 0.
      expect(nots.toolHistory).toEqual([{ tool: 'shell', detail: '{}', ts: 0 }]);
      expect(nots.messages).toEqual([{ role: 'assistant', text: 'no timestamp', ts: 0 }]);

      const blank = await adapter.getSessionDetail('codex-blank1', null, blankPath);
      // readLines short-circuits on `stat.size === 0` (jsonl-utils.ts:32), so
      // every reader sees an empty entry list — not an error.
      expect(blank.toolHistory).toEqual([]);
      expect(blank.messages).toEqual([]);
      expect(blank.tokenUsage).toBeNull();

      const blankRow = (await sessionsOf(adapter, 5 * MINUTE)).find(
        (s: any) => s.sessionId === sessionIdOf('rollout-blank1.jsonl'),
      );
      // Still LISTED — the mtime filter is the only gate, and there is no
      // minimum-size check anywhere in scanRecentRollouts.
      expect(blankRow).toEqual({
        sessionId: sessionIdOf('rollout-blank1.jsonl'),
        provider: 'codex',
        agentId: null,
        agentType: 'main',
        model: 'codex',
        status: 'active',
        lastActivity: expect.any(Number),
        project: null,
        lastMessage: null,
        lastTool: null,
        lastToolInput: null,
        parentSessionId: null,
        filePath: blankPath,
      });
    } finally {
      removeMonth('2026', '02');
    }
  });

  // ─── The token fold ──────────────────────────────────────
  //
  // codex.ts:278 walks the window NEWEST-FIRST (`for (let i = entries.length - 1;
  // i >= 0; i--)`) and returns the FIRST `thread_token_usage` it meets. A
  // `total_token_usage` met on the way is remembered as `fallback` but does NOT
  // stop the walk. `foldJsonl` reaches this with `reverse: true` plus `until`,
  // and a conversion that forgets either one answers differently on every real
  // rollout, because the thread reading is always older than the totals after it.

  it('reads a thread_token_usage entry even when a newer total_token_usage precedes it', async () => {
    const adapter = new CodexAdapter();
    const sessions = await sessionsOf(adapter, 5 * MINUTE);
    const row = sessions.find((s: any) => s.sessionId === EPSILON_ID);
    expect(row).toBeDefined();

    const detail = await adapter.getSessionDetail(EPSILON_ID, workspaceEpsilon, row.filePath);
    // Walking newest-first in EPSILON's file:
    //   4 event_msg total_token_usage 999/99  → remembered as fallback
    //   3 response_item message            → nothing
    //   2 response_item function_call      → nothing
    //   1 token_usage_record thread 7000/700 → RETURNED, fallback discarded
    //   0 session_meta                     → never reached
    expect(detail.tokenUsage).toEqual({ input: 7000, output: 700 });
    expect(detail.sessionId).toBe(EPSILON_ID);
    expect(detail.toolHistory).toEqual([
      { tool: 'apply_patch', detail: '{"input":"*** Begin Patch"}', ts: tsOf(1) },
    ]);
    expect(detail.messages).toEqual([{ role: 'assistant', text: 'epsilon done', ts: tsOf(2) }]);
  });

  // The mirror case: with no thread reading at all the walk runs to the start of
  // the file and returns the fallback. ALPHA carries two totals, so which one
  // survives pins the direction of the walk: the LAST in file order wins, i.e.
  // the FIRST one met walking newest-first.
  it('falls back to the LAST info.total_token_usage when no thread reading exists', async () => {
    const adapter = new CodexAdapter();
    const sessions = await sessionsOf(adapter, 5 * MINUTE);
    const row = sessions.find((s: any) => s.sessionId === ALPHA_ID);
    expect(row).toBeDefined();

    const detail = await adapter.getSessionDetail(ALPHA_ID, workspaceAlpha, row.filePath);
    expect(detail.tokenUsage).toEqual({ input: 222, output: 22 });
  });

  it('reports null tokenUsage when the rollout carries neither reading', async () => {
    const adapter = new CodexAdapter();
    const sessions = await sessionsOf(adapter, 5 * MINUTE);
    const row = sessions.find((s: any) => s.sessionId === GAMMA_ID);
    expect(row).toBeDefined();

    const detail = await adapter.getSessionDetail(GAMMA_ID, workspaceGamma, row.filePath);
    // `fallback` stays null and codex.ts:299 returns it directly — not
    // { input: 0, output: 0 }, which is what a fold with a different init would
    // hand back.
    expect(detail.tokenUsage).toBeNull();
    expect(detail.messages).toEqual([{ role: 'assistant', text: 'gamma done', ts: tsOf(1) }]);
  });

  // Two guards on the thread reading itself. `typeof input_tokens === 'number'`
  // (codex.ts:283) rejects a string-valued thread entry outright — it neither
  // wins nor short-circuits the walk, so the fallback below it is used instead;
  // and `Number(x || 0)` (codex.ts:285-286) defaults a missing output count.
  // A conversion that coerced with Number() or that stopped at the first
  // thread_token_usage of any shape answers { 7000, 700 } and { 42, 700 }
  // respectively.
  it('ignores a non-numeric thread reading and defaults a missing output count', async () => {
    const adapter = new CodexAdapter();
    const stringThread = rollout('2026', '10', '01', 'guard1', [
      sessionMeta('guard1', path.join(tmpHome, 'workspace', 'guard'), { model: 'gpt-5-codex' }),
      totalUsage(555, 55),
      threadUsage({ input_tokens: '7000', output_tokens: '700' }),
    ]);
    const noOutput = rollout('2026', '10', '02', 'guard2', [
      sessionMeta('guard2', path.join(tmpHome, 'workspace', 'guard'), { model: 'gpt-5-codex' }),
      threadUsage({ input_tokens: 42 }),
    ]);

    try {
      expect((await adapter.getSessionDetail('codex-guard1', null, stringThread)).tokenUsage).toEqual({
        input: 555,
        output: 55,
      });
      expect((await adapter.getSessionDetail('codex-guard2', null, noOutput)).tokenUsage).toEqual({
        input: 42,
        output: 0,
      });
    } finally {
      removeMonth('2026', '10');
    }
  });

  // getRecentMessages' content matrix (codex.ts:151-167): a plain string, a
  // `text` block and an `input_text` block are all read; `<environment_context>`
  // input is skipped; a whitespace-only message is dropped; and a missing role
  // defaults to 'assistant'. codex.ts deliberately does NOT route this through
  // text-utils' extractText, which handles none of the last three.
  it('reads string, text and input_text content, and skips environment context', async () => {
    const adapter = new CodexAdapter();
    const file = rollout('2026', '11', '01', 'theta1', [
      sessionMeta('theta1', path.join(tmpHome, 'workspace', 'theta'), { model: 'gpt-5-codex' }),
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'ask something' }] }, timestamp: at(1) },
      // No role: codex.ts:151 defaults it.
      { type: 'response_item', payload: { type: 'message', content: [{ type: 'output_text', text: 'no role here' }] }, timestamp: at(2) },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>ignore me</environment_context>' }] }, timestamp: at(3) },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: 'plain string content' }, timestamp: at(4) },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'text block kind' }] }, timestamp: at(5) },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '   ' }] }, timestamp: at(6) },
      // Newest, and the only entry whose text is an `input_text` block.
      // getRecentMessages reads it (codex.ts:161) but parseRollout's extractText
      // does not (text-utils.ts:15), so it cannot become the row's lastMessage.
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'input_text', text: 'input text only' }] }, timestamp: at(7) },
    ]);

    try {
      const detail = await adapter.getSessionDetail('codex-theta1', null, file);
      expect(detail.messages).toEqual([
        { role: 'user', text: 'ask something', ts: tsOf(1) },
        { role: 'assistant', text: 'no role here', ts: tsOf(2) },
        { role: 'user', text: 'plain string content', ts: tsOf(4) },
        { role: 'assistant', text: 'text block kind', ts: tsOf(5) },
        { role: 'assistant', text: 'input text only', ts: tsOf(7) },
      ]);

      // parseRollout's own extractText handles `text` and `output_text` but not
      // `input_text`, so the row's lastMessage is the first assistant message
      // whose content extractText can read at all.
      const row = (await sessionsOf(adapter, 5 * MINUTE)).find(
        (s: any) => s.sessionId === sessionIdOf('rollout-theta1.jsonl'),
      );
      expect(row).toMatchObject({ lastMessage: 'text block kind' });
    } finally {
      removeMonth('2026', '11');
    }
  });

  // Two paths through getSessionDetail: the filePath short-circuit
  // (codex.ts:344) and the id-only rescan (codex.ts:354-367), which strips the
  // `codex-` prefix from the id and rescans with its own HARD-CODED 30-minute
  // window. DELTA is 8 minutes old — outside the 5-minute threshold the tests
  // above pass, inside the 30-minute one — so widening or dropping that constant
  // changes this result while leaving every other case in this file alone.
  it('resolves a session by id through its own 30-minute window', async () => {
    const adapter = new CodexAdapter();

    const fiveMinutes = (await sessionsOf(adapter, 5 * MINUTE)).map((s: any) => s.sessionId);
    expect(fiveMinutes).not.toContain(DELTA_ID);

    const viaId = await adapter.getSessionDetail(DELTA_ID, workspaceDelta);
    expect(viaId.sessionId).toBe(DELTA_ID);
    expect(viaId.tokenUsage).toEqual({ input: 333, output: 33 });
    expect(viaId.messages).toEqual([{ role: 'assistant', text: 'delta output', ts: tsOf(2) }]);
    expect(viaId.toolHistory).toEqual([]);

    // The filePath short-circuit returns the same detail without rescanning.
    const viaPath = await adapter.getSessionDetail(DELTA_ID, workspaceDelta, deltaFile);
    expect(viaPath.sessionId).toBe(DELTA_ID);
    expect(viaPath.tokenUsage).toEqual({ input: 333, output: 33 });

    // Widening the listing window picks DELTA up and pins its row.
    const thirtyMinutes = await sessionsOf(adapter, 30 * MINUTE);
    expect(thirtyMinutes.map((s: any) => s.sessionId)).toEqual([EPSILON_ID, ALPHA_ID, GAMMA_ID, DELTA_ID]);
    expect(thirtyMinutes[3]).toEqual({
      sessionId: DELTA_ID,
      provider: 'codex',
      agentId: null,
      agentType: 'main',
      model: 'codex',
      status: 'active',
      lastActivity: deltaMtime,
      project: workspaceDelta,
      lastMessage: 'delta output',
      lastTool: null,
      lastToolInput: null,
      parentSessionId: null,
      filePath: deltaFile,
    });
  });

  // codex.ts:369 returns a bare `{ toolHistory: [], messages: [] }` on the miss
  // path — no tokenUsage, no sessionId. As in copilot.fixture.test.ts, only the
  // interface guarantee is asserted: shared/types.ts documents that unknown
  // sessions resolve to empty arrays and that the optional fields "may
  // accompany them", and adapters/index.ts reads them through
  // `detailRaw?.tokenUsage ?? null`. Freezing today's two-key miss shape would
  // block a shared detail builder from returning all four fields.
  it('returns empty detail for unknown session ids', async () => {
    const adapter = new CodexAdapter();
    await expect(adapter.getSessionDetail('codex-no-such-rollout', workspaceAlpha)).resolves.toMatchObject({
      toolHistory: [],
      messages: [],
    });
    // The `codex-` strip is a tolerant `replace`, not a required-prefix parse:
    // an id that arrives WITHOUT the prefix still matches, because
    // `sessionId.replace('codex-', '')` (codex.ts:354) leaves it untouched and
    // the file id is the bare name either way. A conversion that turned this
    // into `slice('codex-'.length)` would silently stop resolving the un-prefixed
    // id, which is how a caller that has already stripped it would arrive.
    //
    // The returned `sessionId` is the caller's argument echoed back verbatim
    // (codex.ts:365), NOT the matched file's canonical id — so it does not
    // normalise the prefix away either.
    const unprefixed = await adapter.getSessionDetail(DELTA_ID.replace('codex-', ''), workspaceDelta);
    expect(unprefixed.sessionId).toBe('2025-01-22T10-30-00-delta1');
    expect(unprefixed.messages).toEqual([{ role: 'assistant', text: 'delta output', ts: tsOf(2) }]);
  });

  // The id-only rescan (codex.ts:354-367) matches on the derived file id alone
  // and never consults `project` — unlike pi, which requires the project
  // directory to line up too. Pinned here because codex has no per-project
  // directory to check: every rollout lives in one tree and carries its own cwd,
  // so the argument is genuinely redundant rather than a missed check. A
  // conversion that started enforcing it would break real callers, which pass
  // whichever `project` the row reported.
  it('ignores the project argument on the id-only lookup path', async () => {
    const adapter = new CodexAdapter();
    const wrongProject = await adapter.getSessionDetail(DELTA_ID, workspaceAlpha);
    expect(wrongProject.sessionId).toBe(DELTA_ID);
    expect(wrongProject.messages).toEqual([{ role: 'assistant', text: 'delta output', ts: tsOf(2) }]);
  });

  // ─── #144: a DIRECTORY whose NAME matches the session-file filter ───
  //
  // The day-level listing (codex.ts:220) is a BARE `readdir`, so its entries
  // arrive as `string[]` and the `rollout-*.jsonl` filter can ask about the NAME
  // and nothing else. A DIRECTORY named to match therefore passes, `stat`s
  // successfully (size 64, mtime now) and is emitted as a session row whose detail
  // is all null — `readLines` swallows the EISDIR (jsonl-utils.ts:57), so the
  // failure is silent. Drop the `isFile()` term at codex.ts:221 and this goes red.
  //
  // Note the YEAR/MONTH/DAY fan-out above it DOES filter `isDirectory()`
  // (codex.ts:191/201/211), which is what a stray `README.md` needs — so the
  // positional eviction the issue describes cannot reach this site. What is left
  // is the file-level name filter, and that is what this case pins.
  it('emits no session row for a directory named rollout-*.jsonl', async () => {
    await withTempCodexHome(async (Adapter, root) => {
      const workspace = path.join(root, 'workspace');
      fs.mkdirSync(workspace, { recursive: true });

      /** `writeRollout` is bound to the suite's `tmpHome`; this one is not. */
      const writeAt = (segments: string[], entries: unknown[]) => {
        const file = path.join(root, ...segments);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
        return file;
      };

      const real = writeAt(
        ['.codex', 'sessions', '2024', '01', '22', 'rollout-2024-01-22T10-30-00-real1.jsonl'],
        [sessionMeta('real1', workspace, { model: 'gpt-5-codex' }), assistantMessage('real done', 2)],
      );
      backdate(real, 2 * MINUTE);
      // The decoy: a DIRECTORY whose name satisfies both halves of the filter.
      const decoy = path.join(
        root, '.codex', 'sessions', '2024', '01', '22', 'rollout-2024-01-22T10-30-00-dirdecoy.jsonl',
      );
      fs.mkdirSync(decoy, { recursive: true });

      const rows = await sessionsOf(new Adapter(), 10 * MINUTE);
      // Nothing else exists in this tree, so the listing is an exact set.
      expect(rows.map((r: any) => r.sessionId)).toEqual(['codex-2024-01-22T10-30-00-real1']);
      // …and the decoy really is a directory, so the exact set above is the
      // `isFile()` guard rather than a missing fixture.
      expect(fs.statSync(decoy).isDirectory()).toBe(true);
    });
  });
});