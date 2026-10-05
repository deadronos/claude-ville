/**
 * Characterization test for the pi adapter.
 *
 * pi.test.ts is the same shape copilot.test.ts had before copilot.fixture.test.ts
 * existed: it redefines readLines/parseJsonLines/extractText/parseSession/
 * scanAllSessionFiles inline and asserts against those copies, so it would stay
 * green through an arbitrary rewrite of the shipped adapter. Its only assertion
 * that touches shipped code was a single happy-path `tokenUsage` sum, so when
 * this file was written no truncation cap, no maxItems slice, no mtime filter and
 * no `.jsonl` extension filter was pinned anywhere in the suite.
 *
 * That last sentence described the SUITE and has since gone stale — this file is
 * what closed the gaps, not pi.test.ts — so where each one is pinned now:
 *
 * | what | pinned by |
 * |---|---|
 * | all four truncation caps (60 / 80 / 200 / 80) | `caps payloads at 60/80/200 chars…` |
 * | both maxItems slices (15 tools, 5 messages) | same case |
 * | the mtime filter, including the comparison's SIGN | `backdate`, read by the 5- and 30-minute windows |
 * | the `.jsonl` extension filter | the exact length of the 5-minute listing, beside `notes.txt` and `alpha-1.jsonl.bak` |
 *
 * This file drives the SHIPPED PiAdapter against a synthetic
 * ~/.pi/agent/sessions/<projectDir>/*.jsonl tree so that a later conversion to
 * the shared pipeline helpers (collectJsonl / collectScanByMtime / foldJsonl)
 * can be verified as behaviour-preserving rather than merely asserted to be.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ROOT_CANNOT_BE_DENIED, detailOf, sessionsOf } from './fixtureHelpers';
import type { AgentSessionSummary } from '../../shared/types.js';
// Type-only, so it is erased at runtime and `vi.resetModules()` below still gets
// a fresh `pi.js`. Aliased because the file already has a `let PiAdapter: any`
// slot at module scope for the beforeAll import. `PiAdapter` is the shipped
// class, which is what makes `new Adapter().getActiveSessions(...)` answer the
// real union instead of `any`.
import type { PiAdapter as PiAdapterClass } from './pi.js';

let tmpHome = '';
let workspaceAlpha = '';
let workspaceDelta = '';
let workspaceBeta = '';
let alphaFile = '';
let deltaFile = '';
let betaFile = '';
let alphaMtime = 0;
let deltaMtime = 0;
let PiAdapter: any;
const originalHome = process.env.HOME;

// PROJ_ALPHA carries a `+` on purpose. buildSessionId runs BOTH halves through
// encodeURIComponent unconditionally (pi.ts:181), but every character a real pi
// project directory can contain — `-`, `_`, `.`, alphanumerics — is passed
// through unchanged, so identity and encodeURIComponent are indistinguishable on
// realistic input and the line would have no teeth. One escapable character
// makes the encoding observable. This also matters because
// getSessionDetail's id-only path (below) has to decode it back again.
const PROJ_ALPHA = '--Users-test-Github-alpha+app--';
const PROJ_DELTA = '--Users-test-Github-delta--';
const PROJ_BETA = '--Users-test-Github-beta--';

const ALPHA_ID = 'alpha-1';
const DELTA_ID = 'delta-1';
const BETA_ID = 'beta-1';

const sessionsRoot = () => path.join(tmpHome, '.pi', 'agent', 'sessions');
const sessionFile = (projectDir: string, fileName: string) => path.join(sessionsRoot(), projectDir, fileName);

// Encodes exactly like pi.ts's buildSessionId, so a change to that function has
// to break these constants rather than being re-derived by the test itself.
const sessionIdOf = (projectDir: string, fileName: string) =>
  `pi:${encodeURIComponent(projectDir)}:${encodeURIComponent(fileName.replace('.jsonl', ''))}`;

function writeSession(projectDir: string, fileName: string, entries: unknown[]) {
  const file = sessionFile(projectDir, fileName);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

// pi.ts:254 supplies the threshold; the comparison itself is the helper's
// `now - stat.mtimeMs > thresholdMs` (scan-utils.ts:90), with `now` captured
// once up front (scan-utils.ts:67). An offset of hours/days against a threshold
// of minutes leaves no boundary to race, while still pinning the comparison's
// sign: `mtimeMs - now > threshold` would admit the stale fixtures.
function backdate(file: string, msAgo: number) {
  const when = new Date(Date.now() - msAgo);
  fs.utimesSync(file, when, when);
  return fs.statSync(file).mtimeMs;
}

function removeProjectDir(projectDir: string) {
  fs.rmSync(path.join(sessionsRoot(), projectDir), { recursive: true, force: true });
}


/** `sessionFile`/`writeSession` against a THROWAWAY root instead of the suite's. */
const sessionsRootAt = (root: string) => path.join(root, '.pi', 'agent', 'sessions');

/**
 * Write one project directory's session file into a THROWAWAY root, with a fresh
 * mtime so no age threshold can filter it out. `writeSession` cannot be reused:
 * it resolves against the suite's own `tmpHome`, and these cases need a tree
 * nothing else in this file can see.
 */
function writeSessionIn(root: string, projectDir: string, fileName: string, entries: unknown[]): string {
  const file = path.join(sessionsRootAt(root), projectDir, fileName);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  const when = new Date();
  fs.utimesSync(file, when, when);
  return file;
}

/**
 * One minimal session file that resolves EVERY field: a `model_change` for the
 * model, a toolCall for the tool history, a text block for the message. An empty
 * detail would satisfy the same assertions as a fully-read one, so the loss of a
 * readable sibling has to be visible in the values themselves.
 */
function sessionEntries(cwd: string, id: string, text: string) {
  return [
    { type: 'session', version: 3, id, timestamp: at(0), cwd },
    { type: 'model_change', provider: 'anthropic', modelId: 'claude-sonnet-4', timestamp: at(1) },
    {
      type: 'message',
      timestamp: at(2),
      message: { role: 'assistant', content: [{ type: 'toolCall', name: 'bash', arguments: { command: 'ls' } }] },
    },
    { type: 'message', timestamp: at(3), message: { role: 'assistant', content: [{ type: 'text', text }] } },
  ];
}

/** `chmod` the directories — `0o000` to lock them, and back again to let the temp root be removed. */
function chmodDirectories(dirs: string[], mode: number) {
  for (const dir of dirs) fs.chmodSync(dir, mode);
}

/**
 * Runs `fn` against a THROWAWAY home directory with its own fresh module
 * instance, then restores HOME and leaves the suite's own adapter alone.
 * `SESSIONS_DIR` is derived from `os.homedir()` at module load (pi.ts:21-22), so
 * pointing HOME elsewhere and re-importing is what moves the tree. Cases that
 * build their own tree use this so that — with the suite running in shuffled order
 * and in parallel with the other adapters' fixtures — they cannot perturb the
 * shared fixture's exact-set assertions. Same re-import shape as
 * claude.fixture.test.ts's `withTempClaudeDir`.
 */
/**
 * `Array.prototype.find` answers `T | undefined`. The fixtures below want the
 * row or a loud failure — the same "assert rather than coerce" rule
 * `fixtureHelpers.ts` states for the union-returning adapter methods — so this
 * throws and names the ids it did find, rather than letting the next line read
 * a property off `undefined`.
 */
function sessionRow(rows: AgentSessionSummary[], sessionId: string): AgentSessionSummary {
  const row = rows.find((s) => s.sessionId === sessionId);
  if (!row) {
    throw new Error(`no row for ${sessionId}; found [${rows.map((r) => r.sessionId).join(', ')}]`);
  }
  return row;
}

async function withTempPiHome<T>(fn: (Adapter: typeof PiAdapterClass, root: string) => Promise<T>): Promise<T> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeville-pi-case-'));
  const prior = process.env.HOME;
  process.env.HOME = root;
  vi.resetModules();
  try {
    const { PiAdapter: Fresh } = await import('./pi.js');
    return await fn(Fresh, root);
  } finally {
    if (prior === undefined) delete process.env.HOME;
    else process.env.HOME = prior;
    vi.resetModules();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const at = (i: number) => new Date(Date.UTC(2024, 0, 1, 0, 0, i)).toISOString();

const MINUTE = 60 * 1000;
const ALPHA_AGE_MS = MINUTE;
const DELTA_AGE_MS = 8 * MINUTE;
const BETA_AGE_MS = 10 * 60 * MINUTE;

// Shared across the truncation and maxItems cases. JSON-stringifies to 108
// chars — longer than both the 60-char cap parseSession applies to
// lastToolInput (pi.ts:92) and the 80-char cap getToolHistory applies to a tool
// detail (pi.ts:133), so the exact prefix and its length pin which site
// produced the string. `z` padding is longer than lastMessage's 80-char cap
// (pi.ts:80) and getRecentMessages' 200-char cap (pi.ts:161).
const LONG_ARGS = { path: 'p'.repeat(30), q: 'q'.repeat(60) };
const LONG_ARGS_JSON = JSON.stringify(LONG_ARGS);
const LONG_TEXT = 'z'.repeat(260);

describe('PiAdapter fixtures', () => {
  beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeville-pi-'));
    workspaceAlpha = path.join(tmpHome, 'workspace', 'alpha');
    workspaceDelta = path.join(tmpHome, 'workspace', 'delta');
    workspaceBeta = path.join(tmpHome, 'workspace', 'beta');
    for (const dir of [workspaceAlpha, workspaceDelta, workspaceBeta]) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.mkdirSync(sessionsRoot(), { recursive: true });
    // A loose file at the top of the sessions root. pi.ts:251 hands
    // SESSIONS_DIR to the helper, which keeps only `d.isDirectory()` children
    // (scan-utils.ts:70), so this must not be read as a project dir — though
    // note that deleting that filter is NOT observable through the adapter:
    // readdir on a file raises ENOTDIR, which the per-child catch
    // (scan-utils.ts:76, logged as `scanAllSessionFiles resolve`) already
    // discards. The filter is defence in depth, not a behaviour with an
    // observable difference, so no assertion here can pin it.
    fs.writeFileSync(path.join(sessionsRoot(), 'README.md'), 'not a project dir\n');

    alphaFile = writeSession(PROJ_ALPHA, `${ALPHA_ID}.jsonl`, [
      { type: 'session', version: 3, id: ALPHA_ID, timestamp: at(0), cwd: workspaceAlpha },
      { type: 'model_change', provider: 'minimax', modelId: 'MiniMax-M2.7', timestamp: at(1) },
      {
        type: 'message',
        timestamp: at(1),
        message: { role: 'user', content: [{ type: 'text', text: 'please run the tests' }] },
      },
      {
        // No top-level timestamp: pi.ts:134 falls back to ts 0, and pi.ts:162
        // does the same for messages. The arguments are a STRING, not an
        // object, so this also pins the string branch of pi.ts:92/133 — handed
        // to JSON.stringify instead it would gain two quote characters and the
        // 80-char prefix would shift.
        type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall', name: 'read_file', arguments: 's'.repeat(100) }],
          usage: { input: 100, output: 20, cacheRead: 5, totalTokens: 125 },
        },
      },
      {
        type: 'message',
        timestamp: at(3),
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall', name: 'bash', arguments: { command: 'npm test' } }],
          usage: { input: 300, output: 80 },
        },
      },
      {
        // No `role`: pi.ts:160 defaults it to 'assistant'. Dropping that default
        // makes this entry's role `undefined`.
        type: 'message',
        timestamp: at(4),
        message: {
          content: [{ type: 'text', text: 'checking usage guards' }],
          usage: { input: '7', output: '9' },
        },
      },
      {
        type: 'message',
        timestamp: at(5),
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'all done' }],
          usage: { cacheRead: 3 },
        },
      },
    ]);
    // pi.ts:263 keeps only names ending in `.jsonl`. `alpha-1.jsonl.bak`
    // contains ".jsonl" but does not END with it, so an `includes` filter would
    // pick it up and produce a second session.
    fs.writeFileSync(path.join(path.dirname(alphaFile), `${ALPHA_ID}.jsonl.bak`), 'not jsonl\n');
    fs.writeFileSync(path.join(path.dirname(alphaFile), 'notes.txt'), 'ignored\n');
    alphaMtime = backdate(alphaFile, ALPHA_AGE_MS);

    // Straddles the two thresholds: outside getActiveSessions' 5-minute argument
    // below, inside the 30-minute window getSessionDetail hard-codes for its
    // own id-only scan (pi.ts:323). That second constant is otherwise invisible.
    // Deliberately carries no model_change and no message-level `model`, so its
    // summary resolves through pi.ts:298's `detail.model || 'unknown'` fallback.
    deltaFile = writeSession(PROJ_DELTA, `${DELTA_ID}.jsonl`, [
      { type: 'session', version: 3, id: DELTA_ID, timestamp: at(0), cwd: workspaceDelta },
      {
        type: 'message',
        timestamp: at(2),
        message: { role: 'assistant', content: [{ type: 'text', text: 'delta output' }] },
      },
    ]);
    deltaMtime = backdate(deltaFile, DELTA_AGE_MS);

    // No `message.usage` entries anywhere, so getTokenUsage's `found` flag stays
    // false and pi.ts:209 returns null rather than {input: 0, output: 0}.
    betaFile = writeSession(PROJ_BETA, `${BETA_ID}.jsonl`, [
      { type: 'session', version: 3, id: BETA_ID, timestamp: at(0), cwd: workspaceBeta },
      {
        type: 'message',
        timestamp: at(1),
        message: { role: 'assistant', content: [{ type: 'text', text: 'no usage here' }] },
      },
    ]);
    backdate(betaFile, BETA_AGE_MS);

    process.env.HOME = tmpHome;
    vi.resetModules();
    ({ PiAdapter } = await import('./pi.js'));
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
    const adapter = new PiAdapter();
    expect(adapter.isAvailable()).toBe(true);
    expect(adapter.homeDir).toBe(path.join(tmpHome, '.pi'));
    expect(adapter.getWatchPaths()).toEqual([
      {
        type: 'directory',
        path: sessionsRoot(),
        recursive: true,
        filter: '.jsonl',
      },
    ]);
  });

  // Only ALPHA is inside the 5-minute window, so this single length assertion
  // pins three things at once: the mtime filter rejects DELTA (8 min) and BETA
  // (10 h), the `.jsonl` extension filter rejects `notes.txt` and
  // `alpha-1.jsonl.bak`, and the top-level `isDirectory()` filter rejects
  // `README.md`. Every extra fixture directory would change this count, which is
  // why the maxItems case below writes and removes its own directory in-body.
  it('lists only in-window .jsonl sessions, with the full summary field set', async () => {
    const adapter = new PiAdapter();
    const sessions = await sessionsOf(adapter, 5 * MINUTE);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toEqual({
      sessionId: `pi:--Users-test-Github-alpha%2Bapp--:alpha-1`,
      provider: 'pi',
      agentId: null,
      displayName: null,
      agentType: 'main',
      model: 'MiniMax-M2.7',
      status: 'active',
      lastActivity: alphaMtime,
      project: workspaceAlpha,
      lastMessage: 'all done',
      lastTool: 'bash',
      lastToolInput: '{"command":"npm test"}',
      parentSessionId: null,
      filePath: alphaFile,
    });

    // The encoded sessionId above is what getSessionDetail decodes, so pin the
    // encoder itself rather than trusting the constant: only a real
    // encodeURIComponent turns `+` into `%2B`.
    expect(sessionIdOf(PROJ_ALPHA, `${ALPHA_ID}.jsonl`)).toBe(sessions[0].sessionId);
    expect(sessions.some((s: any) => s.sessionId === sessionIdOf(PROJ_DELTA, `${DELTA_ID}.jsonl`))).toBe(false);
    expect(sessions.some((s: any) => s.sessionId === sessionIdOf(PROJ_BETA, `${BETA_ID}.jsonl`))).toBe(false);
  });

  it('sums numeric usage only, and truncates tool details at 80 chars', async () => {
    const adapter = new PiAdapter();

    const detail = await detailOf(adapter, sessionIdOf(PROJ_ALPHA, `${ALPHA_ID}.jsonl`), workspaceAlpha, alphaFile);

    // pi.ts:197-206 — 100 + 300 in, 20 + 80 out. The string-valued and
    // cache-only entries contribute nothing.
    expect(detail.tokenUsage).toEqual({ input: 400, output: 100 });
    expect(detail.sessionId).toBe(sessionIdOf(PROJ_ALPHA, `${ALPHA_ID}.jsonl`));

    // Both toolCall blocks survive in file order; the string-argument one is
    // capped at 80 (pi.ts:133) and its missing timestamp becomes ts 0
    // (pi.ts:134).
    expect(detail.toolHistory).toEqual([
      { tool: 'read_file', detail: 's'.repeat(80), ts: 0 },
      { tool: 'bash', detail: '{"command":"npm test"}', ts: new Date(at(3)).getTime() },
    ]);

    // Text blocks only: the two toolCall-only messages yield no text
    // (extractText returns '' for them). No role on the middle entry defaults
    // to 'assistant' (pi.ts:160).
    expect(detail.messages).toEqual([
      { role: 'user', text: 'please run the tests', ts: new Date(at(1)).getTime() },
      { role: 'assistant', text: 'checking usage guards', ts: new Date(at(4)).getTime() },
      { role: 'assistant', text: 'all done', ts: new Date(at(5)).getTime() },
    ]);
  });

  // Two paths through getSessionDetail: the filePath short-circuit (pi.ts:314)
  // and the id-only rescan (pi.ts:323). The id-only path is also the only place
  // the encoded sessionId is decoded, so it is where the encoder above earns its
  // keep.
  it('round-trips the encoded sessionId when resolving without a filePath', async () => {
    const adapter = new PiAdapter();
    const sessionId = sessionIdOf(PROJ_ALPHA, `${ALPHA_ID}.jsonl`);

    const viaId = await detailOf(adapter, sessionId, workspaceAlpha);
    expect(viaId.sessionId).toBe(sessionId);
    expect(viaId.tokenUsage).toEqual({ input: 400, output: 100 });
    expect(viaId.toolHistory).toHaveLength(2);
    expect(viaId.messages).toHaveLength(3);

    // A wrong id in an EXISTING project dir must not match on fileId alone.
    // pi.ts:328-331 requires both the file id and the project dir to line up.
    await expect(detailOf(adapter, sessionIdOf(PROJ_BETA, `${ALPHA_ID}.jsonl`), workspaceBeta)).resolves.toMatchObject({
      toolHistory: [],
      messages: [],
    });
  });

  it('reports null tokenUsage when no entry carries usage', async () => {
    const adapter = new PiAdapter();
    const sessionId = sessionIdOf(PROJ_BETA, `${BETA_ID}.jsonl`);

    const viaPath = await detailOf(adapter, sessionId, workspaceBeta, betaFile);
    expect(viaPath.tokenUsage).toBeNull();
    expect(viaPath.messages).toEqual([
      { role: 'assistant', text: 'no usage here', ts: new Date(at(1)).getTime() },
    ]);

    // BETA is 10 hours old, so getSessionDetail's own 30-minute scan
    // (pi.ts:323) cannot find it and the id-only lookup misses.
    await expect(detailOf(adapter, sessionId, workspaceBeta)).resolves.toMatchObject({
      toolHistory: [],
      messages: [],
    });
  });

  // The 30-minute window is pinned by DELTA, which is 8 minutes old: excluded by
  // the 5-minute getActiveSessions argument, included by getSessionDetail's
  // hard-coded one. Widening or dropping that constant changes these results.
  //
  // This is also the only case that widens the activity window, which is what
  // makes it the place two behaviours become observable: pi.ts:298's
  // `model || 'unknown'` fallback (DELTA names no model) and pi.ts:310's
  // lastActivity-descending sort (ALPHA is newer than DELTA). ALPHA is written
  // in beforeAll and never removed, so this stays order-independent.
  it("uses a 30-minute activity window for getSessionDetail's own scan", async () => {
    const adapter = new PiAdapter();
    const sessionId = sessionIdOf(PROJ_DELTA, `${DELTA_ID}.jsonl`);

    const narrow = await sessionsOf(adapter, 5 * MINUTE);
    expect(narrow.map((s: any) => s.sessionId)).toEqual([sessionIdOf(PROJ_ALPHA, `${ALPHA_ID}.jsonl`)]);

    const sessions = await sessionsOf(adapter, 30 * MINUTE);
    expect(sessions.map((s: any) => s.sessionId)).toEqual([
      sessionIdOf(PROJ_ALPHA, `${ALPHA_ID}.jsonl`),
      sessionIdOf(PROJ_DELTA, `${DELTA_ID}.jsonl`),
    ]);
    expect(sessions[1]).toEqual({
      sessionId,
      provider: 'pi',
      agentId: null,
      displayName: null,
      agentType: 'main',
      model: 'unknown',
      status: 'active',
      lastActivity: deltaMtime,
      project: workspaceDelta,
      lastMessage: 'delta output',
      lastTool: null,
      lastToolInput: null,
      parentSessionId: null,
      filePath: deltaFile,
    });

    const viaId = await detailOf(adapter, sessionId, workspaceDelta);
    expect(viaId.sessionId).toBe(sessionId);
    expect(viaId.messages).toEqual([
      { role: 'assistant', text: 'delta output', ts: new Date(at(2)).getTime() },
    ]);
  });

  // The happy-path fixtures keep every payload short and every collection small,
  // so they cannot distinguish pi.ts's four truncation sites, observe either
  // maxItems slice, or check which end of the collection survives. This session
  // does: 20 tool events against getToolHistory's default maxItems of 15 and 8
  // messages against getRecentMessages' default of 5.
  //
  // parseSession walks BACKWARD with a `!detail.lastTool` / `!detail.lastMessage`
  // guard, so only the last tool-bearing and last text-bearing entry are ever
  // seen. The over-long payload rides on `tool_19` and the over-long text on
  // `msg 8` — the last of each — which puts them inside the retained slice too.
  //
  // The directory is written in-body and removed in the finally: the session
  // listing test above asserts a length of exactly 1, so anything left behind
  // would make this file order-dependent and --sequence.shuffle would fail.
  it('caps payloads at 60/80/200 chars and keeps the LAST 15 tools and 5 messages', async () => {
    const gammaDir = '--Users-test-Github-gamma--';
    const workspaceGamma = path.join(tmpHome, 'workspace', 'gamma');
    fs.mkdirSync(workspaceGamma, { recursive: true });

    expect(LONG_ARGS_JSON).toHaveLength(108);

    const entries: unknown[] = [
      { type: 'session', version: 3, id: 'gamma-1', timestamp: at(0), cwd: workspaceGamma },
      { type: 'model_change', provider: 'anthropic', modelId: 'claude-sonnet-4', timestamp: at(1) },
    ];

    // 20 tool events: more than getToolHistory's default maxItems of 15.
    for (let i = 0; i < 20; i++) {
      entries.push({
        type: 'message',
        timestamp: at(2 + i),
        message: {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              name: `tool_${String(i).padStart(2, '0')}`,
              arguments: i === 19 ? LONG_ARGS : { n: i },
            },
          ],
        },
      });
    }

    // 8 text messages: more than getRecentMessages' default maxItems of 5. No
    // usage entries anywhere, so tokenUsage is null here as well.
    for (let i = 1; i <= 8; i++) {
      entries.push({
        type: 'message',
        timestamp: at(30 + i),
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: i === 8 ? LONG_TEXT : `msg ${i}` }],
        },
      });
    }

    const gammaFile = writeSession(gammaDir, 'gamma-1.jsonl', entries);

    vi.resetModules();
    const reimported: any = await import('./pi.js');
    const adapter = new reimported.PiAdapter();

    try {
      const sessions = await sessionsOf(adapter, 5 * MINUTE);
      const session = sessionRow(sessions, sessionIdOf(gammaDir, 'gamma-1.jsonl'));
      expect(session).toBeDefined();

      // pi.ts:92 — parseSession's lastToolInput cap of 60, on the last
      // tool-bearing entry. Only LENGTH discriminates 60 from 80 here: a
      // 60-char prefix is itself a prefix of the 80-char result, so both the
      // exact string and its length are asserted.
      expect(session.lastTool).toBe('tool_19');
      expect(session.lastToolInput).toBe('{"path":"' + 'p'.repeat(30) + '","q":"' + 'q'.repeat(14));
      expect(session.lastToolInput).toHaveLength(60);
      // pi.ts:80 — parseSession's lastMessage cap of 80.
      expect(session.lastMessage).toBe('z'.repeat(80));
      expect(session.model).toBe('claude-sonnet-4');

      const detail = await detailOf(adapter, session.sessionId, session.project, gammaFile);

      // maxItems: the LAST 15 of 20 tools, oldest dropped, original order kept.
      expect(detail.toolHistory).toHaveLength(15);
      expect(detail.toolHistory.map((t: any) => t.tool)).toEqual(
        Array.from({ length: 15 }, (_, i) => `tool_${String(i + 5).padStart(2, '0')}`),
      );
      expect(detail.toolHistory[0].detail).toBe('{"n":5}');
      // pi.ts:133 — toolHistory's own cap is 80, not 60, from the same payload.
      expect(detail.toolHistory[14].detail).toBe('{"path":"' + 'p'.repeat(30) + '","q":"' + 'q'.repeat(34));
      expect(detail.toolHistory[14].detail).toHaveLength(80);

      // maxItems: the LAST 5 of 8 messages. Message text keeps 200 chars here;
      // only the session row's lastMessage is capped at 80.
      expect(detail.messages).toHaveLength(5);
      expect(detail.messages.map((m: any) => m.text)).toEqual([
        'msg 4',
        'msg 5',
        'msg 6',
        'msg 7',
        'z'.repeat(200),
      ]);

      expect(detail.tokenUsage).toBeNull();
    } finally {
      removeProjectDir(gammaDir);
    }
  });

  // Pins parseSession's `until` GATE (pi.ts:107-110) — the one line of the fold
  // conversion that is not a mechanical translation.
  //
  // The pre-conversion loop's early `break` sat INSIDE the message branch, so it
  // could only ever fire after a message had been folded. `foldJsonl` consults
  // `until` after EVERY entry, so the naive translation —
  // `until: (detail) => !!(detail.lastMessage && detail.model && detail.project)`
  // — can complete the triple on a NON-message entry and stop one entry early.
  // The gate re-checks the entry (`pi.ts:108`) and ignores that entry, which is
  // the entire difference between the two versions.
  //
  // This file's shape is the one that tells them apart: the `session` line
  // carrying `cwd` is NOT first, so `project` is the LAST field the reverse walk
  // completes, and the file's only toolCall sits in an EARLIER message than the
  // one that completes the message/model pair. Walking newest-first:
  //
  //   3  session (cwd)     → project. Triple still missing lastMessage and model.
  //   2  message (text)    → lastMessage. Triple still missing model.
  //   1  model_change      → model. TRIPLE COMPLETE, on a non-message entry:
  //                             ↑ the naive `until` stops HERE, lastTool stays null
  //   0  message (toolCall)→ lastTool 'bash'. The gate is the only reason the
  //                             walk is still running when it reaches this entry.
  //
  // Every other fixture here puts the `session` line first and its toolCall in a
  // message newer than the completing one, so gated and naive stop at the same
  // entry and all 8 of them pass either way. Deleting this case would leave the
  // gate unpinned, and a naive re-translation of any adapter with a
  // break-inside-a-branch would then pass review and pass this file.
  //
  // Written in-body and removed in the finally, for the same reason as the gamma
  // case above: the listing case asserts a length of exactly 1, so a directory
  // left behind would make this file order-dependent and --sequence.shuffle
  // would fail.
  it('records a toolCall that sits behind the entry completing the field triple', async () => {
    const epsilonDir = '--Users-test-Github-epsilon--';
    const workspaceEpsilon = path.join(tmpHome, 'workspace', 'epsilon');
    fs.mkdirSync(workspaceEpsilon, { recursive: true });

    // Annotated in reverse-walk order (newest first) above, which is the opposite
    // of the order they are written in here.
    const epsilonFile = writeSession(epsilonDir, 'epsilon-1.jsonl', [
      {
        // Oldest entry, and the file's ONLY toolCall. Reachable only because the
        // gate declines to stop on the `model_change` line above it in the walk.
        type: 'message',
        timestamp: at(0),
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall', name: 'bash', arguments: { command: 'ls' } }],
        },
      },
      // Supplies `model`, and completes the triple on a non-message entry — the
      // exact entry the naive `until` stops on.
      { type: 'model_change', provider: 'minimax', modelId: 'MiniMax-M2.7', timestamp: at(1) },
      {
        // Supplies `lastMessage`. Its text block carries no toolCall, so folding
        // it leaves lastTool null and the walk has to continue past the
        // model_change to fill that in.
        type: 'message',
        timestamp: at(2),
        message: { role: 'assistant', content: [{ type: 'text', text: 'epsilon output' }] },
      },
      {
        // Deliberately LAST, so `cwd` is the last field the reverse walk
        // completes. Moving this line to the top of the file — where every other
        // fixture puts it — collapses the case: nothing would distinguish gated
        // from naive any more. With the naive `until`, `lastTool` and
        // `lastToolInput` below both come back null.
        type: 'session', version: 3, id: 'epsilon-1', timestamp: at(3), cwd: workspaceEpsilon,
      },
    ]);
    const epsilonMtime = backdate(epsilonFile, MINUTE);

    vi.resetModules();
    const reimported: any = await import('./pi.js');
    const adapter = new reimported.PiAdapter();

    try {
      const sessions = await sessionsOf(adapter, 5 * MINUTE);
      const session = sessionRow(sessions, sessionIdOf(epsilonDir, 'epsilon-1.jsonl'));
      expect(session).toBeDefined();

      // The whole field set, so a regression names the field that moved rather
      // than just failing a count.
      expect(session).toEqual({
        sessionId: sessionIdOf(epsilonDir, 'epsilon-1.jsonl'),
        provider: 'pi',
        agentId: null,
        displayName: null,
        agentType: 'main',
        model: 'MiniMax-M2.7',
        status: 'active',
        lastActivity: epsilonMtime,
        project: workspaceEpsilon,
        lastMessage: 'epsilon output',
        // The two fields the gate is load-bearing for. Both are null if the fold
        // stops on the model_change line.
        lastTool: 'bash',
        lastToolInput: '{"command":"ls"}',
        parentSessionId: null,
        filePath: epsilonFile,
      });

      // The toolCall is in the file either way — getToolHistory walks forward with
      // no gate — so a null lastTool above means the reverse walk stopped early,
      // not that this fixture failed to write the tool. Short `arguments`, so
      // neither 60-char nor 80-char truncation applies and the string is exact.
      const detail = await detailOf(adapter, session.sessionId, session.project, epsilonFile);
      expect(detail.toolHistory).toEqual([
        { tool: 'bash', detail: '{"command":"ls"}', ts: new Date(at(0)).getTime() },
      ]);
    } finally {
      removeProjectDir(epsilonDir);
    }
  });

  // pi.ts:341 returns a bare `{ toolHistory: [], messages: [] }` on the miss
  // path — no tokenUsage, no sessionId. As in copilot.fixture.test.ts, only the
  // interface guarantee is asserted: shared/types.ts documents that unknown
  // sessions resolve to empty arrays and that the optional fields "may
  // accompany them", and adapters/index.ts reads them through
  // `detailRaw?.tokenUsage ?? null`. Freezing today's two-key miss shape would
  // block a shared detail builder from returning all four fields.
  it('returns empty detail for unknown session ids', async () => {
    const adapter = new PiAdapter();
    await expect(detailOf(adapter, 'pi:no-such-project:no-such-session', workspaceAlpha)).resolves.toMatchObject({
      toolHistory: [],
      messages: [],
    });
  });

  // ─── #144: a DIRECTORY whose NAME matches the session-file filter ───
  //
  // `fileFor` lists each project directory with a BARE `readdirSync` (pi.ts:262),
  // so its entries arrive as `string[]` and the `.jsonl` filter can ask about the
  // NAME and nothing else. A DIRECTORY named to match therefore passes, `stat`s
  // successfully (size 64, mtime now) and is emitted as a session row whose detail
  // is all null — `readLines` swallows the EISDIR (jsonl-utils.ts:57), so the
  // failure is silent. Drop the `isFile()` term at pi.ts:263 and this goes red.
  it('emits no session row for a directory named *.jsonl in a project directory', async () => {
    await withTempPiHome(async (Adapter, root) => {
      const workspace = path.join(root, 'workspace');
      fs.mkdirSync(workspace, { recursive: true });
      const projectDir = '--Users-test-Github-case--';
      const projectPath = path.join(root, '.pi', 'agent', 'sessions', projectDir);
      fs.mkdirSync(projectPath, { recursive: true });
      fs.writeFileSync(
        path.join(projectPath, 'real1.jsonl'),
        `${JSON.stringify({ type: 'session', version: 3, id: 'real1', timestamp: at(0), cwd: workspace })}\n`
        + `${JSON.stringify({ type: 'message', timestamp: at(1), message: { role: 'assistant', content: [{ type: 'text', text: 'real done' }], model: 'm' } })}\n`,
      );
      // The decoy: a DIRECTORY whose name satisfies the `.jsonl` filter.
      const decoy = path.join(projectPath, 'dirdecoy.jsonl');
      fs.mkdirSync(decoy, { recursive: true });

      const rows = await sessionsOf(new Adapter(), 5 * MINUTE);
      // Nothing else exists in this tree, so the listing is an exact set — and
      // sessionIdOf encodes both halves exactly as pi.ts's buildSessionId does.
      expect(rows.map((r: any) => r.sessionId)).toEqual([sessionIdOf(projectDir, 'real1.jsonl')]);
      // …and the decoy really is a directory, so the exact set above is the
      // `isFile()` guard rather than a missing fixture.
      expect(fs.statSync(decoy).isDirectory()).toBe(true);
    });
  });

  // ─── #161 follow-up: the PER-ITEM unreadable-project-directory counter ───
  //
  // pi.ts is the adapter whose `fileFor` ENUMERATES a project directory
  // (`readdirSync` at pi.ts:278), so it is the only one of the three converted
  // adapters where an unreadable project directory is a real, reachable
  // condition — every other level is filtered on `isDirectory()` and a regular
  // file is dropped before any read (scan-utils.ts:119). The throw is caught at
  // scan-utils.ts:125 and reported as `onUnreadable('child', …)`, which pi.ts:295
  // counts, and `childrenUnreadable` feeds `degradedWarnings` on BOTH the listing
  // (pi.ts:343) and the detail (pi.ts:368) path.
  //
  // Hence `chmod 000`, and hence the uid dependency: there is NO uid-independent
  // way to make `readdirSync` fail on a directory that has already passed an lstat
  // `isDirectory()` check. A mocked readdir would assert the handler rather than
  // the shipped path, and this suite drives the real adapter. GitHub's runners are
  // non-root so these run for real in CI; under root they report as SKIPPED — see
  // `ROOT_CANNOT_BE_DENIED` for why that has to be visible rather than a pass.
  //
  // TWO locked directories, not one: `detail` is the count, so a single loss
  // cannot tell "counted the directories" from "reported that something went
  // wrong" apart.
  const PROJ_LOCKED_A = '--Users-test-Github-lockedA--';
  const PROJ_LOCKED_B = '--Users-test-Github-lockedB--';
  const PROJ_OPEN_ONE = '--Users-test-Github-openone--';
  const PROJ_OPEN_TWO = '--Users-test-Github-opentwo--';
  const EXPECTED_DEGRADED = [{ code: 'root-unreadable', detail: '2 project directory(ies)' }];

  /** Two readable project directories beside two that cannot be listed. */
  function buildMixedTree(root: string) {
    const workspace = path.join(root, 'workspace');
    fs.mkdirSync(workspace, { recursive: true });
    const openOne = writeSessionIn(root, PROJ_OPEN_ONE, 'openone-1.jsonl', sessionEntries(workspace, 'openone-1', 'open one done'));
    writeSessionIn(root, PROJ_OPEN_TWO, 'opentwo-1.jsonl', sessionEntries(workspace, 'opentwo-1', 'open two done'));
    writeSessionIn(root, PROJ_LOCKED_A, 'lockedA-1.jsonl', sessionEntries(workspace, 'lockedA-1', 'never read A'));
    writeSessionIn(root, PROJ_LOCKED_B, 'lockedB-1.jsonl', sessionEntries(workspace, 'lockedB-1', 'never read B'));
    const locked = [PROJ_LOCKED_A, PROJ_LOCKED_B].map((dir) => path.join(sessionsRootAt(root), dir));
    chmodDirectories(locked, 0o000);
    return { openOne, locked };
  }

  it.skipIf(ROOT_CANNOT_BE_DENIED)('warns once per unreadable project directory and still lists the readable ones', async () => {
    await withTempPiHome(async (Adapter, root) => {
      const { openOne, locked } = buildMixedTree(root);
      const openOneMtime = fs.statSync(openOne).mtimeMs;

      try {
        // NOT `sessionsOf`: it unwraps the union and throws `warnings` away, and
        // the warnings are the thing under test here. Direct call, narrowed on ok
        // by hand, exactly as adapterErrorContract.test.ts does.
        const result = await new Adapter().getActiveSessions(5 * MINUTE);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('unreachable');

        // The two readable projects, and NOT the two locked ones. `readdir` order
        // is not guaranteed, so both sides are sorted rather than assumed.
        expect(result.sessions.map((s) => s.sessionId).sort()).toEqual(
          [sessionIdOf(PROJ_OPEN_ONE, 'openone-1.jsonl'), sessionIdOf(PROJ_OPEN_TWO, 'opentwo-1.jsonl')].sort(),
        );

        // The readable sibling is UNAFFECTED, not merely present: every field
        // still resolves. This is the whole per-item/whole-adapter distinction —
        // a sibling that came back degraded would make this a different contract.
        expect(result.sessions.find((s) => s.sessionId === sessionIdOf(PROJ_OPEN_ONE, 'openone-1.jsonl'))).toEqual({
          sessionId: sessionIdOf(PROJ_OPEN_ONE, 'openone-1.jsonl'),
          provider: 'pi',
          agentId: null,
          displayName: null,
          agentType: 'main',
          model: 'claude-sonnet-4',
          status: 'active',
          lastActivity: openOneMtime,
          project: path.join(root, 'workspace'),
          lastMessage: 'open one done',
          lastTool: 'bash',
          lastToolInput: '{"command":"ls"}',
          parentSessionId: null,
          filePath: openOne,
        });

        // Two directories lost, counted as TWO. Drop the `childrenUnreadable`
        // accumulation at pi.ts:295 and this reads `1`; drop the increment's
        // reporting entirely and the array is empty.
        expect(result.warnings).toStrictEqual(EXPECTED_DEGRADED);
      } finally {
        chmodDirectories(locked, 0o755);
      }
    });
  });

  it.skipIf(ROOT_CANNOT_BE_DENIED)('carries the same degradation on the getSessionDetail path', async () => {
    await withTempPiHome(async (Adapter, root) => {
      const { locked } = buildMixedTree(root);
      const adapter = new Adapter();

      try {
        // No `filePath`: the detail counter is only reachable through the id-only
        // rescan at pi.ts:359, because the filePath short-circuit above it returns
        // before any scan runs. Handing one in would silently skip the whole case.
        const lost = await adapter.getSessionDetail(sessionIdOf(PROJ_LOCKED_A, 'lockedA-1.jsonl'), null);
        expect(lost.ok).toBe(true);
        if (!lost.ok) throw new Error('unreachable');

        // Its project directory could not be listed, so the file behind this id was
        // never reached. Asserted per FIELD rather than as a whole object: the miss
        // shape is deliberately not frozen here (see the unknown-id case above), and
        // these two are the contractual part of it.
        expect(lost.detail.messages).toEqual([]);
        expect(lost.detail.toolHistory).toEqual([]);
        expect(lost.warnings).toStrictEqual(EXPECTED_DEGRADED);

        // …and it is a WARNING, not the `ok: false` the root-unreadable branch at
        // pi.ts:362 returns. Its siblings were searched; only this tree was not.
        // The readable sibling resolving completely below is what makes that
        // distinction observable rather than asserted.
        const found = await adapter.getSessionDetail(sessionIdOf(PROJ_OPEN_ONE, 'openone-1.jsonl'), null);
        expect(found.ok).toBe(true);
        if (!found.ok) throw new Error('unreachable');
        expect(found.detail.sessionId).toBe(sessionIdOf(PROJ_OPEN_ONE, 'openone-1.jsonl'));
        expect(found.detail.messages).toEqual([
          { role: 'assistant', text: 'open one done', ts: new Date(at(3)).getTime() },
        ]);
        expect(found.detail.toolHistory).toEqual([
          { tool: 'bash', detail: '{"command":"ls"}', ts: new Date(at(2)).getTime() },
        ]);
        expect(found.detail.tokenUsage).toBeNull();
        // The warning belongs to the SCAN, not to the one session asked for: a
        // session that WAS found still carries the loss elsewhere in the tree.
        // Reading it as per-session would make the sibling's own detail suspect.
        expect(found.warnings).toStrictEqual(EXPECTED_DEGRADED);
      } finally {
        chmodDirectories(locked, 0o755);
      }
    });
  });

  // The other half of the contract, and the reason `degradedWarnings` has the
  // `count > 0 ? … : []` guard at sources.ts:99: a clean install must report
  // NOTHING. Without this, a change that warned unconditionally — or that counted
  // a readable directory as unreadable, or fired `onUnreadable` for an absent
  // root — would add a warning that no other assertion in this file can see,
  // because every other case here goes through `sessionsOf`/`detailOf` and
  // discards the warnings. No chmod needed, so no skip.
  it('reports no warning at all when every project directory can be listed', async () => {
    await withTempPiHome(async (Adapter, root) => {
      const workspace = path.join(root, 'workspace');
      fs.mkdirSync(workspace, { recursive: true });
      writeSessionIn(root, PROJ_OPEN_ONE, 'openone-1.jsonl', sessionEntries(workspace, 'openone-1', 'open one done'));
      writeSessionIn(root, PROJ_OPEN_TWO, 'opentwo-1.jsonl', sessionEntries(workspace, 'opentwo-1', 'open two done'));
      const adapter = new Adapter();

      const result = await adapter.getActiveSessions(5 * MINUTE);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      // Both projects ARE listed — the empty warnings array is not a symptom of
      // an empty scan.
      expect(result.sessions).toHaveLength(2);
      expect(result.warnings).toEqual([]);

      const detail = await adapter.getSessionDetail(sessionIdOf(PROJ_OPEN_ONE, 'openone-1.jsonl'), null);
      expect(detail.ok).toBe(true);
      if (!detail.ok) throw new Error('unreachable');
      expect(detail.warnings).toEqual([]);
    });
  });
});
