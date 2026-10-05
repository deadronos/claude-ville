/**
 * Characterization test for the claude adapter.
 *
 * claude.test.ts is 1226 lines / 49 tests, and 45 of those assert against
 * INLINE COPIES: it redefines `readLastLines`, `parseJsonLines`,
 * `getToolHistory`, `getRecentMessages`, `getTokenUsage`, `getSessionDetail`,
 * `getSessionFileActivity` and `resolveProjectDisplayPath` in the test body and
 * asserts against those. The copies have drifted from claude.ts — they predate
 * `jsonl-utils.ts`, and the inline `getSessionDetail` is the module-level helper
 * rather than the public method — so the file stays green through an arbitrary
 * rewrite of the shipped adapter. Of the four tests that DO reach shipped code,
 * three assert only `Array.isArray(result)` from `getActiveSessions` against the
 * REAL `~/.claude` (no `CLAUDE_DIR` injection, so they are machine-dependent and
 * pin nothing), and the rest check the two static props, `isAvailable`'s type,
 * the miss shape and the watch-path entry shape. `_getActiveSubAgents`,
 * `_getOrphanSessions`, `getTeams` and `getTasks` are never called at all.
 *
 * This file drives the SHIPPED ClaudeAdapter against a synthetic `CLAUDE_DIR`
 * so that a later conversion onto the shared pipeline helpers (`collectJsonl` /
 * `collectScanByMtime` / `foldJsonl`) can be verified as behaviour-preserving
 * rather than merely asserted to be.
 *
 * The load-bearing behaviour is the PROJECT-PATH MAP. `getActiveSessions`
 * populates `projectPathMap` from `if (entry.project)` BEFORE the `sessionId` and
 * active-window `continue`s (claude.ts:256-262), so a history entry that is stale
 * — or that has no `sessionId` at all — still contributes its `project`. That
 * map is the ONLY way an encoded project directory name (`/` -> `-`, which is not
 * reversible) ever becomes a real path, and it is consulted by both
 * `_getActiveSubAgents` and `_getOrphanSessions`. Moving the block below the
 * `continue`s — the obvious "tidy-up" — silently demotes every sub-agent and
 * orphan row's `project` to the `claude:projects:<encoded>` placeholder, and no
 * other fixture in the suite notices. The `ses-donor` history entry below exists
 * to pin exactly that: it is ancient, so it is never itself a session, yet the
 * sub-agent filed under `projects/-tmp-cv-stale-donor/` reports a real path.
 *
 * A correction to the brief this fixture was written from: `extractDetailFromEntries`
 * does NOT walk forward. claude.ts:41 is `for (let i = entries.length - 1; i >= 0;
 * i--)` — newest-first, first-match-wins under the `!detail.lastX` guards, the
 * same first-match trap as codex's `parseRollout` but in the opposite direction
 * to its own field names. What is pinned below is the SHIPPED direction, and the
 * `ses-last` fixture is built so a reversed walk answers with a different model,
 * tool and tool input.
 *
 * Three behaviours are deliberately NOT pinned:
 *
 *  - The `now - lastActive > activeThresholdMs` re-check (claude.ts:290) is
 *    unreachable: `lastActivity` is `Math.max(history timestamp, file mtime)`, so
 *    it is never older than the timestamp the earlier check at claude.ts:262
 *    already validated. No fixture can make it fire.
 *  - The `break` at claude.ts:66 is a pure optimisation. Once model, lastTool and
 *    lastMessage are all set, every write is behind a `!detail.lastX` guard, so
 *    continuing the walk cannot change the result. (Contrast the `until` gate in
 *    pi, which IS load-bearing.)
 *  - The `isDirectory()` filters on `projects/` children (claude.ts:327, :407)
 *    are defence in depth with no observable difference, exactly as in
 *    codex.fixture.test.ts: without them a loose file becomes a "project
 *    directory", `readdir` raises ENOTDIR, and the per-project catch already
 *    discards it. `projects/README.md` and `projects/-tmp-cv-alpha/notes.txt` are
 *    written below so the claim stays honest — no assertion here can pin those
 *    filters. (The third `isDirectory()`, in `getWatchPaths`, IS observable and
 *    IS pinned: without it `README.md` would be watched.)
 *
 * Two defects in claude.ts are recorded in the report and NOT frozen here:
 * `_getOrphanSessions` lists project children with a bare `readdir`, so a
 * DIRECTORY named `*.jsonl` passes the filter, stats fine and is emitted as a
 * team-member with null model/message/tool; and `_getActiveSubAgents` does the
 * same to `subagents/` (a directory named `agent-*.jsonl` becomes a sub-agent).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'node:assert';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { detailOf, sessionsOf } from './fixtureHelpers';
import type { AgentSessionSummary, WatchPath } from '../../shared/types.js';

const MINUTE = 60 * 1000;

/**
 * `project` values exactly as history.jsonl reports them. The adapter never
 * touches the filesystem at these paths — it only encodes them
 * (`replace(/\//g, '-')`, claude.ts:76/:198/:222/:257) to find a directory under
 * `projects/`. ENCODED below is the same one-line transform, written out here so
 * the expected values are not computed by the code under test; the `ses-parent-old`
 * case proves the round trip in both directions.
 */
const ALPHA_PROJECT = '/tmp/cv/alpha';
const KNOWN_PROJECT = '/tmp/cv/known';
const STALE_PROJECT = '/tmp/cv/stale-donor';
const WIDE_PROJECT = '/tmp/cv/wide';
/** No history entry names this one, so nothing ever decodes it. */
const UNMAPPED_ENCODED = '-tmp-cv-unmapped';

const encodeProject = (project: string) => project.replace(/\//g, '-');
const ENCODED_ALPHA = encodeProject(ALPHA_PROJECT);
const ENCODED_KNOWN = encodeProject(KNOWN_PROJECT);
const ENCODED_STALE = encodeProject(STALE_PROJECT);
const ENCODED_WIDE = encodeProject(WIDE_PROJECT);

/**
 * Narrowing row lookup. `sessions.find` answers `| undefined`, and every use
 * reads properties straight off the result. Asserting once here rather than at
 * each call site keeps those call sites' own assertions exactly as written: a
 * missing row still fails the test, now with the id in the message instead of a
 * TypeError on `undefined`.
 */
function rowOf(sessions: AgentSessionSummary[], id: string) {
  const found = sessions.find((s) => s.sessionId === id);
  assert(found, `no session row for ${id}`);
  return found;
}

/** Sub-agent ids, as they appear in the `agent-<id>.jsonl` file names. */
const A1 = 'aaaa1111-bbbb-cccc-dddd-eeee2222ffff';
const A2 = 'bbbb2222-cccc-dddd-eeee-ffff33333333';
const A3 = 'cccc3333-dddd-eeee-ffff-000044444444';

const MAIN_IDS = ['ses-last', 'ses-wide', 'ses-alpha', 'ses-beta', 'ses-gamma', 'ses-known'];
const NON_MAIN_IDS = [`subagent-${A1}`, `subagent-${A2}`, `subagent-${A3}`, 'orph-one'];

let tmpRoot = '';
let ClaudeAdapter: any;
const originalClaudeDir = process.env.CLAUDE_DIR;

/** History timestamps, kept so `lastActivity` can be asserted against them. */
let tsBetaOld = 0;
let tsBeta = 0;
let tsAlpha = 0;
let tsGamma = 0;
let tsKnown = 0;
let tsWide = 0;
let tsLast = 0;
/** Session-file mtimes, likewise. */
let alphaMtime = 0;
let knownFileMtime = 0;
let wideFileMtime = 0;
let lastFileMtime = 0;

/** 150 chars, so the 100-char `entry.display` cap (claude.ts:275) is visible. */
const LONG_DISPLAY = 'D'.repeat(150);
/** 101 chars, so the 80-char detail cap (claude.ts:63) is visible. */
const OLDER_TEXT = `older-text-${'o'.repeat(90)}`;
const OLDER_TEXT_80 = `older-text-${'o'.repeat(69)}`;
const LONG_COMMAND = `c${'9'.repeat(79)}`;

// ─── fixture writers ─────────────────────────────────────

function writeJsonl(root: string, segments: string[], entries: unknown[]) {
  const file = path.join(root, ...segments);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

function mkdir(root: string, segments: string[]) {
  const dir = path.join(root, ...segments);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** A raw (often deliberately malformed) file, parent directories included. */
function writeText(root: string, segments: string[], content: string) {
  const file = path.join(root, ...segments);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

/**
 * claude.ts:262 and :368/:439 compare `now - <ms> > activeThresholdMs` against a
 * `now` captured once per call. Ages here are whole minutes against thresholds of
 * the same magnitude, so no boundary can be raced while the comparison's SIGN is
 * pinned: `<ms> - now > threshold` would admit every stale fixture below.
 */
function backdate(file: string, msAgo: number) {
  const when = new Date(Date.now() - msAgo);
  fs.utimesSync(file, when, when);
  return fs.statSync(file).mtimeMs;
}

/** A line no claude reader treats as a session, tool, message or usage record. */
const filler = (i: number) => ({ type: 'filler', i });

const textBlock = (text: string) => ({ type: 'text', text });
const toolBlock = (name: string | undefined, input: Record<string, unknown>) => ({ type: 'tool_use', name, input });
const assistant = (content: unknown[], model?: string, timestamp = 0) => ({
  message: { role: 'assistant', ...(model ? { model } : {}), content },
  timestamp,
});

/**
 * Runs `fn` against a THROWAWAY `CLAUDE_DIR` with its own fresh module
 * instance, then restores the env var and leaves the suite's own adapter alone.
 * Cases that build their own tree use this so that — with the suite running in
 * shuffled order — they cannot perturb the shared fixture's exact-set
 * assertions. Same re-import shape as copilot.fixture.test.ts.
 */
async function withTempClaudeDir<T>(fn: (Adapter: any, root: string) => Promise<T>): Promise<T> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeville-claude-case-'));
  const prior = process.env.CLAUDE_DIR;
  process.env.CLAUDE_DIR = root;
  vi.resetModules();
  try {
    const { ClaudeAdapter: Fresh } = await import('./claude.js');
    return await fn(Fresh, root);
  } finally {
    if (prior === undefined) delete process.env.CLAUDE_DIR;
    else process.env.CLAUDE_DIR = prior;
    vi.resetModules();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Runs `fn` with DEBUG on, collecting what `debugAdapterError` wrote to
 * `console.debug`. Restores both DEBUG and the spy in `finally`, so a failing
 * assertion cannot leak DEBUG=1 into a later case. Same shape as
 * jsonl-utils.test.ts's `withDebug` and scan-utils.test.ts's — `debugAdapterError`
 * reads `process.env.DEBUG` at CALL time (jsonl-utils.ts:17), so no module reload
 * is needed here.
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

describe('ClaudeAdapter fixtures', () => {
  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeville-claude-'));
    const now = Date.now();

    // ── history.jsonl ────────────────────────────────────
    tsBetaOld = now - 400 * 1000;
    tsBeta = now - 150 * 1000;
    tsWide = now - 30 * 1000;
    tsLast = now - 5 * 1000;
    tsGamma = now - 200 * 1000;
    tsAlpha = now - 240 * 1000;
    tsKnown = now - 250 * 1000;

    writeJsonl(tmpRoot, ['history.jsonl'], [
      // The DONOR. Ancient, so claude.ts:262 skips it as a session — but
      // claude.ts:256 has already put `-tmp-cv-stale-donor` into the
      // projectPathMap, which is the only reason the sub-agent under
      // `projects/-tmp-cv-stale-donor/` reports a real path below. Delete this
      // line, or move the map population below either `continue`, and that row's
      // `project` becomes `claude:projects:-tmp-cv-stale-donor`.
      { sessionId: 'ses-donor', project: STALE_PROJECT, timestamp: 0, display: 'donor' },
      // Two entries for one session id, OLDER FIRST IN THE FILE. claude.ts:265
      // keeps the entry with the greater timestamp, so the row carries the
      // second one's fields whatever order they were written in.
      { sessionId: 'ses-beta', project: ALPHA_PROJECT, timestamp: tsBetaOld, display: 'beta old display', agentId: 'ag-old', agentType: 'old-type', model: 'old-model-beta' },
      { sessionId: 'ses-beta', project: ALPHA_PROJECT, timestamp: tsBeta, display: 'beta display line', agentId: 'ag-beta', agentType: 'workflow', model: 'hist-model-beta' },
      { sessionId: 'ses-alpha', project: ALPHA_PROJECT, timestamp: tsAlpha, display: LONG_DISPLAY, model: 'hist-model-alpha' },
      // No `project` and no `model`: `project` is null (and the whole detail read
      // is skipped by claude.ts:74), `model` falls through to 'unknown'
      // (claude.ts:271) and `agentType` is derived from the agentId
      // (claude.ts:270).
      { sessionId: 'ses-gamma', timestamp: tsGamma, display: 'gamma display', agentId: 'ag-gamma' },
      // Fresh, carries a project, and has NO `sessionId`. The guard at
      // claude.ts:261 drops it — without that guard it would be filed under an
      // `undefined` key and appear in the listing as its own row.
      { project: ALPHA_PROJECT, timestamp: tsGamma, display: 'no session id here' },
      { sessionId: 'ses-known', project: KNOWN_PROJECT, timestamp: tsKnown, display: 'known display' },
      { sessionId: 'ses-wide', project: WIDE_PROJECT, timestamp: tsWide, display: 'wide display', model: 'hist-model-wide' },
      // Newest session, and the last line of the file — so a `from: 'start'`
      // history read would drop all six live sessions.
      { sessionId: 'ses-last', project: ALPHA_PROJECT, timestamp: tsLast, display: 'last display', model: 'hist-model-last' },
    ]);

    // ── projects/ ────────────────────────────────────────
    mkdir(tmpRoot, ['projects']);
    // A loose file at the top of `projects/`. See the header: this documents that
    // the `isDirectory()` filters at claude.ts:327 and :407 are unobservable
    // here. `getWatchPaths` DOES pin its own filter — see below.
    writeText(tmpRoot, ['projects', 'README.md'], 'not a project dir\n');

    // ALPHA's session file. One user turn (skipped by the role guard at
    // claude.ts:43) and one assistant turn carrying a model and a tool but NO
    // text block — so `detail.lastMessage` stays null and the row's lastMessage
    // falls back to `entry.display` (claude.ts:299).
    const alphaFile = writeJsonl(tmpRoot, ['projects', ENCODED_ALPHA, 'ses-alpha.jsonl'], [
      { message: { role: 'user', content: [textBlock('a question about the build')] }, timestamp: 1 },
      assistant([toolBlock('Bash', { command: 'npm run build -- --watch' })], 'alpha-file-model', 2),
    ]);
    alphaMtime = backdate(alphaFile, 90 * 1000);

    // LAST's session file. The assistant entry carrying the model and the tool is
    // NEWER than the one carrying the text, so the shipped backward walk
    // (claude.ts:41) takes the newer model/tool and then keeps going — the
    // `break` at claude.ts:66 cannot fire while lastMessage is still null — and
    // fills lastMessage from the older turn. Walking FORWARD instead answers
    // with 'last-old-model' / 'Read' / 'older.txt'.
    const lastFile = writeJsonl(tmpRoot, ['projects', ENCODED_ALPHA, 'ses-last.jsonl'], [
      assistant(
        [textBlock(OLDER_TEXT), toolBlock('Read', { file_path: '/tmp/cv/older.txt' })],
        'last-old-model',
        1,
      ),
      assistant([toolBlock('Grep', { pattern: 'TODO' })], 'last-new-model', 2),
    ]);
    lastFileMtime = backdate(lastFile, 60 * 1000);

    // KNOWN's session file mtime is OLDER than its history timestamp, so
    // `Math.max` picks the timestamp; ALPHA's is NEWER, so it picks the mtime.
    // Both are asserted by value, not merely by ordering.
    const knownFile = writeJsonl(tmpRoot, ['projects', ENCODED_KNOWN, 'ses-known.jsonl'], [
      assistant([toolBlock('Read', { file_path: '/tmp/cv/known.txt' })], 'known-file-model', 1),
    ]);
    knownFileMtime = backdate(knownFile, 260 * 1000);

    // WIDE's session file: the assistant turn sits at line 9 of 40, so it is
    // outside the 30-line window the row's detail uses (claude.ts:81) but inside
    // getToolHistory's 100 (claude.ts:102) and getRecentMessages' 60
    // (claude.ts:135). A null lastTool on the row is therefore the WINDOW, not a
    // missing tool.
    const wideFile = writeJsonl(tmpRoot, ['projects', ENCODED_WIDE, 'ses-wide.jsonl'], [
      ...Array.from({ length: 9 }, (_, i) => filler(i)),
      assistant([toolBlock('Edit', { file_path: '/tmp/cv/wide.ts' }), textBlock('wide assistant text')], 'wide-file-model', 9),
      ...Array.from({ length: 30 }, (_, i) => filler(100 + i)),
    ]);
    wideFileMtime = backdate(wideFile, 20 * 1000);

    // A1 — the sub-agent that depends on the stale donor entry. Its project can
    // only decode because `ses-donor` contributed `-tmp-cv-stale-donor` to the
    // map even though it was skipped as a session.
    writeJsonl(tmpRoot, ['projects', ENCODED_STALE, 'ses-parent-old', 'subagents', `agent-${A1}.jsonl`], [
      assistant([toolBlock('Task', { command: 'do-the-thing' }), textBlock('sub one done')], 'sub-model-1', 11),
    ]);

    // A1 again, as a bare project-level file. `knownIds` holds the sub-agent's id
    // with the `subagent-` prefix STRIPPED (claude.ts:311), so this file is an
    // orphan that must be excluded — otherwise the same agent appears twice.
    writeJsonl(tmpRoot, ['projects', ENCODED_STALE, `${A1}.jsonl`], [
      assistant([textBlock('trap')], 'trap-model', 12),
    ]);

    // A2 — decoded through the in-window `ses-alpha` entry instead.
    writeJsonl(tmpRoot, ['projects', ENCODED_ALPHA, 'ses-parent-alpha', 'subagents', `agent-${A2}.jsonl`], [
      assistant([textBlock('sub two done')], undefined, 21),
    ]);
    // Four decoys in the same `subagents/` directory. Together they pin
    // `startsWith('agent-') && endsWith('.jsonl')` (claude.ts:352) from both
    // sides: `other-decoy.jsonl` ends with it but does not start with `agent-`,
    // `agent-x.txt` starts with it but does not end with `.jsonl`, and
    // `agent-y.jsonl.bak` contains `.jsonl` without ending with it.
    writeText(tmpRoot, ['projects', ENCODED_ALPHA, 'ses-parent-alpha', 'subagents', 'notes.txt'], 'not an agent file\n');
    writeText(tmpRoot, ['projects', ENCODED_ALPHA, 'ses-parent-alpha', 'subagents', 'agent-x.txt'], 'not an agent file\n');
    writeText(tmpRoot, ['projects', ENCODED_ALPHA, 'ses-parent-alpha', 'subagents', 'agent-y.jsonl.bak'], 'not an agent file\n');
    writeJsonl(tmpRoot, ['projects', ENCODED_ALPHA, 'ses-parent-alpha', 'subagents', 'other-decoy.jsonl'], [
      assistant([textBlock('decoy')], 'decoy-model', 22),
    ]);

    // A3 — nothing ever puts `-tmp-cv-unmapped` in the map.
    writeJsonl(tmpRoot, ['projects', UNMAPPED_ENCODED, 'ses-parent-unmapped', 'subagents', `agent-${A3}.jsonl`], [
      assistant([toolBlock('Glob', { pattern: '*.ts' })], undefined, 31),
    ]);

    // A session directory with no `subagents/` at all (claude.ts:347), and a
    // loose file beside the session directories. See the header on `isDirectory`.
    mkdir(tmpRoot, ['projects', ENCODED_ALPHA, 'ses-no-subagents']);
    writeText(tmpRoot, ['projects', ENCODED_ALPHA, 'notes.txt'], 'loose\n');

    // The one real orphan. Its id is in neither `sessionsMap` nor the stripped
    // sub-agent ids, so claude.ts:428 does not drop it.
    writeJsonl(tmpRoot, ['projects', ENCODED_ALPHA, 'orph-one.jsonl'], [
      assistant([textBlock('orphan one done'), toolBlock('Grep', { pattern: 'TODO' })], undefined, 41),
    ]);
    // Three decoys for the orphan scan's `endsWith('.jsonl') && !startsWith('.')`
    // filter (claude.ts:420): a dot-prefixed jsonl, a jsonl with a suffix, and a
    // plain file.
    writeText(tmpRoot, ['projects', ENCODED_ALPHA, '.hidden.jsonl'], 'hidden\n');
    writeText(tmpRoot, ['projects', ENCODED_ALPHA, 'orphan.jsonl.bak'], 'suffixed\n');
    writeText(tmpRoot, ['projects', ENCODED_ALPHA, 'plain.txt'], 'plain\n');

    // ── teams/ and tasks/ ────────────────────────────────
    writeText(tmpRoot, ['teams', 'alpha-team', 'config.json'], '{"description":"Alpha team","members":["ann","bo"],"lead":"ann"}');
    writeText(tmpRoot, ['teams', 'broken-team', 'config.json'], '{ not json at all');
    mkdir(tmpRoot, ['teams', 'no-config-team']);
    writeText(tmpRoot, ['teams', 'loose.txt'], 'not a team\n');

    writeText(tmpRoot, ['tasks', 'group-one', '2.json'], '{"id":2,"subject":"second","status":"pending"}');
    writeText(tmpRoot, ['tasks', 'group-one', '1.json'], '{"id":1,"subject":"first","status":"done"}');
    writeText(tmpRoot, ['tasks', 'group-one', 'bad.json'], '{ nope');
    writeText(tmpRoot, ['tasks', 'group-one', 'notes.txt'], 'ignored\n');
    // Parses, so a filter widened to `includes('.json')` would list it and bump
    // both the task list and `count`.
    writeText(tmpRoot, ['tasks', 'group-one', 'sneaky.json.txt'], '{"id":9,"subject":"sneaky"}');
    writeText(tmpRoot, ['tasks', 'group-two', '7.json'], '{"id":7,"subject":"seven"}');
    writeText(tmpRoot, ['tasks', 'group-two', 'noid.json'], '{"subject":"no id here"}');
    writeText(tmpRoot, ['tasks', 'loose.txt'], 'not a group\n');

    process.env.CLAUDE_DIR = tmpRoot;
    vi.resetModules();
    ({ ClaudeAdapter } = await import('./claude.js'));
  });

  afterAll(() => {
    if (originalClaudeDir === undefined) {
      delete process.env.CLAUDE_DIR;
    } else {
      process.env.CLAUDE_DIR = originalClaudeDir;
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const list = async (thresholdMs = 10 * MINUTE) =>
    await sessionsOf(new ClaudeAdapter(), thresholdMs);

  it('resolves home, availability and watch paths from CLAUDE_DIR', () => {
    const adapter = new ClaudeAdapter();
    expect(adapter.name).toBe('Claude Code');
    expect(adapter.provider).toBe('claude');
    expect(adapter.homeDir).toBe(tmpRoot);
    expect(adapter.isAvailable()).toBe(true);

    // Sorted, because readdir order is not part of the contract but the SET is:
    // history.jsonl as a file watch, one recursive `.jsonl` watch per PROJECT
    // directory, and `teams/` last. Note there is no watch on `tasks/`.
    expect([...adapter.getWatchPaths()].sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { type: 'file', path: path.join(tmpRoot, 'history.jsonl') },
      { type: 'directory', path: path.join(tmpRoot, 'projects', ENCODED_ALPHA), filter: '.jsonl', recursive: true },
      { type: 'directory', path: path.join(tmpRoot, 'projects', ENCODED_KNOWN), filter: '.jsonl', recursive: true },
      { type: 'directory', path: path.join(tmpRoot, 'projects', ENCODED_STALE), filter: '.jsonl', recursive: true },
      { type: 'directory', path: path.join(tmpRoot, 'projects', UNMAPPED_ENCODED), filter: '.jsonl', recursive: true },
      { type: 'directory', path: path.join(tmpRoot, 'projects', ENCODED_WIDE), filter: '.jsonl', recursive: true },
      { type: 'directory', path: path.join(tmpRoot, 'teams'), filter: '.json', recursive: true },
    ]);
    // The one observable `isDirectory()` in the file: without it, the loose
    // `projects/README.md` would be watched as if it were a project.
    expect(adapter.getWatchPaths().some((p: WatchPath) => p.path.endsWith('README.md'))).toBe(false);
  });

  // The listing length and this exact order pin five things at once: the
  // `Math.max`/sort on lastActivity, the exclusion of `ses-donor` as a session,
  // the `agent-*.jsonl` name filter (four decoys), the orphan file filter (three
  // decoys) and the `knownIds` exclusions (the bare `A1.jsonl` and
  // `ses-known.jsonl`). It is also the only place the GROUP ORDER is pinned:
  // main sessions first, then sub-agents, then orphans (claude.ts:315).
  it('lists main sessions newest-first, then sub-agents, then orphans', async () => {
    const sessions = await list();
    expect(sessions).toHaveLength(MAIN_IDS.length + NON_MAIN_IDS.length);
    const ids = sessions.map((s: any) => s.sessionId);
    expect(ids.slice(0, MAIN_IDS.length)).toEqual(MAIN_IDS);
    expect(ids.slice(MAIN_IDS.length).sort()).toEqual([...NON_MAIN_IDS].sort());
    // Within the tail the GROUP order is pinned as well (all three sub-agents,
    // then the orphan), even though the order within a group comes from readdir
    // and is deliberately not asserted.
    expect(ids.slice(MAIN_IDS.length, MAIN_IDS.length + 3).sort()).toEqual(
      [`subagent-${A1}`, `subagent-${A2}`, `subagent-${A3}`].sort(),
    );
    expect(ids[ids.length - 1]).toBe('orph-one');
    // The ancient donor entry never becomes a session of its own.
    expect(ids).not.toContain('ses-donor');
  });

  // `lastActivity` is `Math.max(history timestamp, session file mtime)`
  // (claude.ts:289), and `mainSessions` is sorted DESCENDING by it
  // (claude.ts:303). Both directions are asserted by exact value: ALPHA's file
  // mtime is newer than its timestamp, KNOWN's is older, and LAST's timestamp is
  // newer than its file. `Math.min` answers three different numbers here.
  it('takes lastActivity as the max of the history timestamp and the file mtime', async () => {
    const sessions = await list();
    const row = (id: string) => rowOf(sessions, id);

    expect(tsAlpha).toBeLessThan(alphaMtime);
    expect(tsKnown).toBeGreaterThan(knownFileMtime);
    expect(tsLast).toBeGreaterThan(lastFileMtime);

    expect(row('ses-alpha').lastActivity).toBe(alphaMtime);
    expect(row('ses-known').lastActivity).toBe(tsKnown);
    expect(row('ses-last').lastActivity).toBe(tsLast);
    // No session file at all: `getSessionFileActivity` returns 0 (claude.ts:232)
    // and the timestamp wins.
    expect(row('ses-beta').lastActivity).toBe(tsBeta);
    expect(row('ses-gamma').lastActivity).toBe(tsGamma);
    // WIDE's file is newer than its timestamp too.
    expect(row('ses-wide').lastActivity).toBe(wideFileMtime);
  });

  // The exact row shape for a main session: eleven keys, no `filePath` and no
  // `parentSessionId` (claude.ts:294-300 spreads the history entry and then
  // overwrites `model` and `lastMessage`). ALPHA's session file carries a tool
  // and a model but no text block, so the row's `lastMessage` is the history
  // entry's `display` capped at 100 (claude.ts:275), and `model` is the FILE's
  // model rather than the history entry's (`detail.model || session.model`,
  // claude.ts:296).
  it('emits a main-session row with the full field set and the model fallback chain', async () => {
    const sessions = await list();
    const alpha = rowOf(sessions, 'ses-alpha');
    expect(alpha).toEqual({
      sessionId: 'ses-alpha',
      provider: 'claude',
      agentId: null,
      agentType: 'main',
      model: 'alpha-file-model',
      status: 'active',
      lastActivity: alphaMtime,
      project: ALPHA_PROJECT,
      lastMessage: LONG_DISPLAY.slice(0, 100),
      lastTool: 'Bash',
      lastToolInput: 'npm run build -- --watch',
    });
    expect(alpha.lastMessage).toHaveLength(100);
    // The history entry said `hist-model-alpha`; the file's assistant turn said
    // `alpha-file-model`, and the file wins.
    expect(alpha.model).not.toBe('hist-model-alpha');
  });

  // `agentType` is `entry.agentType || (entry.agentId ? 'sub-agent' : 'main')`
  // (claude.ts:270) and `agentId` is `entry.agentId || null`. Three branches,
  // three different answers, all needed: a rewrite that hardcodes 'main' or
  // reads `agentType` alone loses two of them.
  it('derives agentType from agentType, then agentId, then nothing at all', async () => {
    const sessions = await list();
    const row = (id: string) => rowOf(sessions, id);

    expect(row('ses-alpha')).toMatchObject({ agentId: null, agentType: 'main' });
    expect(row('ses-beta')).toMatchObject({ agentId: 'ag-beta', agentType: 'workflow' });
    expect(row('ses-gamma')).toMatchObject({ agentId: 'ag-gamma', agentType: 'sub-agent' });

    // A second history entry for `ses-beta` with a greater timestamp wins
    // (claude.ts:265) — and it is the OLDER entry that appears FIRST in the file,
    // so a comparison with the sign flipped keeps the wrong one.
    expect(row('ses-beta')).toMatchObject({
      agentId: 'ag-beta',
      agentType: 'workflow',
      model: 'hist-model-beta',
      lastMessage: 'beta display line',
      lastActivity: tsBeta,
    });
  });

  // `model` falls back through `detail.model || session.model` where
  // `session.model` is `entry.model || 'unknown'` (claude.ts:271, :296). GAMMA has
  // no project, so `getSessionDetail` short-circuits to all-nulls (claude.ts:74)
  // and the history entry named no model either: 'unknown' is the only thing left.
  it('falls back to model "unknown" when neither the file nor the entry names one', async () => {
    const sessions = await list();
    const gamma = sessions.find((s: any) => s.sessionId === 'ses-gamma');
    expect(gamma).toEqual({
      sessionId: 'ses-gamma',
      provider: 'claude',
      agentId: 'ag-gamma',
      agentType: 'sub-agent',
      model: 'unknown',
      status: 'active',
      lastActivity: tsGamma,
      project: null,
      lastMessage: 'gamma display',
      lastTool: null,
      lastToolInput: null,
    });
  });

  // THE PIN. `projects/-tmp-cv-stale-donor` is named by exactly one history
  // entry, and that entry is ancient: claude.ts:262 skips it as a session, but
  // claude.ts:256 has already recorded its `project`. Because `/` -> `-` is not
  // reversible, that map is the only thing that can turn the encoded directory
  // name back into a path (claude.ts:20-26) — so if the map were populated after
  // the `continue`s, this row would read `claude:projects:-tmp-cv-stale-donor`
  // and the fixture tree would look broken for reasons no other assertion covers.
  it('decodes a sub-agent project from a STALE history entry, and falls back to a placeholder otherwise', async () => {
    const sessions = await list();
    const row = (id: string) => rowOf(sessions, id);

    // A1's project decodes only through the stale donor.
    expect(row(`subagent-${A1}`).project).toBe(STALE_PROJECT);
    expect(row(`subagent-${A1}`).project).not.toBe(`claude:projects:${ENCODED_STALE}`);
    // A2 decodes through an entry that IS an active session.
    expect(row(`subagent-${A2}`).project).toBe(ALPHA_PROJECT);
    // A3's encoded directory is named by no entry at all, so the stable
    // identifier is exposed instead of a guessed path.
    expect(row(`subagent-${A3}`).project).toBe(`claude:projects:${UNMAPPED_ENCODED}`);

    // The encoding itself, pinned in both directions: writing the tree under the
    // `/` -> `-` name of a project string is what makes the decode possible.
    expect(ENCODED_STALE).toBe('-tmp-cv-stale-donor');
    // `project` is `string | null` on the summary; a null here used to throw
    // inside `encodeProject`. Asserted instead so the failure names the cause.
    const a1Project = row(`subagent-${A1}`).project;
    assert(typeof a1Project === 'string', `subagent-${A1} must carry a string project`);
    expect(encodeProject(a1Project)).toBe(ENCODED_STALE);
  });

  // The four-level walk: `projects/` -> session dir -> `subagents/` ->
  // `agent-*.jsonl`. The row carries the agent id with `agent-` and `.jsonl`
  // stripped, the parent session directory's name, and its own file mtime as
  // `lastActivity`.
  it('emits one sub-agent row per agent-*.jsonl, with its parent session dir', async () => {
    const sessions = await list();
    // `ses-gamma`'s agentType is ALSO 'sub-agent' — claude.ts:270 derives that
    // from its agentId — so the walk's rows are told apart by carrying a
    // `parentSessionId`, which no main-session row has.
    const subAgents = sessions.filter((s: any) => s.parentSessionId !== undefined);
    expect(subAgents.map((s: any) => s.sessionId).sort()).toEqual(
      [`subagent-${A1}`, `subagent-${A2}`, `subagent-${A3}`].sort(),
    );

    const a1 = rowOf(sessions, `subagent-${A1}`);
    expect(a1).toEqual({
      sessionId: `subagent-${A1}`,
      provider: 'claude',
      agentId: A1,
      agentType: 'sub-agent',
      model: 'sub-model-1',
      status: 'active',
      lastActivity: fs.statSync(path.join(tmpRoot, 'projects', ENCODED_STALE, 'ses-parent-old', 'subagents', `agent-${A1}.jsonl`)).mtimeMs,
      project: STALE_PROJECT,
      lastMessage: 'sub one done',
      lastTool: 'Task',
      lastToolInput: 'do-the-thing',
      parentSessionId: 'ses-parent-old',
    });
    // The id derivation: `agent-` and `.jsonl` stripped, `subagent-` prepended.
    expect(a1.sessionId).toBe(`subagent-${a1.agentId}`);

    // A2's file carries only a text block, so its model falls back to 'unknown'
    // and its tool stays null — the sub-agent row's own fallback chain, which is
    // `detail.model || 'unknown'` (claude.ts:379), not the history entry's.
    expect(sessions.find((s: any) => s.sessionId === `subagent-${A2}`)).toMatchObject({
      model: 'unknown',
      lastTool: null,
      lastToolInput: null,
      lastMessage: 'sub two done',
      parentSessionId: 'ses-parent-alpha',
    });
    expect(sessions.find((s: any) => s.sessionId === `subagent-${A3}`)).toMatchObject({
      agentId: A3,
      model: 'unknown',
      lastTool: 'Glob',
      lastToolInput: '*.ts',
      lastMessage: null,
      parentSessionId: 'ses-parent-unmapped',
    });

    // The four decoys written beside `agent-<A2>.jsonl` produced no rows: a
    // `notes.txt` and an `agent-x.txt` (both fail `endsWith('.jsonl')`),
    // an `agent-y.jsonl.bak` (fails it too) and an `other-decoy.jsonl`
    // (fails `startsWith('agent-')`).
    for (const decoy of ['notes.txt', 'agent-x.txt', 'agent-y.jsonl.bak', 'other-decoy.jsonl']) {
      expect(subAgents.some((s: any) => s.lastMessage === decoy || s.model === 'decoy-model')).toBe(false);
    }
    expect(sessions.some((s: any) => s.lastMessage === 'decoy')).toBe(false);
    // The session directory with no `subagents/` inside contributed nothing.
    expect(sessions.some((s: any) => s.parentSessionId === 'ses-no-subagents')).toBe(false);
  });

  // `_getOrphanSessions` lists every `*.jsonl` under a project directory that is
  // not in `knownIds`. `knownIds` is `sessionsMap`'s keys UNION the sub-agents'
  // ids WITH THE `subagent-` PREFIX STRIPPED (claude.ts:309-312) — the strip is
  // what stops the bare `<agentId>.jsonl` next to `subagents/agent-<agentId>.jsonl`
  // from being emitted a second time as a team-member.
  it('excludes orphans already claimed by history or by a sub-agent, and labels the rest team-member', async () => {
    const sessions = await list();
    const orphans = sessions.filter((s: any) => s.agentType === 'team-member');
    expect(orphans.map((s: any) => s.sessionId)).toEqual(['orph-one']);
    expect(orphans[0]).toEqual({
      sessionId: 'orph-one',
      provider: 'claude',
      agentId: 'orph-one',
      agentType: 'team-member',
      model: 'unknown',
      status: 'active',
      lastActivity: fs.statSync(path.join(tmpRoot, 'projects', ENCODED_ALPHA, 'orph-one.jsonl')).mtimeMs,
      project: ALPHA_PROJECT,
      lastMessage: 'orphan one done',
      lastTool: 'Grep',
      lastToolInput: 'TODO',
    });

    // A1 appears exactly once in the whole listing, as a sub-agent. Without the
    // prefix strip it would appear twice.
    expect(sessions.filter((s: any) => s.agentId === A1).map((s: any) => s.agentType)).toEqual(['sub-agent']);
    // `ses-known.jsonl` exists on disk but its id is a key of `sessionsMap`.
    expect(sessions.filter((s: any) => s.sessionId === 'ses-known').map((s: any) => s.agentType)).toEqual(['main']);
    // The orphan file filter's two guards, each with its own decoy.
    expect(sessions.some((s: any) => s.sessionId === '.hidden' || s.sessionId === 'orphan')).toBe(false);
    expect(sessions.some((s: any) => s.sessionId === 'plain' || s.sessionId === 'notes')).toBe(false);
  });

  // Two mtime windows to straddle: `ses-fresh` is current, one sub-agent and one
  // orphan are 40 minutes old. At a 45-minute threshold all three are listed; at
  // 35 minutes only the fresh ones are. Nothing else exists in this tree, so the
  // assertion is an exact set both times.
  it('filters sub-agents and orphans by file mtime against the supplied threshold', async () => {
    await withTempClaudeDir(async (Adapter, root) => {
      writeJsonl(root, ['history.jsonl'], [
        { sessionId: 'ses-fresh', project: '/p', timestamp: Date.now(), display: 'fresh' },
      ]);
      writeJsonl(root, ['projects', '-p', 'ses-fresh.jsonl'], [
        assistant([textBlock('fresh turn')], 'fresh-model', 1),
      ]);
      writeJsonl(root, ['projects', '-p', 'ses-parent', 'subagents', 'agent-fresh.jsonl'], [
        assistant([textBlock('fresh sub')], 'fresh-sub-model', 2),
      ]);
      writeJsonl(root, ['projects', '-p', 'ses-parent', 'subagents', 'agent-old.jsonl'], [
        assistant([textBlock('old sub')], 'old-sub-model', 3),
      ]);
      writeJsonl(root, ['projects', '-p', 'orph-old.jsonl'], [
        assistant([textBlock('old orphan')], 'old-orphan-model', 4),
      ]);
      backdate(path.join(root, 'projects', '-p', 'ses-parent', 'subagents', 'agent-old.jsonl'), 40 * MINUTE);
      backdate(path.join(root, 'projects', '-p', 'orph-old.jsonl'), 40 * MINUTE);

      const adapter = new Adapter();
      const wide = await sessionsOf(adapter, 45 * MINUTE);
      expect(wide.map((s: any) => s.sessionId).sort()).toEqual(
        ['orph-old', 'ses-fresh', 'subagent-fresh', 'subagent-old'].sort(),
      );

      const narrow = await sessionsOf(adapter, 35 * MINUTE);
      expect(narrow.map((s: any) => s.sessionId).sort()).toEqual(
        ['ses-fresh', 'subagent-fresh'].sort(),
      );
    });
  });

  // `getActiveSessions` reads `history.jsonl` with `count: 1000` and no `from`,
  // which `readLines` defaults to `'end'` (jsonl-utils.ts:27): the LAST 1000
  // lines. 1006 lines are written, so the window is exactly indices 6..1005 —
  // the donor below is its first line and the six live sessions are its last six.
  // Both edges are pinned in one tree: dropping `ses-just-past` proves the window
  // starts at index 6 rather than 0, and reading the donor proves it starts no
  // later than index 6.
  it('reads the last 1000 history lines, not the first', async () => {
    await withTempClaudeDir(async (Adapter, root) => {
      const now = Date.now();
      const entries: unknown[] = [];
      for (let i = 0; i < 5; i++) entries.push({ display: `pad ${i}` });
      // Line 6 of the file, one line OUTSIDE the window: never read.
      entries.push({ sessionId: 'ses-just-past', project: '/p-past', timestamp: now, display: 'past' });
      // Line 7, the FIRST line of the 1000-line window. Ancient, so it is not a
      // session, but its project still has to reach the map.
      entries.push({ sessionId: 'ses-donor', project: '/p-donor', timestamp: 0, display: 'donor' });
      for (let i = 0; i < 993; i++) entries.push({ display: `pad ${i}` });
      // Lines 1001..1006: the last six, and the only sessions. Distinct
      // timestamps so the descending sort is unambiguous.
      for (let i = 0; i < 6; i++) {
        entries.push({ sessionId: `ses-live-${i}`, project: '/p-live', timestamp: now - i * 1000, display: `live ${i}` });
      }
      writeJsonl(root, ['history.jsonl'], entries);
      expect(entries).toHaveLength(1006);

      writeJsonl(root, ['projects', '-p-donor', 'ses-parent', 'subagents', 'agent-D.jsonl'], [
        assistant([textBlock('donor decode')], 'donor-model', 1),
      ]);

      const sessions = await sessionsOf(new Adapter(), 10 * MINUTE);
      expect(sessions.map((s: any) => s.sessionId)).toEqual([
        'ses-live-0', 'ses-live-1', 'ses-live-2', 'ses-live-3', 'ses-live-4', 'ses-live-5',
        'subagent-D',
      ]);
      expect(rowOf(sessions, 'subagent-D').project).toBe('/p-donor');
    });
  });

  // `extractDetailFromEntries` walks the window NEWEST-FIRST and keeps the FIRST
  // match under `!detail.lastX`, so the newest assistant turn supplies the model
  // and the tool. Here that turn has no text block, so the walk continues to the
  // older turn for `lastMessage` — and the field names ("lastTool") suggest the
  // opposite. The 80-char cap (claude.ts:63) and the
  // `detail.lastMessage || session.lastMessage` precedence (claude.ts:299) ride
  // along: the history entry's `display` is NOT what this row shows.
  it('takes the detail from the NEWEST assistant turn, and caps its message at 80', async () => {
    const sessions = await list();
    const last = rowOf(sessions, 'ses-last');
    expect(last).toMatchObject({
      // From line 2 of the file, not line 1.
      model: 'last-new-model',
      lastTool: 'Grep',
      lastToolInput: 'TODO',
      // From line 1 — the walk had not broken yet.
      lastMessage: OLDER_TEXT_80,
    });
    expect(last.lastMessage).toHaveLength(80);
    expect(last.lastMessage).toBe(OLDER_TEXT.slice(0, 80));
    // The history entry claimed `hist-model-last` and `last display`.
    expect(last.model).not.toBe('hist-model-last');
    expect(last.lastMessage).not.toBe('last display');
  });

  // WIDE's assistant turn sits at line 9 of 40. The row's detail read is
  // 30 lines (claude.ts:81), so it misses the turn entirely and every field falls
  // back; `getSessionDetail`'s readers, at 100 and 60 lines, still see it. A null
  // lastTool on the row is therefore the WINDOW and not a missing tool.
  it('reads the session row from a 30-line tail, narrower than the detail readers', async () => {
    const sessions = await list();
    const wide = sessions.find((s: any) => s.sessionId === 'ses-wide');
    expect(wide).toMatchObject({
      model: 'hist-model-wide',
      lastTool: null,
      lastToolInput: null,
      lastMessage: 'wide display',
    });

    const detail = await detailOf(new ClaudeAdapter(), 'ses-wide', WIDE_PROJECT);
    expect(detail.sessionId).toBe('ses-wide');
    expect(detail.toolHistory).toEqual([{ tool: 'Edit', detail: '/tmp/cv/wide.ts', ts: 9 }]);
    expect(detail.messages).toEqual([{ role: 'assistant', text: 'wide assistant text', ts: 9 }]);
  });

  // `getToolHistory` reads 100 lines, `getRecentMessages` 60, `getTokenUsage`
  // 200 — three different windows, each proved by pushing the interesting entry
  // just outside its own reader and pairing it with a short control that carries
  // the same entry, so an empty result cannot be confused with an absent record.
  it('bounds each detail reader by its own line window', async () => {
    const adapter = new ClaudeAdapter();

    const toolEntries = [
      assistant([toolBlock('hidden_tool', { pattern: 'hidden' })], undefined, 1),
      ...Array.from({ length: 100 }, (_, i) => filler(i)),
    ];
    const toolFile = writeJsonl(tmpRoot, ['scratch', 'window-tool.jsonl'], toolEntries);

    const messageEntries = [
      assistant([textBlock('hidden message')], undefined, 1),
      ...Array.from({ length: 70 }, (_, i) => filler(i)),
    ];
    const messageFile = writeJsonl(tmpRoot, ['scratch', 'window-message.jsonl'], messageEntries);

    const usageEntries = [
      { message: { role: 'assistant', usage: { input_tokens: 7000, output_tokens: 700 } }, timestamp: 1 },
      ...Array.from({ length: 310 }, (_, i) => filler(i)),
    ];
    const usageFile = writeJsonl(tmpRoot, ['scratch', 'window-usage.jsonl'], usageEntries);
    const usageControlFile = writeJsonl(tmpRoot, ['scratch', 'window-usage-control.jsonl'], [
      { message: { role: 'assistant', usage: { input_tokens: 7000, output_tokens: 700 } }, timestamp: 1 },
    ]);

    expect((await detailOf(adapter, 'tool', null, toolFile)).toolHistory).toEqual([]);
    expect((await detailOf(adapter, 'message', null, messageFile)).messages).toEqual([]);
    expect((await detailOf(adapter, 'usage', null, usageFile)).tokenUsage).toEqual({
      totalInput: 0, totalOutput: 0, cacheRead: 0, cacheCreate: 0, contextWindow: 0, turnCount: 0,
    });
    // Control: unpadded, the same records resolve — so the zeros above are the
    // windows, not absent records.
    expect((await detailOf(adapter, 'control', null, usageControlFile)).tokenUsage).toEqual({
      totalInput: 7000, totalOutput: 700, cacheRead: 0, cacheCreate: 0, contextWindow: 7000, turnCount: 1,
    });
  });

  // Two truncation sites with different lengths for the same payload: the row's
  // `lastToolInput` caps `command` at 60 (claude.ts:54) and takes only the base
  // name of a `file_path` (claude.ts:55), while `getToolHistory` caps `command`
  // at 80 (claude.ts:115) and leaves `file_path` whole (claude.ts:116). `LONG_COMMAND`
  // is 80 chars, so a 60-char prefix is also a prefix of the 80-char answer and
  // only the length tells them apart.
  it('caps the row tool input at 60 and basename-izes file_path, where the detail keeps 80 and the whole path', async () => {
    expect(LONG_COMMAND).toHaveLength(80);
    const adapter = new ClaudeAdapter();
    const file = writeJsonl(tmpRoot, ['scratch', 'caps.jsonl'], [
      assistant([toolBlock('Bash', { command: LONG_COMMAND })], 'cap-model', 1),
      assistant([toolBlock('Read', { file_path: '/tmp/cv/deep/path/readme.md' })], 'cap-model', 2),
    ]);

    const detail = await detailOf(adapter, 'caps', null, file);
    // claude.ts:115-116 — 80 chars, and no basename.
    expect(detail.toolHistory).toEqual([
      { tool: 'Bash', detail: LONG_COMMAND, ts: 1 },
      { tool: 'Read', detail: '/tmp/cv/deep/path/readme.md', ts: 2 },
    ]);

    // The same file through the row's own 30-line detail read, where the
    // backwards walk meets line 2 first.
    const row = rowOf(await list(), 'ses-known');
    expect(row.lastTool).toBe('Read');
    expect(row.lastToolInput).toBe('known.txt');
    expect((await detailOf(adapter, 'ses-known', KNOWN_PROJECT)).toolHistory).toEqual([
      { tool: 'Read', detail: '/tmp/cv/known.txt', ts: 1 },
    ]);
  });

  // `getToolHistory`'s seven-branch input precedence (claude.ts:114-122), each
  // with a different cap: `command` 80, `file_path` whole, `pattern` whole,
  // `query` 60, `prompt` 60, `url` whole, `description` 60 — and the order,
  // since only the first present branch is read. The row's extractor
  // (claude.ts:53-59) has a DIFFERENT set: it reads `command`, `file_path`,
  // `pattern`, `query`, `recipient`, has no `prompt`/`url`/`description`, caps
  // `query` at 40, and basenames `file_path`. A WebFetch therefore leaves the
  // row's `lastToolInput` null while the detail reports its URL.
  it('reads each tool input field with its own cap, and differs between the row and the detail', async () => {
    const adapter = new ClaudeAdapter();
    const file = writeJsonl(tmpRoot, ['scratch', 'inputs.jsonl'], [
      // `command` wins over everything else in the same input object.
      assistant([toolBlock('T', { command: 'x'.repeat(120), file_path: '/tmp/cv/a.txt', pattern: 'p', query: 'q', recipient: 'r' })], 'm', 1),
      assistant([toolBlock('T', { file_path: '/tmp/cv/a.txt', pattern: 'p', query: 'q', recipient: 'r' })], 'm', 2),
      assistant([toolBlock('T', { pattern: 'p', query: 'q', recipient: 'r' })], 'm', 3),
      // `query` is the only one of these two branches with a cap.
      assistant([toolBlock('T', { query: `q${'7'.repeat(89)}`, recipient: 'r' })], 'm', 4),
      assistant([toolBlock('T', { recipient: 'r' })], 'm', 5),
      // `prompt` caps at 60 and, having won over `url` and `description`, hides
      // both of them.
      assistant([toolBlock('T', { prompt: 'p'.repeat(90), url: 'https://example.com/x', description: 'd'.repeat(90) })], 'm', 6),
      // `url` is uncapped; `description` caps at 60.
      assistant([toolBlock('T', { url: `https://example.com/${'u'.repeat(90)}` })], 'm', 7),
      assistant([toolBlock('T', { description: 'd'.repeat(90) })], 'm', 8),
      // No `name` at all: claude.ts:123 falls back to 'unknown'.
      assistant([toolBlock(undefined, { pattern: 'lonely' })], 'm', 9),
      // No timestamp: claude.ts:123 falls back to 0.
      { message: { role: 'assistant', content: [toolBlock('NoTs', { pattern: 'nots' })] } },
    ]);

    expect((await detailOf(adapter, 'inputs', null, file)).toolHistory).toEqual([
      { tool: 'T', detail: 'x'.repeat(80), ts: 1 },
      { tool: 'T', detail: '/tmp/cv/a.txt', ts: 2 },
      { tool: 'T', detail: 'p', ts: 3 },
      { tool: 'T', detail: `q${'7'.repeat(59)}`, ts: 4 },
      // `recipient` is not one of getToolHistory's seven fields, so the detail
      // stays '' here even though the row's extractor reads it.
      { tool: 'T', detail: '', ts: 5 },
      { tool: 'T', detail: 'p'.repeat(60), ts: 6 },
      { tool: 'T', detail: `https://example.com/${'u'.repeat(90)}`, ts: 7 },
      { tool: 'T', detail: 'd'.repeat(60), ts: 8 },
      { tool: 'unknown', detail: 'lonely', ts: 9 },
      { tool: 'NoTs', detail: 'nots', ts: 0 },
    ]);

    expect((await detailOf(adapter, 'inputs', null, file)).messages).toEqual([]);

    // The ROW's extractor, one session per input field so each is the newest
    // (and only) turn. Its field set differs from getToolHistory's: `recipient`
    // is read and `prompt`/`url`/`description` are not, `command` stops at 60
    // rather than 80, `query` at 40 rather than 60, and `file_path` is reduced to
    // its base name rather than kept whole.
    const ROW_CASES: [string, Record<string, unknown>, string | null][] = [
      ['command', { command: 'y'.repeat(70) }, 'y'.repeat(60)],
      ['file', { file_path: '/tmp/cv/deep/thing.txt' }, 'thing.txt'],
      ['pattern', { pattern: 'a'.repeat(70) }, 'a'.repeat(70)],
      ['query', { query: 'q'.repeat(70) }, 'q'.repeat(40)],
      ['recipient', { recipient: 'agent-b' }, 'agent-b'],
      ['url', { url: 'https://example.com/only' }, null],
    ];

    await withTempClaudeDir(async (Adapter, root) => {
      const now = Date.now();
      writeJsonl(root, ['history.jsonl'], ROW_CASES.map(([label], i) => ({
        sessionId: `row-${label}`, project: `/p-${label}`, timestamp: now - i * 1000, display: `d ${label}`,
      })));
      ROW_CASES.forEach(([label, input]) => {
        writeJsonl(root, ['projects', `-p-${label}`, `row-${label}.jsonl`], [assistant([toolBlock('Row', input)], 'm', 1)]);
      });

      const rows = await sessionsOf(new Adapter(), MINUTE);
      for (const [label, , expected] of ROW_CASES) {
        const row = rowOf(rows, `row-${label}`);
        expect(row.lastTool).toBe('Row');
        expect(row.lastToolInput).toBe(expected);
      }
      // Membership only: all six session files are written back to back, so
      // `lastActivity` is dominated by their mtimes and this listing's order says
      // nothing about the history order. The main-session sort is pinned by
      // "lists main sessions newest-first" instead.
      expect(rows.map((s: any) => s.sessionId).sort()).toEqual(
        ['row-command', 'row-file', 'row-pattern', 'row-query', 'row-recipient', 'row-url'].sort(),
      );
    });
  });

  // `getRecentMessages` has no role guard (claude.ts:138-140): user turns are
  // included, and only an empty/whitespace-only text block is dropped. Its
  // `maxItems` of 5 is applied as `slice(-5)` over a FORWARD walk, so the
  // OLDEST of the six texts is the one dropped — the same direction
  // `getToolHistory` uses for its 15.
  it('keeps the last 5 messages and the last 15 tools, dropping the oldest of each', async () => {
    const adapter = new ClaudeAdapter();
    const entries: unknown[] = [];
    for (let i = 1; i <= 20; i++) {
      entries.push(assistant([toolBlock(`tool_${String(i).padStart(2, '0')}`, { pattern: `p${i}` })], 'm', 100 + i));
    }
    for (let i = 1; i <= 6; i++) {
      entries.push({ message: { role: i % 2 === 0 ? 'user' : 'assistant', content: [textBlock(`msg ${i}`)] }, timestamp: 200 + i });
    }
    const file = writeJsonl(tmpRoot, ['scratch', 'maxitems.jsonl'], entries);

    const detail = await detailOf(adapter, 'maxitems', null, file);
    expect(detail.toolHistory).toHaveLength(15);
    expect(detail.toolHistory[0]).toEqual({ tool: 'tool_06', detail: 'p6', ts: 106 });
    expect(detail.toolHistory[14]).toEqual({ tool: 'tool_20', detail: 'p20', ts: 120 });
    expect(detail.messages).toHaveLength(5);
    expect(detail.messages.map((m: any) => m.text)).toEqual(['msg 2', 'msg 3', 'msg 4', 'msg 5', 'msg 6']);
    // No usage record anywhere in this file.
    expect(detail.tokenUsage).toEqual({
      totalInput: 0, totalOutput: 0, cacheRead: 0, cacheCreate: 0, contextWindow: 0, turnCount: 0,
    });
  });

  // `getTokenUsage` walks the window FORWARD and sums every `message.usage`,
  // counting each as a turn, but `contextWindow` comes from the LAST turn only —
  // input + cache_read + cache_creation, output excluded.
  it('sums token usage over its window, with contextWindow from the last turn', async () => {
    const adapter = new ClaudeAdapter();
    const file = writeJsonl(tmpRoot, ['scratch', 'usage.jsonl'], [
      { message: { role: 'assistant', usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 1 } }, timestamp: 1 },
      { message: { role: 'assistant', usage: { input_tokens: 200, output_tokens: 20, cache_read_input_tokens: 6, cache_creation_input_tokens: 2 } }, timestamp: 2 },
      // No usage at all — not a turn.
      { message: { role: 'user', content: [textBlock('hello')] }, timestamp: 3 },
      // Partial usage: the missing fields default to 0 and the turn still counts.
      { message: { role: 'assistant', usage: {} }, timestamp: 4 },
    ]);

    // `lastUsage` is overwritten by EVERY turn that carries a `usage` object
    // (claude.ts:180), so the trailing empty one decides contextWindow and zeros
    // it — the sums still include the two populated turns.
    expect((await detailOf(adapter, 'usage-sum', null, file)).tokenUsage).toEqual({
      totalInput: 300,
      totalOutput: 30,
      cacheRead: 11,
      cacheCreate: 3,
      contextWindow: 0,
      turnCount: 3,
    });

    // Control: the same file without the trailing empty turn reports the LAST
    // populated turn's context, and `output_tokens` is excluded from it.
    const controlFile = writeJsonl(tmpRoot, ['scratch', 'usage-control.jsonl'], [
      { message: { role: 'assistant', usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 1 } }, timestamp: 1 },
      { message: { role: 'assistant', usage: { input_tokens: 200, output_tokens: 20, cache_read_input_tokens: 6, cache_creation_input_tokens: 2 } }, timestamp: 2 },
    ]);
    expect((await detailOf(adapter, 'usage-control', null, controlFile)).tokenUsage).toEqual({
      totalInput: 300,
      totalOutput: 30,
      cacheRead: 11,
      cacheCreate: 3,
      contextWindow: 208,
      turnCount: 2,
    });
  });

  // The public `getSessionDetail` resolves the file itself when no `filePath` is
  // given: a main session by id and project, and a SUB-AGENT by its
  // `subagent-<id>` id, which is the only path that walks the session
  // directories looking for `subagents/agent-<id>.jsonl` (claude.ts:201-213).
  it('resolves a sub-agent detail by its subagent- id and project', async () => {
    const adapter = new ClaudeAdapter();

    const viaId = await detailOf(adapter, `subagent-${A1}`, STALE_PROJECT);
    expect(viaId.sessionId).toBe(`subagent-${A1}`);
    expect(viaId.toolHistory).toEqual([{ tool: 'Task', detail: 'do-the-thing', ts: 11 }]);
    expect(viaId.messages).toEqual([{ role: 'assistant', text: 'sub one done', ts: 11 }]);
    expect(viaId.tokenUsage).toEqual({
      totalInput: 0, totalOutput: 0, cacheRead: 0, cacheCreate: 0, contextWindow: 0, turnCount: 0,
    });

    // The agent file really is reached through the stale donor's directory name,
    // not through a `project` that any active session reported.
    const viaWrongProject = await detailOf(adapter, `subagent-${A1}`, ALPHA_PROJECT);
    expect(viaWrongProject).toEqual({ toolHistory: [], messages: [] });
  });

  // The miss path returns a bare two-key object — no `tokenUsage`, no `sessionId`
  // (claude.ts:467) — and three different ways of missing all land on it: no
  // project at all, an id with no file, and a project whose encoding names no
  // directory.
  it('returns the bare miss shape for every unresolvable session', async () => {
    const adapter = new ClaudeAdapter();
    for (const [id, project] of [
      ['ses-alpha', null],
      ['ses-does-not-exist', ALPHA_PROJECT],
      ['ses-alpha', '/tmp/cv/no-such-project'],
      ['subagent-does-not-exist', STALE_PROJECT],
    ] as const) {
      const detail = await detailOf(adapter, id, project);
      expect(detail).toEqual({ toolHistory: [], messages: [] });
      expect('tokenUsage' in detail).toBe(false);
      expect('sessionId' in detail).toBe(false);
    }
    // An explicit `filePath` short-circuits the lookup entirely, including the
    // `project === null` early return.
    const scratch = writeJsonl(tmpRoot, ['scratch', 'direct.jsonl'], [
      assistant([textBlock('direct read')], 'direct-model', 7),
    ]);
    expect((await detailOf(adapter, 'anything', null, scratch)).messages).toEqual([
      { role: 'assistant', text: 'direct read', ts: 7 },
    ]);
  });

  // `getTeams` reads `teams/<name>/config.json` and spreads the parsed config
  // over the directory name (claude.ts:533). A missing config is dropped
  // silently (the ENOENT branch, claude.ts:535); any other failure — here a
  // syntax error — becomes a row carrying `error: 'parse failed'` and nothing
  // else. Sorted here only because readdir order is not part of the contract.
  it('reads teams, dropping configs that are missing and flagging ones that will not parse', async () => {
    const teams = await new ClaudeAdapter().getTeams();
    expect([...teams].sort((a: any, b: any) => a.teamName.localeCompare(b.teamName))).toEqual([
      { teamName: 'alpha-team', description: 'Alpha team', members: ['ann', 'bo'], lead: 'ann' },
      { teamName: 'broken-team', error: 'parse failed' },
    ]);
    expect(teams.some((t: any) => t.teamName === 'no-config-team')).toBe(false);
    expect(teams.some((t: any) => t.teamName === 'loose.txt')).toBe(false);
  });

  // `getTasks` returns one row per directory under `tasks/`, with its `*.json`
  // files parsed verbatim and sorted ASCENDING by `Number(id || 0)` — so a task
  // with no id sorts as 0, i.e. FIRST (claude.ts:573). `count` is the number of
  // tasks that parsed, not the number of files.
  it('reads task groups sorted by numeric id, with a missing id sorting first', async () => {
    const groups = await new ClaudeAdapter().getTasks();
    expect([...groups].sort((a: any, b: any) => a.groupName.localeCompare(b.groupName))).toEqual([
      {
        groupName: 'group-one',
        tasks: [
          { id: 1, subject: 'first', status: 'done' },
          { id: 2, subject: 'second', status: 'pending' },
        ],
        count: 2,
      },
      {
        groupName: 'group-two',
        // No `id` first, then 7 — not file order.
        tasks: [{ subject: 'no id here' }, { id: 7, subject: 'seven' }],
        count: 2,
      },
    ]);
  });

  // Both `teams/` and `tasks/` are optional: `readdir` on a missing directory
  // raises ENOENT, which the outer catch turns into an empty list (claude.ts:543,
  // :584). Every other fixture runs against a tree that has both.
  it('returns empty teams and tasks when the directories are absent', async () => {
    await withTempClaudeDir(async (Adapter, root) => {
      writeJsonl(root, ['history.jsonl'], []);
      const adapter = new Adapter();
      expect(await adapter.getTeams()).toEqual([]);
      expect(await adapter.getTasks()).toEqual([]);
      // An empty history.jsonl is not an error either: `readLines` short-circuits
      // on `stat.size === 0`.
      expect(await sessionsOf(adapter, MINUTE)).toEqual([]);
    });
  });

  // ─── #144: a DIRECTORY whose NAME matches a session-file filter ───
  //
  // The three file-level listings below — `subagents/agent-*.jsonl` (claude.ts:133),
  // `projects/<proj>/*.jsonl` (claude.ts:201) and `tasks/<group>/*.json`
  // (claude.ts:339) — are read with a BARE `readdir`, so the entries arrive as
  // `string[]` and the filter can ask about the NAME and nothing else. A DIRECTORY
  // named to match therefore passes the filter, `stat`s successfully, and is
  // emitted as a real row. Each case below pins the fix at its own site: drop that
  // site's `isFile()` term and the case goes red again.
  //
  // Every decoy is an EMPTY directory. An empty directory still `stat`s (size 64),
  // which is what makes the defect observable, and `readLines` swallows the EISDIR
  // (jsonl-utils.ts:57) — so the failure is silent and the row just has null detail.

  // Site 1 — claude.ts:133. The decoy becomes a `sub-agent` row.
  it('emits no sub-agent row for a directory named agent-*.jsonl', async () => {
    await withTempClaudeDir(async (Adapter, root) => {
      writeJsonl(root, ['history.jsonl'], []);
      writeJsonl(root, ['projects', '-p', 'ses-parent', 'subagents', 'agent-real.jsonl'], [
        assistant([textBlock('real sub')], 'real-sub-model', 1),
      ]);
      const decoy = mkdir(root, ['projects', '-p', 'ses-parent', 'subagents', 'agent-dirdecoy.jsonl']);

      // Nothing else exists in this tree, so the listing is an exact set.
      const rows = await sessionsOf(new Adapter(), 10 * MINUTE);
      expect(rows.map((r: any) => r.sessionId)).toEqual(['subagent-real']);
      // …and the decoy really is a directory, so the exact set above is the
      // `isFile()` guard rather than a missing fixture.
      expect(fs.statSync(decoy).isDirectory()).toBe(true);
    });
  });

  // Site 2 — claude.ts:201. The decoy becomes a `team-member` row. The real
  // sibling file exercises the filter's other half: without `isFile()` the set
  // gains the decoy, and the real row proves the filter still admits files.
  it('emits no team-member row for a directory named *.jsonl under a project', async () => {
    await withTempClaudeDir(async (Adapter, root) => {
      writeJsonl(root, ['history.jsonl'], []);
      writeJsonl(root, ['projects', '-p', 'orph-real.jsonl'], [
        assistant([textBlock('real orphan')], 'real-orphan-model', 1),
      ]);
      const decoy = mkdir(root, ['projects', '-p', 'orph-dirdecoy.jsonl']);

      const rows = await sessionsOf(new Adapter(), 10 * MINUTE);
      expect(rows.map((r: any) => r.sessionId)).toEqual(['orph-real']);
      expect(fs.statSync(decoy).isDirectory()).toBe(true);
    });
  });

  // Site 3 — claude.ts:339. This one SELF-NEUTRALISES: `readFile` on a directory
  // raises EISDIR, the `getTasks read/parse task` catch swallows it and returns
  // null (claude.ts:346), and `tasks` is filtered — so `count` is 1 either way and
  // a row-count assertion CANNOT be made red. The observable is whether the
  // adapter ATTEMPTED the read at all, which is exactly what the `isFile()` term
  // decides. Both halves are asserted: the row set (which documents the
  // self-neutralisation) and the empty envelope.
  it('reads no task through a directory named *.json, and does not try to read it', async () => {
    await withTempClaudeDir(async (Adapter, root) => {
      writeJsonl(root, ['history.jsonl'], []);
      mkdir(root, ['tasks', 'group-one']);
      writeText(root, ['tasks', 'group-one', 'task-1.json'], JSON.stringify({ id: 1, subject: 'real' }));
      const decoy = mkdir(root, ['tasks', 'group-one', 'task-2.json']);

      const { result, lines } = await withDebug(() => new Adapter().getTasks());

      expect(result).toEqual([
        { groupName: 'group-one', tasks: [{ id: 1, subject: 'real' }], count: 1 },
      ]);
      // No `getTasks read/parse task` envelope for ANY entry: the decoy is dropped
      // by `isFile()` before the read, not rescued by the catch after it.
      expect(lines.filter((l) => l.includes('getTasks read/parse task'))).toEqual([]);
      expect(fs.statSync(decoy).isDirectory()).toBe(true);
    });
  });
});