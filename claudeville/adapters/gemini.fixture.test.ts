/**
 * Characterization test for the gemini adapter.
 *
 * gemini.test.ts is 524 lines / 29 tests, but it is the same shape
 * copilot.test.ts had before copilot.fixture.test.ts existed: it redefines
 * readLines / parseJsonLines / readJsonFile inline and asserts against those
 * copies (lines 32, 37, 47, 107, 176, 250, 322, 396 all declare a local copy),
 * so it would stay green through an arbitrary rewrite of the shipped adapter.
 * Only its two `gemini token usage` cases (lines 494-523) touch shipped code at
 * all, and both are single happy paths — so no truncation cap, no maxItems
 * slice, no line window, no name filter and no mtime threshold is pinned
 * anywhere in the suite.
 *
 * This file drives the SHIPPED GeminiAdapter against a synthetic ~/.gemini tree
 * so that the conversion to the shared pipeline helpers (foldEntries /
 * collectJsonl / collectScanByMtime) can be verified as behaviour-preserving
 * rather than merely asserted to be.
 *
 * The load-bearing case is the TWO SHAPES gemini reads. All four of its readers
 * (parseSession, getToolHistory, getRecentMessages, getTokenUsage) open a
 * session as EITHER a `.jsonl` file it tail-reads as lines OR a `.json` file
 * whose `messages` array it has already parsed — the same eight lines,
 * copy-pasted at gemini.ts:156, :227, :282 and :366. So the fold has to run over
 * an in-memory entry list, not over a JSONL stream: `foldJsonl` cannot read a
 * `.json` session at all, and a conversion that reached for it would return an
 * empty fold for every JSON-format gemini session while leaving every JSONL one
 * working. Several cases below therefore exist in BOTH shapes, written from the
 * same records.
 *
 * The second trap is walk DIRECTION, and gemini does the opposite of codex on
 * every reader: parseSession walks its window BACKWARDS (gemini.ts:169, so the
 * row takes the NEWEST tool and message) while getToolHistory and
 * getRecentMessages walk FORWARD and keep the LAST 15 tools / LAST 5 messages
 * via `slice(-maxItems)`. "last N" reads the same in both cases; the difference
 * is only visible where a window holds more than one candidate, which is what
 * the 20-tool / 8-message fixture below is for.
 *
 * Deliberately NOT pinned:
 *
 * - `resolveProjectPath`'s candidate list (gemini.ts:56-124) and its LRU
 *   `_hashToPathCache`. The reverse SHA-256 mapping is exercised for its two
 *   OBSERVABLE outcomes only — a directory that resolves (the inherited first
 *   case) and a hash that does not (`project: null`). The candidates in between
 *   (cwd basename, ~11 home subdirectories two levels deep, `~/.claude/projects`
 *   names) read the real $HOME, so pinning them would make this suite depend on
 *   the machine it runs on. The cache's eviction (1000 entries, 20% oldest
 *   first) is likewise unreachable from 6 fixtures and memoizes a pure function
 *   of (hash, cwd), so it cannot change a result.
 * - `scanActiveSessions`'s per-child error handling. Its readdir / stat catches
 *   are reached by permissions and races this fixture will not manufacture;
 *   what IS observable — the mtime threshold and the `session-` name filter —
 *   is pinned.
 *
 * Three further spots are PROVABLY unobservable and so are deliberately left
 * unpinned rather than merely missed. A 63-mutation sweep confirmed it: each was
 * green in every direction tried.
 *
 * - `if (detail.lastMessage && detail.model) break;` (gemini.ts:212). Every write
 *   in the loop already sits behind a `!detail.x` guard, so once both fields are
 *   set nothing later in the window can change them; the early exit is an
 *   optimisation, not a behaviour.
 * - `!detail.lastMessage` on the row's message (gemini.ts:180). Dropping it is
 *   invisible for the same reason: the break on the very next line fires on the
 *   same iteration, so the oldest gemini record in the window never gets a turn.
 * - `Array.isArray(session.messages)` (gemini.ts:161). `session.messages || []`
 *   is equivalent here, because a non-array truthy value throws inside the very
 *   `try` that already discards the reader's output, and a falsy one becomes the
 *   same empty array.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let tmpHome = '';
let workspaceDir = '';
let projectHash = '';
let GeminiAdapter: any;
const originalHome = process.env.HOME;

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}

/** Writes the `.jsonl` shape — one record per line, newline-terminated. */
function writeJsonl(filePath: string, entries: unknown[]) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return filePath;
}

/** Writes the `.json` shape — one document whose `messages` array holds them. */
function writeSessionJson(filePath: string, messages: unknown[]) {
  writeJson(filePath, { sessionId: path.basename(filePath), projectHash, messages });
  return filePath;
}

/**
 * Detail fixtures live OUTSIDE ~/.gemini/tmp so they cannot perturb the listing
 * or the watch paths, which the three inherited cases assert exactly. A test that
 * needs a session LISTED writes into a chats directory and removes it again in a
 * `finally`, so the file is order-independent under --sequence.shuffle.
 */
function scratchDir() {
  return fs.mkdtempSync(path.join(tmpHome, 'scratch-'));
}

/** A chats directory whose project hash resolves to nothing (see the header). */
const unresolvedChatsDir = () =>
  path.join(
    tmpHome,
    '.gemini',
    'tmp',
    crypto.createHash('sha256').update(path.join(tmpHome, 'nowhere-at-all')).digest('hex'),
    'chats',
  );

const MINUTE = 60 * 1000;

/** A LISTING fixture for one test body: `.jsonl` / `.json` writers plus a remover. */
function listedSessions() {
  const dir = unresolvedChatsDir();
  fs.mkdirSync(dir, { recursive: true });
  return {
    dir,
    remove: () => fs.rmSync(path.dirname(dir), { recursive: true, force: true }),
    jsonl: (id: string, entries: unknown[]) =>
      writeJsonl(path.join(dir, `session-${id}.jsonl`), entries),
    json: (id: string, messages: unknown[]) =>
      writeSessionJson(path.join(dir, `session-${id}.json`), messages),
  };
}

/**
 * gemini.ts:410 strips `session-` and `.json` — and `.json` is a SUBSTRING of
 * `.jsonl`, not a suffix, so a jsonl session loses its `l`:
 * `session-shape1.jsonl` → `gemini-shape1l`. The listing (gemini.ts:410) and the
 * id-only rescan (gemini.ts:447) derive it the same way, so the two agree and a
 * lookup still resolves. Pinned as-is; see the report.
 */
const sessionIdOf = (fileName: string) =>
  `gemini-${fileName.replace('session-', '').replace('.json', '')}`;

const T0 = Date.UTC(2024, 0, 1, 0, 0, 0);
const at = (i: number) => new Date(T0 + i * 1000).toISOString();
const tsOf = (i: number) => new Date(at(i)).getTime();

/**
 * Padding that widens a file without contributing anything: getRecentMessages
 * skips `info` and reads no `content` from a filler, getToolHistory recognises
 * only `gemini.toolCalls` and `tool_call`, parseSession only `gemini` /
 * `tool_call`, and the token fold only `tokens`.
 */
const filler = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ type: 'filler', i: from + i }));

const geminiMsg = (text: string, i: number, extra: Record<string, unknown> = {}) => ({
  type: 'gemini',
  model: 'gemini-2.5-pro',
  content: text,
  timestamp: at(i),
  ...extra,
});

/** A `tool_call` record — the second of the two shapes gemini reads tools from. */
const toolCall = (name: string, input: unknown, i: number) => ({
  type: 'tool_call',
  name,
  input,
  timestamp: at(i),
});

/**
 * Over-long payloads, one per truncation site. `LONG_ARGS_JSON` is 138 chars, so
 * the 60-char and 80-char prefixes are told apart by LENGTH and not only by
 * prefix — a 60-char result is itself a prefix of the 80-char one.
 *   gemini.ts:193/195  parseSession lastToolInput  60  (command / JSON.stringify)
 *   gemini.ts:184      parseSession lastMessage    80
 *   gemini.ts:243/245  getToolHistory detail       80  (command / JSON.stringify)
 *   gemini.ts:300      getRecentMessages text     200
 * The `file_path` branches (gemini.ts:194 and :244) are the two uncapped sites.
 */
const LONG_COMMAND = 'c'.repeat(100);
const LONG_PATH = '/very/long/path/' + 'p'.repeat(120); // 16 + 120 = 136 chars
const LONG_ARGS = { path: 'p'.repeat(30), q: 'q'.repeat(90) };
const LONG_ARGS_JSON = JSON.stringify(LONG_ARGS);
const LONG_TEXT = 'z'.repeat(260);

/**
 * The token records, reused verbatim for the `.jsonl` and the `.json` shape.
 * Hand-summed: input 1000 + 1200 + 5 = 2205, output 10 + 30 + 0 = 40. The last
 * gemini record carries `cached` / `thoughts` / `total` but no `input` or
 * `output`, so a fold that also summed `total` would answer 3243 and is caught.
 */
const TOKEN_RECORDS = [
  { type: 'info', content: 'session header', timestamp: at(0) },
  geminiMsg('first answer', 1, { tokens: { input: 1000, output: 10, cached: 7, thoughts: 3, total: 1013 } }),
  { type: 'user', content: 'second question', timestamp: at(2) },
  geminiMsg('second answer', 3, { tokens: { input: 1200, output: 30, total: 1230 } }),
  geminiMsg('third answer', 4, { tokens: { input: 5, output: 0 } }),
  geminiMsg('no counts here', 5, { tokens: { cached: 99, thoughts: 99, total: 999 } }),
];

/**
 * The typeof-guard records. Only numeric fields count: `input: '1000'` and
 * `output: '10'` are each rejected outright WHILE the numeric field beside them
 * is still taken (gemini.ts:382 and :386 are independent tests, not one `if`), a
 * missing `output` simply contributes 0, and a record whose `tokens` is falsy —
 * null, absent, 0 — is skipped by `!tokens` (gemini.ts:381) before either typeof
 * check is reached. Hand-summed: 2000 / 10.
 */
const GUARD_RECORDS = [
  geminiMsg('string input rejected', 1, { tokens: { input: '1000', output: 10 } }),
  geminiMsg('string output rejected', 2, { tokens: { output: '10' } }),
  geminiMsg('missing output', 3, { tokens: { input: 2000 } }),
  geminiMsg('tokens null', 4, { tokens: null }),
  geminiMsg('no tokens key', 5),
  geminiMsg('falsy tokens', 6, { tokens: 0 }),
];

/** Nothing here carries `tokens`, so the fold has nothing to report. */
const NO_TOKEN_RECORDS = [
  { type: 'info', content: 'session header', timestamp: at(0) },
  { type: 'user', content: 'hello', timestamp: at(1) },
  geminiMsg('hi', 2),
];

describe('GeminiAdapter fixtures', () => {
  beforeAll(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeville-gemini-'));
    workspaceDir = path.join(tmpHome, 'workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });

    projectHash = crypto.createHash('sha256').update(workspaceDir).digest('hex');
    const sessionFile = path.join(tmpHome, '.gemini', 'tmp', projectHash, 'chats', 'session-abc.json');
    writeJson(sessionFile, {
      sessionId: 'session-abc',
      projectHash,
      messages: [
        { type: 'info', content: 'ignored' },
        {
          type: 'gemini',
          model: 'gemini-2.5-pro',
          content: 'Planning update',
          toolCalls: [
            { name: 'read_file', args: { file_path: '/tmp/workspace/report.md' } },
          ],
          timestamp: '2024-01-01T00:00:01Z',
        },
        {
          type: 'tool_call',
          name: 'shell',
          input: { command: 'npm test' },
          timestamp: '2024-01-01T00:00:02Z',
        },
      ],
    });

    process.env.HOME = tmpHome;
    vi.resetModules();
    ({ GeminiAdapter } = await import('./gemini.js'));
  });

  afterAll(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('parses active sessions, resolves the project path, and exposes detail data', async () => {
    const adapter = new GeminiAdapter();

    expect(adapter.isAvailable()).toBe(true);

    const sessions = await adapter.getActiveSessions(5 * 60 * 1000);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: 'gemini-abc',
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      lastMessage: 'Planning update',
      lastTool: 'shell',
      lastToolInput: '{"command":"npm test"}',
      project: workspaceDir,
    });

    const detail = await adapter.getSessionDetail(sessions[0].sessionId, sessions[0].project, sessions[0].filePath);
    expect(detail.toolHistory).toHaveLength(2);
    expect(detail.toolHistory[0]).toMatchObject({ tool: 'read_file' });
    expect(detail.messages).toEqual([
      expect.objectContaining({ role: 'assistant', text: 'Planning update' }),
    ]);
  });

  it('returns empty detail for unknown session ids', async () => {
    const adapter = new GeminiAdapter();
    await expect(adapter.getSessionDetail('gemini-missing', workspaceDir)).resolves.toEqual({
      toolHistory: [],
      messages: [],
    });
  });

  it('advertises the underlying chats directory as a watch path', () => {
    const adapter = new GeminiAdapter();
    expect(adapter.getWatchPaths()).toEqual([
      {
        type: 'directory',
        path: path.join(tmpHome, '.gemini', 'tmp', projectHash, 'chats'),
        filter: '.json',
      },
      {
        type: 'directory',
        path: path.join(tmpHome, '.gemini', 'tmp', projectHash, 'chats'),
        filter: '.jsonl',
      },
    ]);
  });

  // ─── getActiveSessions: row field set, id derivation, project resolution ───

  // The full 13-key row, pinned exactly. `project` is null because this fixture's
  // test home has no directory whose SHA-256 is this hash, which is the documented
  // failure outcome (gemini.ts:122): the raw hash is never surfaced to the UI.
  it('reports the full row field set, with a null project for an unresolvable hash', async () => {
    const adapter = new GeminiAdapter();
    const listed = listedSessions();
    const file = listed.jsonl('delta1', [geminiMsg('delta done', 1)]);

    try {
      const row = (await adapter.getActiveSessions(5 * MINUTE)).find(
        (s: any) => s.sessionId === 'gemini-delta1l',
      );
      expect(row).toEqual({
        // gemini.ts:410 — see sessionIdOf: the `.jsonl` loses its `l`.
        sessionId: 'gemini-delta1l',
        provider: 'gemini',
        agentId: null,
        agentType: 'main',
        model: 'gemini-2.5-pro',
        status: 'active',
        // The file's own mtime, read back from disk — the row must report the
        // stat the scan took, not a placeholder.
        lastActivity: fs.statSync(file).mtimeMs,
        project: null,
        lastMessage: 'delta done',
        // Only a user record and a gemini record here, so no tool is ever seen.
        lastTool: null,
        lastToolInput: null,
        parentSessionId: null,
        filePath: file,
      });
    } finally {
      listed.remove();
    }
  });

  // The id derivation itself, from the FILE NAME. `.replace('.json','')` is a
  // substring replace, so `session-shape1.jsonl` → `gemini-shape1l` while
  // `session-shape2.json` → `gemini-shape2`. A `.replace('.jsonl','')` "fix"
  // would answer `gemini-shape1` and is caught here.
  it('derives the session id from the file name, eating the l of .jsonl', async () => {
    const adapter = new GeminiAdapter();
    const listed = listedSessions();

    try {
      listed.jsonl('shape1', [geminiMsg('from jsonl', 1)]);
      listed.json('shape2', [geminiMsg('from json', 1)]);

      const ids = (await adapter.getActiveSessions(5 * MINUTE)).map((s: any) => s.sessionId);
      expect(ids).toContain('gemini-shape1l');
      expect(ids).toContain('gemini-shape2');

      // Derive the expectation from the file name rather than trusting the literal.
      expect(sessionIdOf('session-shape1.jsonl')).toBe('gemini-shape1l');
      expect(sessionIdOf('session-shape2.json')).toBe('gemini-shape2');
    } finally {
      listed.remove();
    }
  });

  // gemini.ts:418 falls back to a bare `gemini`, which is how a session whose
  // records name no model at all is displayed.
  it('falls back to model "gemini" when no record names one', async () => {
    const adapter = new GeminiAdapter();
    const listed = listedSessions();
    listed.jsonl('nomod1', [{ type: 'user', content: 'no model here', timestamp: at(1) }]);

    try {
      const row = (await adapter.getActiveSessions(5 * MINUTE)).find(
        (s: any) => s.sessionId === 'gemini-nomod1l',
      );
      // `lastMessage` is null, not '': parseSession only ever writes the field
      // from a `gemini` record's content, and there is none here.
      expect(row).toMatchObject({ model: 'gemini', lastMessage: null, lastTool: null });
    } finally {
      listed.remove();
    }
  });

  // scanActiveSessions stats every candidate and drops anything older than the
  // threshold (gemini.ts:333). Eight minutes against 5- and 10-minute windows
  // straddles the comparison with minutes of margin on each side, and pins the
  // SIGN: `mtimeMs - now > threshold` would admit every stale session here.
  it('filters sessions by mtime against the supplied threshold', async () => {
    const adapter = new GeminiAdapter();
    const listed = listedSessions();
    const stale = listed.json('stale1', [geminiMsg('stale answer', 1)]);
    listed.json('fresh1', [geminiMsg('fresh answer', 1)]);
    const eightMinutesAgo = new Date(Date.now() - 8 * MINUTE);
    fs.utimesSync(stale, eightMinutesAgo, eightMinutesAgo);

    try {
      const narrow = (await adapter.getActiveSessions(5 * MINUTE)).map((s: any) => s.sessionId);
      expect(narrow).not.toContain('gemini-stale1');
      expect(narrow).toContain('gemini-fresh1');
      // The inherited base fixture is seconds old, so it is inside both windows.
      expect(narrow).toContain('gemini-abc');

      const wide = await adapter.getActiveSessions(10 * MINUTE);
      const wideIds = wide.map((s: any) => s.sessionId);
      expect(wideIds).toContain('gemini-stale1');
      expect(wideIds).toContain('gemini-fresh1');
      expect(wideIds).toContain('gemini-abc');
      // Newest first (gemini.ts:430). Only the two extremes are asserted, because
      // `fresh1` and the base fixture `abc` are both seconds old and their
      // relative order is not something the fixture controls.
      expect(wideIds[0]).toBe('gemini-fresh1');
      expect(wideIds[wideIds.length - 1]).toBe('gemini-stale1');
      expect(wide[0].lastActivity).toBeGreaterThan(wide[wide.length - 1].lastActivity);
    } finally {
      listed.remove();
    }
  });

  // gemini.ts:328 lists a file only when it both starts with `session-` and ends
  // with `.json` or `.jsonl`. `session-keep1.jsonl.bak` CONTAINS `.jsonl` but does
  // not end with it, so an `includes` filter would admit it; `other-prefix.json`
  // ends with `.json` but does not start with `session-`, so dropping the prefix
  // test would admit it. The listing is exactly three sessions long, so a leak
  // cannot hide.
  it('lists only session- files ending in .json or .jsonl', async () => {
    const adapter = new GeminiAdapter();
    const listed = listedSessions();
    listed.json('keep1', [geminiMsg('kept', 1)]);
    listed.jsonl('keep2', [geminiMsg('also kept', 1)]);
    // Siblings the name filter must reject. `other-prefix.json` ends with `.json`
    // but does not start with `session-`, so `listed.json` would defeat the point.
    writeSessionJson(path.join(listed.dir, 'other-prefix.json'), [geminiMsg('json sibling', 1)]);
    fs.writeFileSync(path.join(listed.dir, 'session-keep1.jsonl.bak'), 'not jsonl\n');
    fs.writeFileSync(path.join(listed.dir, 'session-keep1.json.backup'), 'not json\n');
    fs.writeFileSync(path.join(listed.dir, 'notes.txt'), 'ignored\n');
    fs.writeFileSync(path.join(listed.dir, 'session-keep1.txt'), 'ignored\n');
    fs.writeFileSync(path.join(listed.dir, 'session-keep1'), 'no extension\n');

    try {
      const ids = (await adapter.getActiveSessions(5 * MINUTE)).map((s: any) => s.sessionId);
      expect(ids).toHaveLength(3);
      expect(ids).toEqual(expect.arrayContaining(['gemini-keep1', 'gemini-keep2l', 'gemini-abc']));
    } finally {
      listed.remove();
    }
  });

  // ─── Walk direction and maxItems ───────────────────────────

  // getToolHistory keeps the LAST 15 tools and getRecentMessages the LAST 5
  // messages, both applied as `slice(-maxItems)` over a FORWARD walk, so the
  // OLDEST entries are the ones dropped and the surviving order is file order,
  // not reverse.
  //
  // Only the `.json` session can pin the 5-message slice at all:
  // getRecentMessages reads the last 20 LINES (gemini.ts:283), and a file holding
  // 20 tools and 8 messages puts every one of those messages outside the window.
  // The `.json` path parses the whole `messages` array and has no window, so
  // `maxItems` on the JSON path is reachable only here — a conversion that
  // applied the slice on the jsonl branch alone would pass a jsonl-only fixture.
  it('keeps the last 15 tools and 5 messages, and the jsonl window hides the messages', async () => {
    const adapter = new GeminiAdapter();
    const scratch = scratchDir();
    const records = [
      ...Array.from({ length: 8 }, (_, i) => geminiMsg(`msg ${i + 1}`, i + 1)),
      ...Array.from({ length: 20 }, (_, i) => toolCall(`tool_${String(i).padStart(2, '0')}`, { n: i }, 20 + i)),
    ];
    const jsonlFile = writeJsonl(path.join(scratch, 'session-eta1.jsonl'), records);
    const jsonFile = writeSessionJson(path.join(scratch, 'session-eta1.json'), records);

    const expectedTools = Array.from({ length: 15 }, (_, i) => `tool_${String(i + 5).padStart(2, '0')}`);
    const expectedMessages = [
      // `msg N` was written with `at(N)`, so msg 4 carries tsOf(4).
      { role: 'assistant', text: 'msg 4', ts: tsOf(4) },
      { role: 'assistant', text: 'msg 5', ts: tsOf(5) },
      { role: 'assistant', text: 'msg 6', ts: tsOf(6) },
      { role: 'assistant', text: 'msg 7', ts: tsOf(7) },
      { role: 'assistant', text: 'msg 8', ts: tsOf(8) },
    ];

    try {
      // The `.json` session: the whole array, so both slices bite. Forward walk,
      // file order preserved, oldest 5 tools and oldest 3 messages dropped.
      const fromJson = await adapter.getSessionDetail('gemini-eta1', null, jsonFile);
      expect(fromJson.toolHistory).toHaveLength(15);
      expect(fromJson.toolHistory.map((t: any) => t.tool)).toEqual(expectedTools);
      expect(fromJson.toolHistory[0].detail).toBe('{"n":5}');
      expect(fromJson.toolHistory[14]).toEqual({ tool: 'tool_19', detail: '{"n":19}', ts: tsOf(39) });
      expect(fromJson.messages).toEqual(expectedMessages);

      // The same records as a `.jsonl` session: getToolHistory's 100-line window
      // holds all 28 lines, so its slice is identical — but getRecentMessages'
      // 20-line window holds records 8..27, which are all tools, so the messages
      // are gone entirely. Not a missing slice: the WINDOW. (Pinned as-is; see
      // the report — a jsonl session whose tool calls outnumber its recent
      // messages shows no conversation at all.)
      const fromJsonl = await adapter.getSessionDetail('gemini-eta1', null, jsonlFile);
      expect(fromJsonl.toolHistory).toEqual(fromJson.toolHistory);
      expect(fromJsonl.messages).toEqual([]);
      // No record here carries `tokens`, on either path.
      expect(fromJsonl.tokenUsage).toBeNull();
      expect(fromJson.tokenUsage).toBeNull();
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  // The row's backwards walk, which needs the session LISTED. Same 20-tool /
  // 8-message shape as the case above, so the contrast with the detail readers
  // is direct: newest for the row, last-15 / last-5 for the detail.
  it('gives the session row the newest tool and message, not the oldest', async () => {
    const adapter = new GeminiAdapter();
    const listed = listedSessions();
    listed.jsonl('dir1', [
      ...Array.from({ length: 8 }, (_, i) => geminiMsg(`msg ${i + 1}`, i + 1)),
      ...Array.from({ length: 20 }, (_, i) => toolCall(`tool_${String(i).padStart(2, '0')}`, { n: i }, 20 + i)),
    ]);

    try {
      const row = (await adapter.getActiveSessions(5 * MINUTE)).find(
        (s: any) => s.sessionId === 'gemini-dir1l',
      );
      expect(row).toMatchObject({
        // Newest, not oldest — the reverse of parseSession's direction gives
        // `msg 1` and, past the break, no tool at all.
        lastTool: 'tool_19',
        lastToolInput: '{"n":19}',
        lastMessage: 'msg 8',
        model: 'gemini-2.5-pro',
      });
    } finally {
      listed.remove();
    }
  });

  // ─── Line windows ─────────────────────────────────────────

  // parseSession reads a 50-line tail (gemini.ts:157), NARROWER than
  // getToolHistory's 100 (:228) and getRecentMessages' 20 (:283). Two sessions,
  // each 60 records, one interesting record each.
  //
  // ROWWIN1 puts its only tool at index 0 and its only message at index 59. The
  // tool is outside all three windows and the message inside all three, so a null
  // `lastTool` on the row is the WINDOW and not a missing tool —
  // getToolHistory still reports it.
  //
  // ROWWIN2 puts its only `gemini` record at index 0, which is what pins the
  // count from BELOW: with the window at 50 the row sees nothing at all and
  // `model` falls back to the bare 'gemini'. Widening the count to 2000 admits
  // the record and answers 'early msg' / 'gemini-2.5-pro'. ROWWIN1 cannot do this
  // job — its `lastMessage && detail.model` break (gemini.ts:212) fires on the
  // index-59 record long before the walk reaches index 0, so the count is
  // invisible from that side.
  it('reads the row from a 50-line tail, narrower than the detail readers', async () => {
    const adapter = new GeminiAdapter();
    const listed = listedSessions();
    const rowwin1 = listed.jsonl('rowwin1', [
      toolCall('hidden_shell', { command: 'ls' }, 0),
      ...filler(58),
      geminiMsg('surfaced msg', 59),
    ]);
    listed.jsonl('rowwin2', [geminiMsg('early msg', 0), ...filler(59)]);

    try {
      const rows = await adapter.getActiveSessions(5 * MINUTE);
      const rowOf = (id: string) => rows.find((s: any) => s.sessionId === id);

      expect(rowOf('gemini-rowwin1l')).toMatchObject({
        lastTool: null,
        lastToolInput: null,
        lastMessage: 'surfaced msg',
        model: 'gemini-2.5-pro',
      });
      expect(rowOf('gemini-rowwin2l')).toMatchObject({
        lastTool: null,
        lastMessage: null,
        // Nothing in the window names a model, so the fallback answers.
        model: 'gemini',
      });

      const detail = await adapter.getSessionDetail('gemini-rowwin1l', null, rowwin1);
      // Both detail readers see the whole 60-record file.
      expect(detail.toolHistory).toEqual([{ tool: 'hidden_shell', detail: '{"command":"ls"}', ts: tsOf(0) }]);
      expect(detail.messages).toEqual([{ role: 'assistant', text: 'surfaced msg', ts: tsOf(59) }]);
    } finally {
      listed.remove();
    }
  });

  // The other three windows, each proved by pushing the interesting record just
  // outside its own reader's count. Every padded file is paired with a short
  // control carrying the SAME interesting records, so an empty result cannot be
  // confused with "this file has no tool / message / usage at all".
  it('bounds each detail reader by its own line window', async () => {
    const adapter = new GeminiAdapter();
    const scratch = scratchDir();

    // getToolHistory: count 100, pinned from BOTH sides by a one-record difference
    // in file length. A tail of N shows a record at index i only when i >= T - N,
    // so with the tool at index 2, a 102-record file puts it exactly on the edge
    // (visible) and a 103-record file one step past it (invisible).
    const toolFile = writeJsonl(path.join(scratch, 'wintool-102.jsonl'), [
      filler(2),
      toolCall('hidden_shell', { command: 'ls' }, 2),
      ...filler(99),
    ]);
    const toolTooLong = writeJsonl(path.join(scratch, 'wintool-103.jsonl'), [
      filler(2),
      toolCall('hidden_shell', { command: 'ls' }, 2),
      ...filler(100),
    ]);

    // getRecentMessages: count 20. The message is at index 0 of 22 records.
    const msgFile = writeJsonl(path.join(scratch, 'winmsg.jsonl'), [
      geminiMsg('hidden msg', 0),
      ...filler(21),
    ]);
    const msgControl = writeJsonl(path.join(scratch, 'winmsg-control.jsonl'), [
      geminiMsg('hidden msg', 0),
    ]);

    // getTokenUsage: count 2000. The reading is at index 0 of 2002 records.
    const usageRecords = [geminiMsg('padded usage', 0, { tokens: { input: 4242, output: 42 } })];
    const usageFile = writeJsonl(path.join(scratch, 'winusage.jsonl'), [
      ...usageRecords,
      ...filler(2001),
    ]);
    const usageControl = writeJsonl(path.join(scratch, 'winusage-control.jsonl'), usageRecords);

    try {
      expect((await adapter.getSessionDetail('gemini-wintool', null, toolTooLong)).toolHistory).toEqual([]);
      expect((await adapter.getSessionDetail('gemini-winmsg', null, msgFile)).messages).toEqual([]);
      expect((await adapter.getSessionDetail('gemini-winusage', null, usageFile)).tokenUsage).toBeNull();
      // The 102-record twin of the first file: one record shorter and the same tool
      // is inside the tail. A count of 99 would answer `[]` here, so the pair pins
      // 100 exactly rather than merely bounding it from above.
      expect((await adapter.getSessionDetail('gemini-wintool', null, toolFile)).toolHistory).toEqual([
        { tool: 'hidden_shell', detail: '{"command":"ls"}', ts: tsOf(2) },
      ]);
      // Control: unpadded, the same record resolves.
      expect((await adapter.getSessionDetail('gemini-winmsg', null, msgControl)).messages).toEqual([
        { role: 'assistant', text: 'hidden msg', ts: tsOf(0) },
      ]);
      expect((await adapter.getSessionDetail('gemini-winusage', null, usageControl)).tokenUsage).toEqual({
        input: 4242,
        output: 42,
      });
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  // ─── Truncation caps ──────────────────────────────────────

  // All four caps plus the two uncapped `file_path` branches, from three sessions
  // written into the listing so the row is observable alongside the detail. Each
  // file carries exactly ONE tool, so the row's `!detail.lastTool` guard
  // (gemini.ts:188) cannot hide any of the three argument branches from the row,
  // and each cap is fed the same over-long payload that fed the detail's.
  it('caps the row at 60/80 and the detail at 80/200 — the file_path branch is uncapped', async () => {
    // Self-check the fixture: 138 and 136 are what make the 60-vs-80 prefixes and
    // the basename-vs-full-path split distinguishable by LENGTH.
    expect(LONG_ARGS_JSON).toHaveLength(138);
    expect(LONG_PATH).toHaveLength(136);

    const adapter = new GeminiAdapter();
    const listed = listedSessions();

    try {
      // gemini.ts:193 — the `args.command` branch, capped at 60 for the row.
      const cmdFile = listed.jsonl('caps1', [
        { type: 'info', content: 'header', timestamp: at(0) },
        geminiMsg(LONG_TEXT, 1, { toolCalls: [{ name: 'run_shell', args: { command: LONG_COMMAND } }] }),
      ]);
      // gemini.ts:194 — the `args.file_path` branch: a basename, and NO cap.
      const pathFile = listed.jsonl('caps2', [
        { type: 'info', content: 'header', timestamp: at(0) },
        geminiMsg(LONG_TEXT, 2, { toolCalls: [{ name: 'read_file', args: { file_path: LONG_PATH } }] }),
      ]);
      // gemini.ts:195 — the JSON.stringify fallback, capped at 60 for the row.
      const jsonFile = listed.jsonl('caps3', [
        { type: 'info', content: 'header', timestamp: at(0) },
        geminiMsg(LONG_TEXT, 3, { toolCalls: [{ name: 'other_tool', args: LONG_ARGS }] }),
      ]);

      const rows = await adapter.getActiveSessions(5 * MINUTE);
      const rowOf = (id: string) => rows.find((s: any) => s.sessionId === id);

      const cmdRow = rowOf('gemini-caps1l');
      expect(cmdRow.lastTool).toBe('run_shell');
      expect(cmdRow.lastToolInput).toBe('c'.repeat(60));
      expect(cmdRow.lastToolInput).toHaveLength(60);

      const pathRow = rowOf('gemini-caps2l');
      expect(pathRow.lastTool).toBe('read_file');
      // The whole basename survives — 120 chars, uncapped.
      expect(pathRow.lastToolInput).toBe('p'.repeat(120));
      expect(pathRow.lastToolInput).toHaveLength(120);

      const jsonRow = rowOf('gemini-caps3l');
      expect(jsonRow.lastTool).toBe('other_tool');
      expect(jsonRow.lastToolInput).toBe(LONG_ARGS_JSON.substring(0, 60));
      expect(jsonRow.lastToolInput).toHaveLength(60);

      // gemini.ts:184 — the row's message: the same 260 chars in all three rows.
      for (const row of [cmdRow, pathRow, jsonRow]) {
        expect(row.lastMessage).toBe('z'.repeat(80));
        expect(row.lastMessage).toHaveLength(80);
      }

      const cmdDetail = await adapter.getSessionDetail('gemini-caps1l', null, cmdFile);
      // gemini.ts:243 — the same 100-char command, capped at 80 rather than 60.
      expect(cmdDetail.toolHistory).toEqual([{ tool: 'run_shell', detail: 'c'.repeat(80), ts: tsOf(1) }]);
      expect(cmdDetail.toolHistory[0].detail).toHaveLength(80);
      // gemini.ts:300 — the same 260-char message keeps 200 in the detail, where
      // the row kept only 80.
      expect(cmdDetail.messages).toEqual([{ role: 'assistant', text: 'z'.repeat(200), ts: tsOf(1) }]);
      expect(cmdDetail.messages[0].text).toHaveLength(200);
      // The `info` record contributes neither a tool nor a message.
      expect(cmdDetail.messages).toHaveLength(1);

      // gemini.ts:244 — the detail's file_path branch has no cap either, and keeps
      // the whole path where the row kept only its basename.
      const pathDetail = await adapter.getSessionDetail('gemini-caps2l', null, pathFile);
      expect(pathDetail.toolHistory).toEqual([{ tool: 'read_file', detail: LONG_PATH, ts: tsOf(2) }]);
      expect(pathDetail.toolHistory[0].detail).toHaveLength(136);

      // gemini.ts:245 — the detail's JSON.stringify fallback, capped at 80.
      const jsonDetail = await adapter.getSessionDetail('gemini-caps3l', null, jsonFile);
      expect(jsonDetail.toolHistory).toEqual([
        { tool: 'other_tool', detail: LONG_ARGS_JSON.substring(0, 80), ts: tsOf(3) },
      ]);
      expect(jsonDetail.toolHistory[0].detail).toHaveLength(80);
    } finally {
      listed.remove();
    }
  });

  // ─── Tool shapes, name fallbacks, ts and content rules ─────

  // Both tool shapes, all four name fallbacks, the `ts: 0` default, and the one
  // place gemini's two readers disagree about content: the ROW routes `content`
  // through `extractText` and so reads a `text` block (gemini.ts:181), while
  // getRecentMessages accepts a plain string only (gemini.ts:295) and drops the
  // same record. The happy-path fixtures above only ever use string content, so
  // without this case that asymmetry is invisible.
  it('reads both tool shapes and their name fallbacks, and drops a ts: 0 tool to the end', async () => {
    const adapter = new GeminiAdapter();
    const scratch = scratchDir();
    const file = writeJsonl(path.join(scratch, 'session-shapes1.jsonl'), [
      {
        type: 'gemini',
        model: 'gemini-2.5-pro',
        content: [{ type: 'text', text: 'row reads blocks' }],
        timestamp: at(0),
      },
      // toolCalls with no `name` → 'function_call' (gemini.ts:190).
      geminiMsg('ignored by the row', 1, { toolCalls: [{ args: { a: 1 } }] }),
      // A tool_call with neither `name` nor `toolName` → 'tool' (gemini.ts:204),
      // and a STRING input, so the string branch of the detail's rule runs.
      { type: 'tool_call', input: 'raw input', timestamp: at(2) },
      // `toolName` used when `name` is absent; no timestamp, so `ts` falls back to
      // 0 (gemini.ts:266).
      { type: 'tool_call', toolName: 'renamed_tool', input: { command: 'x' }, timestamp: at(3) },
      // No timestamp at all, so `ts` falls back to 0 (gemini.ts:266).
      { type: 'tool_call', name: 'no_input_tool' },
      // `info` is skipped by the message reader (gemini.ts:293) and read as nothing
      // by the others; a role gemini does not know maps to 'system'.
      { type: 'info', content: 'ignored', timestamp: at(5) },
      { type: 'notice', content: 'unknown role', timestamp: at(6) },
      { type: 'user', content: '   ', timestamp: at(7) },
    ]);

    try {
      const detail = await adapter.getSessionDetail('gemini-shapes1l', null, file);
      expect(detail.toolHistory).toEqual([
        { tool: 'function_call', detail: '{"a":1}', ts: tsOf(1) },
        { tool: 'tool', detail: 'raw input', ts: tsOf(2) },
        { tool: 'renamed_tool', detail: '{"command":"x"}', ts: tsOf(3) },
        // No `input` at all → the detail stays '' rather than 'undefined'.
        { tool: 'no_input_tool', detail: '', ts: 0 },
      ]);
      // The string-content record and the unknown-role record survive; the
      // block-shaped `content` and the whitespace-only `user` content do not.
      expect(detail.messages).toEqual([
        { role: 'assistant', text: 'ignored by the row', ts: tsOf(1) },
        { role: 'system', text: 'unknown role', ts: tsOf(6) },
      ]);
      expect(detail.tokenUsage).toBeNull();
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  // The ROW half of the content asymmetry above, which needs the session listed:
  // `extractText` reads the same `text` block that getRecentMessages drops.
  it('gives the row the text of a content block that the detail drops', async () => {
    const adapter = new GeminiAdapter();
    const listed = listedSessions();
    listed.jsonl('blocks1', [
      {
        type: 'gemini',
        model: 'gemini-2.5-pro',
        content: [{ type: 'input_text', text: 'not a readable block' }, { type: 'text', text: 'block text' }],
        timestamp: at(0),
      },
      {
        type: 'gemini',
        model: 'gemini-2.5-pro',
        content: '  padded and trimmed  ',
        timestamp: at(1),
      },
    ]);

    try {
      const row = (await adapter.getActiveSessions(5 * MINUTE)).find(
        (s: any) => s.sessionId === 'gemini-blocks1l',
      );
      // The newest record wins, and `extractText` trims before the 80-char cap.
      expect(row.lastMessage).toBe('padded and trimmed');

      const detail = await adapter.getSessionDetail('gemini-blocks1l', null, listed.dir + '/session-blocks1.jsonl');
      // The array-content record is dropped by `typeof msg.content === 'string'`
      // (gemini.ts:295); the string one is kept, TRIMMED — the row trims through
      // `extractText`, the detail reader trims and takes the first 200 chars.
      expect(detail.messages).toEqual([
        { role: 'assistant', text: 'padded and trimmed', ts: tsOf(1) },
      ]);
    } finally {
      listed.remove();
    }
  });

  // A `null` element inside `messages` is the one record shape that reaches the
  // per-entry `msg.type` dereference. getTokenUsage guards it (`msg?.tokens`,
  // gemini.ts:380) and walks on; getToolHistory and getRecentMessages do not, so
  // they throw, and the surrounding catch returns whatever they had collected up
  // to that point — the tool AFTER the hole is lost, and it is lost silently.
  it('stops the tool and message readers at a null record but not the token fold', async () => {
    const adapter = new GeminiAdapter();
    const scratch = scratchDir();
    const records = [
      // Everything readable sits BEFORE the first hole, so what the two readers
      // return is not confused with "they read nothing".
      geminiMsg('before hole message', 1),
      toolCall('before_hole', { command: 'a' }, 0),
      null,
      // Everything past here is lost to the tool and message readers.
      toolCall('after_hole', { command: 'b' }, 3),
      geminiMsg('after hole message', 4),
      // …but not to the token fold, which optional-chains past its own holes.
      geminiMsg('before hole tokens', 5, { tokens: { input: 111, output: 11 } }),
      null,
      geminiMsg('after hole tokens', 7, { tokens: { input: 222, output: 22 } }),
    ];
    const jsonlFile = writeJsonl(path.join(scratch, 'session-hole1.jsonl'), records);
    const jsonFile = writeSessionJson(path.join(scratch, 'session-hole1.json'), records);

    try {
      for (const file of [jsonlFile, jsonFile]) {
        const detail = await adapter.getSessionDetail('gemini-hole1', null, file);
        // Everything up to the first hole, and nothing after it.
        expect(detail.toolHistory).toEqual([
          { tool: 'before_hole', detail: '{"command":"a"}', ts: tsOf(0) },
        ]);
        expect(detail.messages).toEqual([
          { role: 'assistant', text: 'before hole message', ts: tsOf(1) },
        ]);
        // The optional chain in getTokenUsage walks the whole array, so BOTH
        // readings are summed and the hole costs nothing.
        expect(detail.tokenUsage).toEqual({ input: 333, output: 33 });
      }
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  // ─── The token fold ───────────────────────────────────────

  // THE load-bearing case: the same records as a `.jsonl` session and as a `.json`
  // document, summed identically. `foldJsonl` — the helper codex's token lookup
  // uses — cannot do this: it reads lines, and a `.json` session is one document,
  // so every one of its chunks fails `JSON.parse` and the fold sees nothing. The
  // fold has to run over the already-parsed entry list, which is what
  // `foldEntries` is for.
  it('sums the same token records on the jsonl path and on the json path', async () => {
    const adapter = new GeminiAdapter();
    const scratch = scratchDir();
    const jsonlFile = writeJsonl(path.join(scratch, 'session-tok1.jsonl'), TOKEN_RECORDS);
    const jsonFile = writeSessionJson(path.join(scratch, 'session-tok1.json'), TOKEN_RECORDS);

    try {
      // Hand-summed from the fixture: 1000 + 1200 + 5 in, 10 + 30 + 0 out. The
      // `total` / `cached` / `thoughts` fields are not read at all.
      const fromJsonl = await adapter.getSessionDetail('gemini-tok1', null, jsonlFile);
      expect(fromJsonl.tokenUsage).toEqual({ input: 2205, output: 40 });

      const fromJson = await adapter.getSessionDetail('gemini-tok1', null, jsonFile);
      expect(fromJson.tokenUsage).toEqual({ input: 2205, output: 40 });
      expect(fromJson.tokenUsage).toEqual(fromJsonl.tokenUsage);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  // No reading anywhere → `null`, not `{ input: 0, output: 0 }`. The `found` flag
  // is what distinguishes the two (gemini.ts:391), and it is set by EITHER
  // numeric field, so a fold that initialised to `{input: 0, output: 0}` and
  // returned it unconditionally would fail here on both paths.
  it('reports null tokenUsage when no record carries tokens, on either path', async () => {
    const adapter = new GeminiAdapter();
    const scratch = scratchDir();
    const jsonlFile = writeJsonl(path.join(scratch, 'session-notok.jsonl'), NO_TOKEN_RECORDS);
    const jsonFile = writeSessionJson(path.join(scratch, 'session-notok.json'), NO_TOKEN_RECORDS);

    try {
      expect((await adapter.getSessionDetail('gemini-notok', null, jsonlFile)).tokenUsage).toBeNull();
      expect((await adapter.getSessionDetail('gemini-notok', null, jsonFile)).tokenUsage).toBeNull();
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  // The two `typeof` guards, kept separate on purpose. `input: '1000'` and
  // `output: '10'` are each rejected while the numeric field beside them is still
  // taken, so a fold that guarded the record as a whole
  // (`typeof tokens.input === 'number' && …`) would lose the 10. A fold that
  // coerced (`Number(tokens.input)`), or that tested `!== undefined` instead of
  // `typeof === 'number'`, would pick the strings up and produce 3000 / 20. And
  // `!tokens` is a truthiness test, so `tokens: 0` is skipped rather than read.
  it('rejects a non-numeric token count while still taking its numeric sibling', async () => {
    const adapter = new GeminiAdapter();
    const scratch = scratchDir();
    const jsonlFile = writeJsonl(path.join(scratch, 'session-guard1.jsonl'), GUARD_RECORDS);
    const jsonFile = writeSessionJson(path.join(scratch, 'session-guard1.json'), GUARD_RECORDS);

    try {
      // 2000 from the numeric `input`; 10 from the sibling of the string `input`;
      // the string `output` and the record whose `tokens` is 0 add nothing.
      expect((await adapter.getSessionDetail('gemini-guard1', null, jsonlFile)).tokenUsage).toEqual({
        input: 2000,
        output: 10,
      });
      expect((await adapter.getSessionDetail('gemini-guard1', null, jsonFile)).tokenUsage).toEqual({
        input: 2000,
        output: 10,
      });
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  // A `.json` session whose document has no usable `messages`, and one that is not
  // JSON at all. Both are ordinary in practice — a chat killed mid-write leaves a
  // truncated file — and both go through `readJsonFile`'s catch or the
  // `Array.isArray` guard (gemini.ts:161), not through any JSONL path. A
  // conversion that dropped the guard would throw or hand back a non-array.
  it('reads a json session with no messages array, or with unparseable text, as empty', async () => {
    const adapter = new GeminiAdapter();
    const scratch = scratchDir();
    const noMessages = writeJson(path.join(scratch, 'session-nomsg.json'), { sessionId: 'nomsg' });
    const messagesNull = writeJson(path.join(scratch, 'session-msgnull.json'), { messages: null });
    const messagesObject = writeJson(path.join(scratch, 'session-msgobj.json'), { messages: { 0: { type: 'gemini' } } });
    const malformed = path.join(scratch, 'session-broken.json');
    fs.writeFileSync(malformed, '{ "messages": [ { "type": "gemini"');
    // A jsonl file with a corrupt line among good ones: parseJsonLines skips it
    // and keeps going, so the fold sees the records it can parse.
    const partlyBroken = path.join(scratch, 'session-halfbroken.jsonl');
    fs.writeFileSync(
      partlyBroken,
      [
        JSON.stringify({ type: 'gemini', tokens: { input: 10, output: 1 }, timestamp: at(0) }),
        '{ "type": "gemini", "tokens": { "input": 9999',
        JSON.stringify({ type: 'gemini', tokens: { input: 20, output: 2 }, timestamp: at(2) }),
      ].join('\n') + '\n',
    );

    try {
      for (const file of [noMessages, messagesNull, messagesObject, malformed]) {
        const detail = await adapter.getSessionDetail('gemini-broken', null, file);
        expect(detail.toolHistory).toEqual([]);
        expect(detail.messages).toEqual([]);
        expect(detail.tokenUsage).toBeNull();
      }

      // The corrupt LINE is skipped; the 9999 that would have come with it is not
      // summed, and the two intact readings are.
      expect((await adapter.getSessionDetail('gemini-halfbroken', null, partlyBroken)).tokenUsage).toEqual({
        input: 30,
        output: 3,
      });
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  // ─── getSessionDetail: the id-only lookup ─────────────────

  // Two paths into getSessionDetail. The filePath short-circuit (gemini.ts:434)
  // returns immediately, and the id-only rescan (gemini.ts:444) strips the
  // `gemini-` prefix and rescans with its own HARD-CODED 30-minute window. This
  // session is 20 minutes old — outside the 5-minute threshold the listing tests
  // pass, inside the 30-minute one — so widening or dropping that constant changes
  // this result while leaving every other case here alone.
  it('resolves a session by id through its own 30-minute window', async () => {
    const adapter = new GeminiAdapter();
    const listed = listedSessions();
    listed.json('lookup1', [geminiMsg('lookup answer', 1, { tokens: { input: 700, output: 70 } })]);
    const twentyMinutesAgo = new Date(Date.now() - 20 * MINUTE);
    fs.utimesSync(path.join(listed.dir, 'session-lookup1.json'), twentyMinutesAgo, twentyMinutesAgo);

    try {
      expect((await adapter.getActiveSessions(5 * MINUTE)).map((s: any) => s.sessionId)).not.toContain(
        'gemini-lookup1',
      );

      const viaId = await adapter.getSessionDetail('gemini-lookup1', null);
      expect(viaId.sessionId).toBe('gemini-lookup1');
      expect(viaId.messages).toEqual([{ role: 'assistant', text: 'lookup answer', ts: tsOf(1) }]);
      expect(viaId.tokenUsage).toEqual({ input: 700, output: 70 });

      // The strip is a tolerant `replace`, not a required-prefix parse, so an id
      // that arrives WITHOUT the prefix still resolves — and the returned
      // `sessionId` is the caller's argument echoed back verbatim.
      const unprefixed = await adapter.getSessionDetail('lookup1', null);
      expect(unprefixed.sessionId).toBe('lookup1');
      expect(unprefixed.messages).toEqual([{ role: 'assistant', text: 'lookup answer', ts: tsOf(1) }]);
    } finally {
      listed.remove();
    }
  });

  // The id-only rescan matches on the derived file id alone and never consults
  // `project` (gemini.ts:446). Pinned as a positive assertion, because gemini has
  // one flat chats tree per project directory rather than a per-project session
  // directory, so the argument is redundant rather than a missed check — a
  // conversion that started enforcing it would break real callers, which pass
  // whichever `project` the row reported (often null, as the rows above show).
  it('ignores the project argument on the id-only lookup path', async () => {
    const adapter = new GeminiAdapter();
    const listed = listedSessions();
    listed.json('proj1', [geminiMsg('project answer', 1)]);

    try {
      const wrongProject = await adapter.getSessionDetail('gemini-proj1', path.join(tmpHome, 'not-a-project'));
      expect(wrongProject.sessionId).toBe('gemini-proj1');
      expect(wrongProject.messages).toEqual([{ role: 'assistant', text: 'project answer', ts: tsOf(1) }]);
    } finally {
      listed.remove();
    }
  });

  // The ROW's copy of the two tool-name fallbacks. The shapes case above drives
  // them through getToolHistory, where a `tool_call` record outranks the
  // toolCalls-bearing record because parseSession's backwards walk meets it first;
  // here each fallback is the session's ONLY tool, so both readers report it and
  // `tc.name || 'function_call'` (gemini.ts:190 and :248) and
  // `msg.name || msg.toolName || 'tool'` (gemini.ts:204 and :264) are pinned at
  // both sites.
  it('falls back to function_call for an unnamed toolCalls entry and tool for an unnamed tool_call', async () => {
    const adapter = new GeminiAdapter();
    const listed = listedSessions();
    // Only a toolCalls entry, and it has no `name`.
    const fb1 = listed.jsonl('fb1', [geminiMsg('fb1 answer', 1, { toolCalls: [{ args: { a: 1 } }] })]);
    // Only a tool_call, with neither `name` nor `toolName`.
    const fb2 = listed.jsonl('fb2', [{ type: 'tool_call', input: 'raw', timestamp: at(1) }]);
    // Only a tool_call carrying `toolName` and no `name`, so the row's
    // `msg.name || msg.toolName` middle term is the one that answers.
    const fb3 = listed.jsonl('fb3', [
      { type: 'tool_call', toolName: 'only_tool_name', input: 'raw', timestamp: at(1) },
    ]);

    try {
      const rows = await adapter.getActiveSessions(5 * MINUTE);
      const rowOf = (id: string) => rows.find((s: any) => s.sessionId === id);

      expect(rowOf('gemini-fb1l')).toMatchObject({
        lastTool: 'function_call',
        // Falls through to the JSON.stringify branch (gemini.ts:195).
        lastToolInput: '{"a":1}',
        lastMessage: 'fb1 answer',
      });
      expect(rowOf('gemini-fb2l')).toMatchObject({
        lastTool: 'tool',
        // A string input takes the string branch (gemini.ts:206).
        lastToolInput: 'raw',
        lastMessage: null,
      });
      expect(rowOf('gemini-fb3l')).toMatchObject({
        lastTool: 'only_tool_name',
        lastToolInput: 'raw',
        lastMessage: null,
      });

      expect((await adapter.getSessionDetail('gemini-fb1l', null, fb1)).toolHistory).toEqual([
        { tool: 'function_call', detail: '{"a":1}', ts: tsOf(1) },
      ]);
      expect((await adapter.getSessionDetail('gemini-fb2l', null, fb2)).toolHistory).toEqual([
        { tool: 'tool', detail: 'raw', ts: tsOf(1) },
      ]);
      expect((await adapter.getSessionDetail('gemini-fb3l', null, fb3)).toolHistory).toEqual([
        { tool: 'only_tool_name', detail: 'raw', ts: tsOf(1) },
      ]);
    } finally {
      listed.remove();
    }
  });

  // ─── #144: a DIRECTORY whose NAME matches the session-file filter ───
  //
  // `fileFor` lists `chats/` with a BARE `readdirSync` (gemini.ts:152), so its
  // entries arrive as `string[]` and the `session-*.json` / `session-*.jsonl`
  // filter can ask about the NAME and nothing else. A DIRECTORY named to match
  // therefore passes, `stat`s successfully (size 64, mtime now) and is emitted as
  // a session row whose detail is all null — `readLines` swallows the EISDIR
  // (jsonl-utils.ts:57), so the failure is silent. Drop the `isFile()` term at
  // gemini.ts:153 and this goes red.
  //
  // Both suffixes get a decoy, since the filter is an `||` over the two.
  it('emits no session row for a directory named session-*.json or session-*.jsonl', async () => {
    const adapter = new GeminiAdapter();
    const listed = listedSessions();
    listed.jsonl('real1', [geminiMsg('real done', 1)]);
    const jsonDecoy = path.join(listed.dir, 'session-dirdecoy.json');
    const jsonlDecoy = path.join(listed.dir, 'session-dirdecoyl.jsonl');
    fs.mkdirSync(jsonDecoy);
    fs.mkdirSync(jsonlDecoy);

    try {
      const rows = await adapter.getActiveSessions(5 * MINUTE);
      // `getActiveSessions` scans every project directory under TMP_DIR, so the
      // base fixture `abc` (line 239) is in the listing too and the assertion is
      // the FULL set: it plus the real file, and neither decoy.
      expect(rows.map((s: any) => s.sessionId).sort()).toEqual(['gemini-abc', 'gemini-real1l']);
      // …and both decoys really are directories, so the exact set above is the
      // `isFile()` guard rather than a missing fixture.
      expect(fs.statSync(jsonDecoy).isDirectory()).toBe(true);
      expect(fs.statSync(jsonlDecoy).isDirectory()).toBe(true);
    } finally {
      listed.remove();
    }
  });
});
