/**
 * Characterization test for the four READERS of the vscode adapter.
 *
 * `vscode.test.ts` is 549 lines / 40 tests and almost none of them reach
 * shipped code: it redefines `readLinesInline`, `parseJsonLinesInline`,
 * `toTimestampInline`, `summarizeJsonInline`, `extractAssistantTextInline`,
 * `shouldReplaceCandidateInline`, `parseSessionInline`, `getToolHistoryInline`
 * and `getRecentMessagesInline` in the test body (vscode.test.ts:7-168) and
 * asserts against those. Only two tests drive the real `VSCodeAdapter`, one of
 * them for a static prop. The copies have drifted from `vscode.ts` in three
 * places that matter:
 *
 *  - `extractAssistantTextInline` returns `responseRaw.substring(0, 200).trim()`
 *    on a JSON parse failure (vscode.test.ts:56); shipped `extractAssistantText`
 *    returns `''` and logs under `extractAssistantText` (vscode.ts:134-138).
 *  - `getToolHistoryInline` returns `[]` for a `content.txt` (vscode.test.ts:125);
 *    shipped `getToolHistory` reads every sibling `content.txt` of the resource
 *    session (vscode.ts:229-239).
 *  - `toTimestampInline` parses ISO strings and clamps to `Date.parse`; shipped
 *    code has no such helper — it is `typeof entry.ts === 'number' ? entry.ts : 0`
 *    (vscode.ts:250), so an ISO timestamp string becomes 0.
 *
 * So the file stays green through an arbitrary rewrite of the shipped reader.
 * This one drives the shipped module and pins the four readers the B3b
 * conversion touches: `parseSession` (:143), `getToolHistory` (:226),
 * `getRecentMessages` (:270) and `hasRealActivity` (:374). Everything else in
 * the file — `scanAllSessions`, the four storage roots, `SOURCE_PRIORITY`,
 * `shouldReplaceCandidate`, `readWorkspacePath`, `buildSessionId`,
 * `parseSessionId`, `getWatchPaths` — is deliberately OUT of scope and is
 * proven byte-identical to `main` by `git` instead, which is both cheaper and
 * more reliable than testing it here. (This is narrower than Task 1 of
 * docs/superpowers/plans/2026-10-03-adapter-jsonl-family-plan-b3.md, which also
 * asked for `SOURCE_PRIORITY` and the session-id round trip.)
 *
 * Three facts the conversion can silently break, and how they are pinned:
 *
 *  1. `hasRealActivity` reads the HEAD. vscode.ts:380 is
 *     `{ from: 'start', count: 5 }` while every other reader in the file uses
 *     `{ from: 'end', ... }` and `readLines` DEFAULTS `from` to `'end'`
 *     (jsonl-utils.ts:27), so omitting `from` here reads the tail instead. The
 *     fixtures below put the discriminating records at the HEAD: `count-lines`
 *     is 2 non-empty records then blanks (listed, because the head window sees
 *     them) followed by a 6th non-empty record that a 5-line TAIL window would
 *     see alone (dropped). `from: 'start'` -> `'end'` makes it vanish.
 *     `count: 5` is pinned from BOTH sides by `count-low` and `count-high`,
 *     which together admit no count but 5.
 *  2. This adapter walks in TWO OPPOSITE DIRECTIONS. `parseSession` is
 *     `for (let i = entries.length - 1; i >= 0; i--)` (vscode.ts:174), so
 *     `reverse: true`; `getToolHistory` (vscode.ts:245, :254) and
 *     `getRecentMessages` (vscode.ts:307, :318) are `for (const entry of
 *     entries)` — forward. Both directions are pinned, and the field NAMES
 *     argue against the shipped code in each case.
 *  3. `parseSession`'s `content.txt` branch (vscode.ts:158-169) reads the WHOLE
 *     file as text, trims it, caps it at 120 and RETURNS before any line
 *     parsing. `res-head` is a 401-line `content.txt` whose first 120 chars are
 *     a marker the tail never reaches; `res-json` is a `content.txt` whose
 *     entire body is a JSON `llm_request` line and still reports NO model,
 *     because the early return happens before `readLines`.
 *
 * The 300-line tail window is pinned EXACTLY for all three JSONL readers, not
 * merely "narrower than the file". `readLines(..., { from: 'end', count: N })`
 * on a 301-line file makes line L visible iff `N >= 302 - L`, so a record at
 * line 1 is invisible iff `count <= 300` and a record at line 2 is visible iff
 * `count >= 300`: the pair pins `count === 300` with no slack.
 *
 * What is deliberately NOT pinned, and why:
 *
 *  - `parseSession`'s `break` (vscode.ts:220) is a pure optimisation: once
 *    model, lastMessage and lastTool are all set, every write in the loop is
 *    behind a `!detail.lastX` guard, so continuing the walk cannot change the
 *    result. Deleting it is unobservable and no assertion here claims otherwise.
 *  - `summarizeJson`'s `maxLength = 80` default (vscode.ts:67) is unreachable:
 *    all three call sites pass 60 or 120 explicitly.
 *  - `getRecentMessages`' `content.txt` fallback (vscode.ts:285-298) can never
 *    push a row. It fires only when `scanResourceSessionContents` returned no
 *    non-empty sibling — but that scan always includes the very file whose text
 *    is being tested (`<root>/<callDir>/content.txt` is one of `<root>`'s own
 *    children), so a non-empty file implies a non-empty entry and vice versa.
 *    `messages: []` for a whitespace-only `content.txt` is asserted; the dead
 *    `ts: fs.statSync(filePath).mtimeMs` line is reported, not frozen.
 *  - `hasRealActivity`'s `stat.size === 0` (vscode.ts:377) is defence in depth:
 *    `readLines` short-circuits on `size === 0` too, so both the empty and the
 *    whitespace-only `content.txt` land on `false` regardless. The assertions
 *    pin the OUTCOME, which is what a conversion could change.
 *
 * Two defects in vscode.ts are recorded in the report and NOT frozen here:
 * `getToolHistory` and `getRecentMessages` each run TWO separate forward loops
 * over the same entries, so the emitted order is "every `tool_call`, then every
 * `tool.execution_start`" rather than file order — pinned here because it is
 * load-bearing for the conversion, not because it is desirable; and
 * `scanResourceSessionContents` re-reads and re-sorts every sibling of the
 * resource session on each of the two `content.txt` readers.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'node:assert';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { detailOf as unionDetailOf, sessionsOf } from './fixtureHelpers';
import type { AgentSessionSummary } from '../../shared/types.js';

const ACTIVE_WINDOW_MS = 60 * 1000;

const VSCODE_ENV_KEYS = [
  'VSCODE_USER_DATA_DIR',
  'VSCODE_INSIDERS_USER_DATA_DIR',
  'VSCODE_CURSOR_USER_DATA_DIR',
  'VSCODE_OFFSET_USER_DATA_DIR',
  'VSCODE_ACTIVE_WINDOW_MS',
] as const;

const ROOT_PROJECT = '/tmp/cv/vscode-project';

/** 80 chars, so `summarizeJson(_, 60)` in parseSession is visible. */
const ARG80 = 'w'.repeat(80);
const ARG60 = 'w'.repeat(60);
/** 150 chars, so the 120 cap in getToolHistory is visible. */
const ARG150 = 'z'.repeat(150);
const ARG120 = 'z'.repeat(120);
/** 150 chars, so parseSession's 120 cap on lastMessage is visible. */
const TEXT150 = 't'.repeat(150);
const TEXT120 = 't'.repeat(120);
/** 250 chars, so getRecentMessages' 200 cap is visible. */
const TEXT250 = 'm'.repeat(250);
const TEXT200 = 'm'.repeat(200);
/** A content.txt whose first 120 chars are unique to the HEAD of the file. */
const HEAD_MARKER = `HEAD-${'x'.repeat(200)}`;
const HEAD_MARKER_120 = `HEAD-${'x'.repeat(115)}`;
/** A 155-char resource directory name, so the 120 cap on callId is visible. */
const CALL_ID_LONG = `call_${'n'.repeat(150)}`;
const CALL_ID_120 = `call_${'n'.repeat(115)}`;

/**
 * The exact bytes of `res-json`'s content.txt: a whole JSONL `llm_request`
 * line, 86 chars, so the 120 cap does not touch it. Parsing it would give the
 * session a model and tokens; the shipped early return gives it neither.
 */
const JSON_LINE_MODEL = 'JSON-MODEL';
const JSON_LLM_REQUEST_LINE =
  '{"type":"llm_request","attrs":{"model":"JSON-MODEL","inputTokens":7,"outputTokens":8}}';

/** `agent_response.attrs.response` is a JSON STRING, not an object. */
const assistantReply = (content: unknown) =>
  JSON.stringify([{ role: 'assistant', parts: [{ type: 'text', content }] }]);

/** A record no reader treats as a model, tool, message or usage record. */
const filler = (i: number) => JSON.stringify({ type: 'filler', i });

let tmpRoot = '';
let VSCodeAdapter: any;
let savedEnv: Record<string, string | undefined> = {};

function snapshotEnv() {
  const out: Record<string, string | undefined> = {};
  for (const key of VSCODE_ENV_KEYS) out[key] = process.env[key];
  return out;
}

function restoreEnv() {
  for (const key of VSCODE_ENV_KEYS) {
    const prior = savedEnv[key];
    if (prior === undefined) delete process.env[key];
    else process.env[key] = prior;
  }
}

// ─── fixture writers ─────────────────────────────────────

function writeDebugLog(userDir: string, workspaceId: string, sessionId: string, lines: string[]) {
  const file = path.join(
    userDir, 'workspaceStorage', workspaceId, 'GitHub.copilot-chat', 'debug-logs', sessionId, 'main.jsonl',
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // `readLines` trims before splitting, so the trailing newline is not a line.
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

function writeResourceContent(
  userDir: string,
  workspaceId: string,
  sessionId: string,
  callId: string,
  text: string,
  ageMs: number,
) {
  const file = path.join(
    userDir, 'workspaceStorage', workspaceId, 'GitHub.copilot-chat',
    'chat-session-resources', sessionId, callId, 'content.txt',
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  const when = new Date(Date.now() - ageMs);
  fs.utimesSync(file, when, when);
  return file;
}

function writeWorkspace(userDir: string, workspaceId: string, project: string) {
  const dir = path.join(userDir, 'workspaceStorage', workspaceId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'workspace.json'), JSON.stringify({ folder: `file://${project}` }));
}

/** A JSONL file outside any storage root, for the filePath-driven readers. */
function writeScratchJsonl(name: string, lines: string[]) {
  const file = path.join(tmpRoot, 'scratch', name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

function writeScratchText(name: string, text: string) {
  const file = path.join(tmpRoot, 'scratch', name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
}

/** `scanResourceSessionContents` sorts siblings by mtime, so fix the order. */
function mtimeOf(file: string) {
  return fs.statSync(file).mtimeMs;
}

/** A 301-line file: exactly the window boundary for `count: 300`. */
function windowLines(markerAt: number | null, markerLine: string) {
  const lines: string[] = [];
  for (let i = 1; i <= 301; i++) {
    lines.push(i === markerAt ? markerLine : filler(i));
  }
  return lines;
}

/**
 * Runs `fn` with DEBUG on, collecting what `debugAdapterError` wrote to
 * `console.debug`. Restores both DEBUG and the spy in `finally`, so a failing
 * assertion cannot leak DEBUG=1 into a later case. Same shape as
 * jsonl-utils.test.ts's `withDebug` — `debugAdapterError` reads
 * `process.env.DEBUG` at CALL time (jsonl-utils.ts:17), so no module reload is
 * needed here.
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

/**
 * Builds a throwaway four-root tree, re-reads the module so the STORAGE_ROOTS
 * consts pick the new dirs up, then tears it all down. Cases that need
 * `getActiveSessions` use this so that — with the suite running shuffled and in
 * parallel with other adapters' fixtures — they cannot perturb each other's
 * exact-set assertions. Same re-import shape as claude.fixture.test.ts.
 */
async function withVscodeTree<T>(
  fn: (adapter: any, userDir: string) => Promise<T>,
): Promise<T> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeville-vscode-tree-'));
  const userDir = path.join(root, 'Code', 'User');
  const prior = snapshotEnv();
  process.env.VSCODE_USER_DATA_DIR = userDir;
  process.env.VSCODE_INSIDERS_USER_DATA_DIR = path.join(root, 'Code - Insiders', 'User');
  process.env.VSCODE_CURSOR_USER_DATA_DIR = path.join(root, 'Cursor', 'User');
  process.env.VSCODE_OFFSET_USER_DATA_DIR = path.join(root, 'Offset', 'User');
  process.env.VSCODE_ACTIVE_WINDOW_MS = String(ACTIVE_WINDOW_MS / 1000);
  vi.resetModules();
  try {
    const { VSCodeAdapter: Fresh } = await import('./vscode.js');
    return await fn(new Fresh(), userDir);
  } finally {
    restoreEnv();
    for (const key of VSCODE_ENV_KEYS) savedEnv[key] = prior[key];
    vi.resetModules();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** The filePath branch of the public `getSessionDetail` (vscode.ts:624-631). */
function detailOf(adapter: any, file: string) {
  return unionDetailOf(adapter, 'vscode-fixture', null, file);
}

/**
 * Narrowing row lookups. `sessionsOf` answers `AgentSessionSummary[]`, so
 * `.find` answers `| undefined`, and every use below reads properties straight
 * off the result. Asserting here rather than at each call site leaves those call
 * sites' own assertions exactly as written: a missing row failed before (as a
 * TypeError on `undefined`) and fails now, with the id or suffix in the message.
 */
function rowOf(sessions: AgentSessionSummary[], sessionId: string) {
  const found = sessions.find((s) => s.sessionId === sessionId);
  assert(found, `no session row for ${sessionId}`);
  return found;
}

function rowEndingWith(sessions: AgentSessionSummary[], suffix: string) {
  const found = sessions.find((s) => s.sessionId.endsWith(suffix));
  assert(found, `no session row ending with ${suffix}`);
  return found;
}

/**
 * `filePath` is `string | null | undefined` on the summary, so a row read back
 * out of the listing has to prove it carries one before it is handed to a
 * reader. Without this the value reached `detailOf`/`endsWith` unchecked.
 */
function filePathOf(row: AgentSessionSummary): string {
  assert(typeof row.filePath === 'string', `row ${row.sessionId} must carry a filePath`);
  return row.filePath;
}

describe('vscode readers', () => {
  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'claudeville-vscode-readers-'));
    savedEnv = snapshotEnv();
    // Every root points somewhere that does not exist, so the inert adapter
    // this suite drives by filePath scans nothing and reads nothing real.
    process.env.VSCODE_USER_DATA_DIR = path.join(tmpRoot, 'inert', 'code');
    process.env.VSCODE_INSIDERS_USER_DATA_DIR = path.join(tmpRoot, 'inert', 'insiders');
    process.env.VSCODE_CURSOR_USER_DATA_DIR = path.join(tmpRoot, 'inert', 'cursor');
    process.env.VSCODE_OFFSET_USER_DATA_DIR = path.join(tmpRoot, 'inert', 'offset');
    vi.resetModules();
    ({ VSCodeAdapter } = await import('./vscode.js'));
  });

  afterAll(() => {
    restoreEnv();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  // ── getToolHistory: JSONL branch ──────────────────────

  // The exact three-key row and the exact order. The order is NOT file order:
  // vscode.ts:245 collects every `tool_call` in a forward pass, then :254
  // collects every `tool.execution_start` in a SECOND forward pass over the same
  // entries. `grep` sits between the first and second `tool_call` in the file
  // and is still emitted last. Both passes are forward — reversing either one
  // reorders this array.
  //
  // The three tool-name/args fallbacks ride along: `entry.name || 'tool_call'`
  // (:248), `entry.data.toolName || 'tool.execution_start'` (:257),
  // `summarizeJson(_, 120)` (:249/:258) passing strings through and
  // stringifying objects, and `null`/`undefined` args collapsing to `''` — which
  // is an EMPTY STRING, not null, on the row.
  it('emits every tool_call before every tool.execution_start, forward, with the exact row shape', async () => {
    const adapter = new VSCodeAdapter();
    const file = writeScratchJsonl('tool-order.jsonl', [
      JSON.stringify({ type: 'tool_call', name: 'read_file', attrs: { args: { path: 'README.md' } }, ts: 1001 }),
      JSON.stringify({ type: 'tool.execution_start', data: { toolName: 'grep', arguments: { q: 'TODO' } }, timestamp: 1002 }),
      JSON.stringify({ type: 'tool_call', attrs: { args: 'plain string' }, ts: 1003 }),
      JSON.stringify({ type: 'tool.execution_start', data: {}, timestamp: 1004 }),
      JSON.stringify({ type: 'tool_call', name: 'no_ts', attrs: { args: {} } }),
      JSON.stringify({ type: 'not_a_tool', ts: 1005 }),
    ]);

    expect((await detailOf(adapter, file)).toolHistory).toEqual([
      { tool: 'read_file', detail: '{"path":"README.md"}', ts: 1001 },
      { tool: 'tool_call', detail: 'plain string', ts: 1003 },
      { tool: 'no_ts', detail: '{}', ts: 0 },
      { tool: 'grep', detail: '{"q":"TODO"}', ts: 1002 },
      { tool: 'tool.execution_start', detail: '', ts: 1004 },
    ]);
  });

  // `maxItems = 15` (vscode.ts:226) applied as `slice(-15)` over the
  // CONCATENATED list (vscode.ts:267), so the oldest `tool_call` rows are the
  // ones dropped — not the oldest rows of each pass. 20 `tool_call` + 3
  // `tool.execution_start` = 23 rows, and the 12 survivors that are still
  // `tool_call` are `tool_09`..`tool_20`, i.e. the first eight dropped are all
  // from the first pass.
  it('keeps the last 15 tools of the concatenated list, dropping the oldest', async () => {
    const adapter = new VSCodeAdapter();
    const lines: string[] = [];
    for (let i = 1; i <= 20; i++) {
      lines.push(JSON.stringify({ type: 'tool_call', name: `tool_${i}`, attrs: { args: { n: i } }, ts: i }));
    }
    for (let i = 1; i <= 3; i++) {
      lines.push(JSON.stringify({ type: 'tool.execution_start', data: { toolName: `exec_${i}`, arguments: {} }, timestamp: 100 + i }));
    }
    const file = writeScratchJsonl('tool-maxitems.jsonl', lines);

    const tools = (await detailOf(adapter, file)).toolHistory;
    expect(tools).toHaveLength(15);
    expect(tools.map((t: any) => t.tool)).toEqual([
      'tool_9', 'tool_10', 'tool_11', 'tool_12', 'tool_13', 'tool_14',
      'tool_15', 'tool_16', 'tool_17', 'tool_18', 'tool_19', 'tool_20',
      'exec_1', 'exec_2', 'exec_3',
    ]);
    expect(tools[0]).toEqual({ tool: 'tool_9', detail: '{"n":9}', ts: 9 });
    expect(tools[11]).toEqual({ tool: 'tool_20', detail: '{"n":20}', ts: 20 });
  });

  // The two 120 caps (:249, :258) and the two DIFFERENT timestamp fields: a
  // `tool_call` row reads `entry.ts` and a `tool.execution_start` row reads
  // `entry.timestamp` (:250, :259), each falling back to 0 when the field it
  // reads is absent or not a number. So `timestamp`-only `tool_call` rows and
  // `ts`-only `tool.execution_start` rows are BOTH 0 — an ISO timestamp string
  // would be 0 too, which is what the drifted `toTimestampInline` in
  // vscode.test.ts:28 hides.
  it('caps tool detail at 120 and reads the timestamp field each record type actually uses', async () => {
    const adapter = new VSCodeAdapter();
    const file = writeScratchJsonl('tool-caps.jsonl', [
      JSON.stringify({ type: 'tool_call', name: 'long_args', attrs: { args: ARG150 }, ts: 11 }),
      JSON.stringify({ type: 'tool_call', name: 'other_field', attrs: { args: {} }, timestamp: 99 }),
      JSON.stringify({ type: 'tool.execution_start', data: { toolName: 'ex_long', arguments: ARG150 }, ts: 77 }),
      JSON.stringify({ type: 'tool.execution_start', data: { toolName: 'ex_ok', arguments: {} }, timestamp: 88 }),
    ]);

    expect((await detailOf(adapter, file)).toolHistory).toEqual([
      { tool: 'long_args', detail: ARG120, ts: 11 },
      { tool: 'other_field', detail: '{}', ts: 0 },
      { tool: 'ex_long', detail: ARG120, ts: 0 },
      { tool: 'ex_ok', detail: '{}', ts: 88 },
    ]);
  });

  // ── getRecentMessages: JSONL branch ───────────────────

  // Same two-pass shape as the tool reader, with `maxItems = 5`
  // (vscode.ts:270) applied as `slice(-5)` over the concatenation
  // (vscode.ts:332). Eight message records alternate in the file; the answer is
  // the four `agent_response` rows first, then the four `assistant.message`
  // rows, with only the last five surviving — so `slice(-5)` drops
  // `resp 1`, `resp 2`, `resp 3` and `assist 1`, and NOT the four oldest in file
  // order. `role` is always the literal `'assistant'`.
  it('emits every agent_response before every assistant.message, forward, keeping the last 5', async () => {
    const adapter = new VSCodeAdapter();
    const lines: string[] = [];
    for (let i = 1; i <= 4; i++) {
      lines.push(JSON.stringify({ type: 'agent_response', attrs: { response: assistantReply(`resp ${i}`) }, ts: i }));
      lines.push(JSON.stringify({ type: 'assistant.message', data: { content: `assist ${i}` }, timestamp: 10 + i }));
    }
    const file = writeScratchJsonl('msg-order.jsonl', lines);

    expect((await detailOf(adapter, file)).messages).toEqual([
      { role: 'assistant', text: 'resp 4', ts: 4 },
      { role: 'assistant', text: 'assist 1', ts: 11 },
      { role: 'assistant', text: 'assist 2', ts: 12 },
      { role: 'assistant', text: 'assist 3', ts: 13 },
      { role: 'assistant', text: 'assist 4', ts: 14 },
    ]);
  });

  // The 200 caps (:279, :287, :313, :322), the `.trim()` on the
  // `assistant.message` branch only (:320), and the two timestamp fields
  // (:314 reads `ts`, :324 reads `timestamp`). Three kinds of record are
  // dropped rather than emitted: an `assistant.message` whose content is
  // whitespace, one whose content is not a string at all, and an
  // `agent_response` with no `attrs`. The long `assistant.message` comes LAST on
  // purpose: the non-string record ahead of it would throw under a widened
  // guard, and a throw only costs the entries that come after it.
  it('caps message text at 200, trims it, and reads the timestamp field each record type uses', async () => {
    const adapter = new VSCodeAdapter();
    const file = writeScratchJsonl('msg-caps.jsonl', [
      JSON.stringify({ type: 'agent_response', attrs: { response: assistantReply(TEXT250) }, ts: 21 }),
      JSON.stringify({ type: 'agent_response', attrs: { response: assistantReply('x') }, timestamp: 22 }),
      JSON.stringify({ type: 'assistant.message', data: { content: '  padded  ' }, ts: 33 }),
      JSON.stringify({ type: 'assistant.message', data: { content: '   ' }, timestamp: 44 }),
      JSON.stringify({ type: 'assistant.message', data: { content: 123 }, timestamp: 55 }),
      JSON.stringify({ type: 'agent_response', ts: 66 }),
      JSON.stringify({ type: 'assistant.message', ts: 77 }),
      JSON.stringify({ type: 'assistant.message', data: { content: TEXT250 }, timestamp: 88 }),
    ]);

    expect((await detailOf(adapter, file)).messages).toEqual([
      { role: 'assistant', text: TEXT200, ts: 21 },
      { role: 'assistant', text: 'x', ts: 0 },
      { role: 'assistant', text: 'padded', ts: 0 },
      { role: 'assistant', text: TEXT200, ts: 88 },
    ]);
  });

  // `extractAssistantText` (vscode.ts:117) walks the response array from the END
  // (vscode.ts:124) and returns the first `text` part of the first assistant
  // message it meets, trimmed. So the LAST assistant message wins: the reverse
  // scan skips the three trailing unusable messages below — a `user` message, a
  // message whose `parts` is not an array, and one whose only text part has a
  // non-string content — before reaching the winner, whose FIRST part is an
  // image and whose second is the answer. A forward walk answers `FIRST`.
  it('takes the LAST assistant text part, skipping user messages and non-text parts', async () => {
    const adapter = new VSCodeAdapter();
    const file = writeScratchJsonl('msg-extract.jsonl', [
      JSON.stringify({
        type: 'agent_response',
        ts: 1,
        attrs: {
          response: JSON.stringify([
            { role: 'assistant', parts: [{ type: 'text', content: '  FIRST  ' }] },
            { role: 'user', parts: [{ type: 'text', content: 'USER' }] },
            { role: 'assistant', parts: 'not-an-array' },
            { role: 'assistant', parts: [{ type: 'text', content: 42 }] },
            { role: 'assistant', parts: [{ type: 'text', content: '   ' }] },
            { role: 'assistant', parts: [{ type: 'image', content: 'IMG' }, { type: 'text', content: '  WINNER  ' }] },
          ]),
        },
      }),
      JSON.stringify({
        type: 'agent_response',
        ts: 2,
        attrs: { response: JSON.stringify([{ role: 'assistant', parts: [{ type: 'text', content: '  pad me  ' }] }]) },
      }),
      // A text part with a non-string content, an empty array, and a null
      // response: all three contribute nothing.
      JSON.stringify({
        type: 'agent_response',
        ts: 3,
        attrs: { response: JSON.stringify([{ role: 'assistant', parts: [{ type: 'text', content: 42 }] }]) },
      }),
      JSON.stringify({ type: 'agent_response', ts: 4, attrs: { response: '[]' } }),
      JSON.stringify({ type: 'agent_response', ts: 5, attrs: { response: null } }),
      // A message whose `parts` is not iterable AT ALL, sitting AFTER a good one in
      // the same array. Shipped, `!Array.isArray(message.parts)` skips it and
      // the good message answers; with that guard removed the `for...of` throws
      // into extractAssistantText's own catch, which returns '' — and because
      // the throw aborts the whole reverse walk, the good message below is
      // never reached and this entry contributes nothing.
      JSON.stringify({
        type: 'agent_response',
        ts: 6,
        attrs: {
          response: JSON.stringify([
            { role: 'assistant', parts: [{ type: 'text', content: 'BELOW-THROW' }] },
            { role: 'assistant', parts: 42 },
          ]),
        },
      }),
      JSON.stringify({
        type: 'agent_response',
        ts: 7,
        attrs: {
          response: JSON.stringify([
            { role: 'assistant', parts: [{ type: 'text', content: 'BELOW-THROW' }] },
            { role: 'assistant', parts: [{ type: 'text', content: 42 }, { type: 'text', content: 'AFTER' }] },
          ]),
        },
      }),
    ]);

    expect((await detailOf(adapter, file)).messages).toEqual([
      { role: 'assistant', text: 'WINNER', ts: 1 },
      { role: 'assistant', text: 'pad me', ts: 2 },
      { role: 'assistant', text: 'BELOW-THROW', ts: 6 },
      { role: 'assistant', text: 'AFTER', ts: 7 },
    ]);
  });

  // The four ways `extractAssistantText` returns `''`: the response is not a
  // string, it is empty or whitespace, it does not parse, or it parses to
  // something that is not an array (vscode.ts:118, :122, :136). The shipped
  // parse failure returns NOTHING — the drifted inline copy in
  // vscode.test.ts:56 returns the raw first 200 characters instead, so a
  // conversion that reintroduced that fallback would pass vscode.test.ts and
  // fail here.
  it('reports no message for a response that is absent, not JSON, or not an array', async () => {
    const adapter = new VSCodeAdapter();
    const file = writeScratchJsonl('msg-noreply.jsonl', [
      JSON.stringify({ type: 'agent_response', ts: 1, attrs: { response: '{"role":"assistant"}' } }),
      JSON.stringify({ type: 'agent_response', ts: 2, attrs: { response: 'not json at all' } }),
      JSON.stringify({ type: 'agent_response', ts: 3, attrs: { response: '' } }),
      JSON.stringify({ type: 'agent_response', ts: 4, attrs: { response: '   ' } }),
      JSON.stringify({ type: 'agent_response', ts: 5, attrs: { response: { role: 'assistant' } } }),
      JSON.stringify({ type: 'agent_response', ts: 6, attrs: {} }),
    ]);

    expect((await detailOf(adapter, file)).messages).toEqual([]);
    // Control: the same raw string is real text when it arrives as a
    // content.txt, so the empty result above is the JSONL branch, not the
    // fixture file being unreadable.
    const text = writeScratchText('noreply-content.txt', 'not json at all');
    expect((await detailOf(adapter, text)).messages).toEqual([
      { role: 'assistant', text: 'not json at all', ts: mtimeOf(text) },
    ]);
  });

  // ── the shared 300-line tail window ───────────────────

  // `readLines(filePath, { from: 'end', count: 300, scope: 'vscode' })`
  // (vscode.ts:171). On a 301-line file a record at line L is visible iff
  // `count >= 302 - L`, so the pair below pins `count === 300` EXACTLY:
  // `tools-at-1` invisible means count <= 300, `tools-at-2` visible means
  // count >= 300. The three unpadded controls prove the emptiness is the
  // WINDOW and not a missing record — and they are why `from: 'start'` goes
  // red on the same fixture.
  it('reads getToolHistory from the last 300 lines, pinned from both edges', async () => {
    const adapter = new VSCodeAdapter();
    const toolCall = (ts: number) =>
      JSON.stringify({ type: 'tool_call', name: `tool_${ts}`, attrs: { args: { ts } }, ts });

    const atOne = writeScratchJsonl('window-tool-1.jsonl', windowLines(1, toolCall(1)));
    const atTwo = writeScratchJsonl('window-tool-2.jsonl', windowLines(2, toolCall(2)));
    const control = writeScratchJsonl('window-tool-control.jsonl', [toolCall(3)]);

    expect(windowLines(1, '').length).toBe(301);
    // Line 1 of 301 is outside a 300-line tail.
    expect((await detailOf(adapter, atOne)).toolHistory).toEqual([]);
    // Line 2 of 301 is the first line inside it.
    expect((await detailOf(adapter, atTwo)).toolHistory).toEqual([
      { tool: 'tool_2', detail: '{"ts":2}', ts: 2 },
    ]);
    expect((await detailOf(adapter, control)).toolHistory).toEqual([
      { tool: 'tool_3', detail: '{"ts":3}', ts: 3 },
    ]);
  });

  // The same window on the message reader (vscode.ts:304).
  it('reads getRecentMessages from the last 300 lines, pinned from both edges', async () => {
    const adapter = new VSCodeAdapter();
    const reply = (text: string) =>
      JSON.stringify({ type: 'agent_response', ts: 7, attrs: { response: assistantReply(text) } });

    const atOne = writeScratchJsonl('window-msg-1.jsonl', windowLines(1, reply('line one')));
    const atTwo = writeScratchJsonl('window-msg-2.jsonl', windowLines(2, reply('line two')));
    const control = writeScratchJsonl('window-msg-control.jsonl', [reply('control')]);

    expect((await detailOf(adapter, atOne)).messages).toEqual([]);
    expect((await detailOf(adapter, atTwo)).messages).toEqual([
      { role: 'assistant', text: 'line two', ts: 7 },
    ]);
    expect((await detailOf(adapter, control)).messages).toEqual([
      { role: 'assistant', text: 'control', ts: 7 },
    ]);
  });

  // ── getTokenUsage: a delegator to parseSession ────────

  // vscode.ts:335-338 is `const parsed = await parseSession(filePath); return
  // parsed.tokens;` — the ONLY thing it does, so every `parseSession` token
  // rule shows up here. `!detail.tokens && entry.type === 'llm_request' &&
  // entry.attrs` (:185) means an `llm_request` with NO `attrs` leaves tokens
  // null while one with empty `attrs` yields explicit zeros; the two
  // `Number(... || 0)` coercions (:187-188) turn a stringified number into a
  // number and a missing field into 0; and the `content.txt` early return
  // (:168) means a resource file never reports usage.
  it('returns tokenUsage straight from parseSession, including every null and zero case', async () => {
    const adapter = new VSCodeAdapter();
    const usage = (lines: string[], name: string) =>
      writeScratchJsonl(`usage-${name}.jsonl`, lines);

    const llm = (attrs: unknown) => JSON.stringify({ type: 'llm_request', attrs });

    expect((await detailOf(adapter, usage([llm({ inputTokens: 120, outputTokens: 34 })], 'both'))).tokenUsage)
      .toEqual({ input: 120, output: 34 });
    expect((await detailOf(adapter, usage([llm({})], 'empty'))).tokenUsage)
      .toEqual({ input: 0, output: 0 });
    expect((await detailOf(adapter, usage([llm({ inputTokens: '50' })], 'coerced'))).tokenUsage)
      .toEqual({ input: 50, output: 0 });
    // No `attrs` at all: the `&& entry.attrs` guard means no reading.
    expect((await detailOf(adapter, usage([JSON.stringify({ type: 'llm_request' })], 'noattrs'))).tokenUsage)
      .toBeNull();
    // No `llm_request` at all.
    expect((await detailOf(adapter, usage([filler(1), filler(2)], 'none'))).tokenUsage)
      .toBeNull();
    // An empty file: `readLines` short-circuits on `size === 0`.
    expect((await detailOf(adapter, usage([], 'empty-file'))).tokenUsage).toBeNull();
    // A content.txt never reaches the JSONL branch, so never reports usage.
    expect((await detailOf(adapter, writeScratchText('usage-content.txt', 'plain text'))).tokenUsage)
      .toBeNull();

    // And the direction of the token walk: two `llm_request` records, the newer
    // one last in the file, and `parseSession` walking newest-first takes the
    // newer pair — a forward walk would report `{ input: 1, output: 1 }`.
    const twoUsage = writeScratchJsonl('usage-two.jsonl', [
      JSON.stringify({ type: 'llm_request', attrs: { model: 'old-model', inputTokens: 1, outputTokens: 1 } }),
      JSON.stringify({ type: 'llm_request', attrs: { model: 'new-model', inputTokens: 20, outputTokens: 5 } }),
    ]);
    expect((await detailOf(adapter, twoUsage)).tokenUsage).toEqual({ input: 20, output: 5 });
  });

  // ── getToolHistory: content.txt branch ────────────────

  // `scanResourceSessionContents` (vscode.ts:79) walks `dirname(dirname(file))`
  // — the RESOURCE SESSION — lists its child DIRECTORIES that hold a
  // `content.txt`, and sorts them by mtime ASCENDING (:108). Which child the
  // caller came in through is irrelevant: `call_alpha` is the oldest, is the
  // file handed to `getSessionDetail`, and every sibling still shows up. The
  // tool NAME is derived from the directory name, not the content:
  // `callId.startsWith('toolu_') ? 'tool_result' : 'call_result'` (:233).
  it('lists a resource session toolHistory from every sibling content.txt, oldest first', async () => {
    await withVscodeTree(async (Adapter, userDir) => {
      const alpha = writeResourceContent(userDir, 'ws', 'res-tools', 'call_alpha', 'alpha text', 30_000);
      const beta = writeResourceContent(userDir, 'ws', 'res-tools', 'toolu_beta', 'beta text', 20_000);
      const gamma = writeResourceContent(userDir, 'ws', 'res-tools', 'call_gamma', 'gamma text', 10_000);

      expect((await detailOf(Adapter, alpha)).toolHistory).toEqual([
        { tool: 'call_result', detail: 'call_alpha', ts: mtimeOf(alpha) },
        { tool: 'tool_result', detail: 'toolu_beta', ts: mtimeOf(beta) },
        { tool: 'call_result', detail: 'call_gamma', ts: mtimeOf(gamma) },
      ]);
    });
  });

  // `slice(-maxItems)` on the resource branch too (:238), and the 120 cap on
  // the callId detail (:234). Seventeen siblings, the newest one named with 155
  // characters: the first two fall off the end and the long name is truncated.
  it('keeps the last 15 resource tool rows and caps the callId detail at 120', async () => {
    await withVscodeTree(async (Adapter, userDir) => {
      const written: string[] = [];
      for (let i = 1; i <= 16; i++) {
        written.push(writeResourceContent(userDir, 'ws', 'res-many', `call_${i}`, `text ${i}`, (17 - i) * 1000));
      }
      const longest = writeResourceContent(userDir, 'ws', 'res-many', CALL_ID_LONG, 'longest', 500);
      expect(written).toHaveLength(16);
      expect(CALL_ID_LONG).toHaveLength(155);

      const tools = (await detailOf(Adapter, written[0])).toolHistory;
      expect(tools).toHaveLength(15);
      expect(tools.map((t: any) => t.detail)).toEqual([
        'call_3', 'call_4', 'call_5', 'call_6', 'call_7', 'call_8',
        'call_9', 'call_10', 'call_11', 'call_12', 'call_13', 'call_14',
        'call_15', 'call_16', CALL_ID_120,
      ]);
      expect(tools[14]).toEqual({
        tool: 'call_result',
        detail: CALL_ID_120,
        ts: mtimeOf(longest),
      });
      expect(CALL_ID_120).toHaveLength(120);
    });
  });

  // ── getRecentMessages: content.txt branch ─────────────

  // Same sibling scan, same ascending mtime order, but the row is
  // `{ role: 'assistant', text, ts }` with the text capped at 200 (:279) and
  // an empty `text` skipped outright (:276) — `entry.text` is already trimmed
  // by `scanResourceSessionContents` (:99). Eight siblings, six of them with
  // text, so `slice(-5)` (:300) drops the oldest of those six.
  it('lists a resource session messages oldest-first, caps text at 200 and skips empty siblings', async () => {
    await withVscodeTree(async (Adapter, userDir) => {
      const texts = ['r1', 'r2', '', '   ', 'r5', TEXT250, 'r7', 'r8'];
      const files: string[] = [];
      texts.forEach((text, i) => {
        files.push(writeResourceContent(userDir, 'ws', 'res-msg', `call_${i + 1}`, text, (8 - i) * 1000));
      });

      expect((await detailOf(Adapter, files[0])).messages).toEqual([
        { role: 'assistant', text: 'r2', ts: mtimeOf(files[1]) },
        { role: 'assistant', text: 'r5', ts: mtimeOf(files[4]) },
        { role: 'assistant', text: TEXT200, ts: mtimeOf(files[5]) },
        { role: 'assistant', text: 'r7', ts: mtimeOf(files[6]) },
        { role: 'assistant', text: 'r8', ts: mtimeOf(files[7]) },
      ]);
    });
  });

  // A content.txt whose whole text is whitespace produces no message at all.
  // The `if (messages.length === 0)` fallback (:285) then re-reads the SAME
  // file, trims it to '' and pushes nothing, so the row list stays empty —
  // see the header for why that fallback can never push.
  it('reports no messages for a content.txt whose whole text is whitespace', async () => {
    await withVscodeTree(async (Adapter, userDir) => {
      const file = writeResourceContent(userDir, 'ws', 'res-blank', 'call_only', '   \n\n  \n', 1000);
      expect((await detailOf(Adapter, file)).messages).toEqual([]);
      // The sibling scan did find the file — it is the trimmed-empty text, not
      // a missing directory, that empties the list.
      expect((await detailOf(Adapter, file)).toolHistory).toEqual([
        { tool: 'call_result', detail: 'call_only', ts: mtimeOf(file) },
      ]);
    });
  });

  // ── parseSession: JSONL branch, through the row ───────

  // THE DIRECTION PIN. `parseSession` walks `for (let i = entries.length - 1;
  // i >= 0; i--)` (vscode.ts:174) and keeps the FIRST match under each
  // `!detail.lastX` guard, so every field comes from the NEWEST record that
  // supplies it — and the walk then keeps going for the fields the newest
  // record does not supply. Here the newest `llm_request` supplies both the
  // model and the tokens, the newest `tool_call` the tool, and the newest
  // `agent_response` the message; `OLD-MESSAGE` is older than `NEW-MESSAGE`
  // yet still reaches `messages` because the message reader is a separate
  // forward pass. A forward walk in `parseSession` would answer OLD-MODEL /
  // OLD-TOOL / `old-args` for the row.
  //
  // `toEqual` on the whole row also pins the fourteen emitted keys, including
  // the two that are null on every row (`agentId`, `parentSessionId`) and the
  // two fallbacks that are NOT null: `model: detail.model || channel`
  // (vscode.ts:607) and `tokens: detail.tokens || { input: 0, output: 0 }`
  // (vscode.ts:616).
  it('takes parseSession model, tool and message from the NEWEST records', async () => {
    await withVscodeTree(async (Adapter, userDir) => {
      writeWorkspace(userDir, 'ws-dir', ROOT_PROJECT);
      const file = writeDebugLog(userDir, 'ws-dir', 'dir-session', [
        JSON.stringify({ type: 'llm_request', attrs: { model: 'OLD-MODEL', inputTokens: 1, outputTokens: 1 } }),
        JSON.stringify({ type: 'tool_call', name: 'OLD-TOOL', attrs: { args: 'old-args' }, ts: 1 }),
        JSON.stringify({ type: 'assistant.message', data: { content: 'OLD-MESSAGE' }, timestamp: 2 }),
        JSON.stringify({ type: 'llm_request', attrs: { model: 'NEW-MODEL', inputTokens: 20, outputTokens: 5 } }),
        JSON.stringify({ type: 'tool_call', name: 'NEW-TOOL', attrs: { args: 'new-args' }, ts: 3 }),
        JSON.stringify({ type: 'agent_response', attrs: { response: assistantReply('NEW-MESSAGE') }, ts: 4 }),
      ]);

      const sessions = await sessionsOf(Adapter, ACTIVE_WINDOW_MS);
      expect(sessions.map((s: any) => s.sessionId)).toEqual(['vscode:vscode:ws-dir:dir-session']);
      expect(sessions[0]).toEqual({
        sessionId: 'vscode:vscode:ws-dir:dir-session',
        provider: 'vscode',
        agentId: null,
        agentType: 'main',
        model: 'NEW-MODEL',
        status: 'active',
        lastActivity: mtimeOf(file),
        project: ROOT_PROJECT,
        lastMessage: 'NEW-MESSAGE',
        lastTool: 'NEW-TOOL',
        lastToolInput: 'new-args',
        parentSessionId: null,
        filePath: file,
        tokens: { input: 20, output: 5 },
      });
      // The older records are still visible to the two forward readers.
      expect((await detailOf(Adapter, file)).toolHistory).toEqual([
        { tool: 'OLD-TOOL', detail: 'old-args', ts: 1 },
        { tool: 'NEW-TOOL', detail: 'new-args', ts: 3 },
      ]);
      expect((await detailOf(Adapter, file)).messages).toEqual([
        { role: 'assistant', text: 'NEW-MESSAGE', ts: 4 },
        { role: 'assistant', text: 'OLD-MESSAGE', ts: 2 },
      ]);
      expect((await detailOf(Adapter, file)).tokenUsage).toEqual({ input: 20, output: 5 });
      // The id path reuses the same scan: `found.tokens` is the same reading.
      expect((await unionDetailOf(Adapter, 'vscode:vscode:ws-dir:dir-session', ROOT_PROJECT)).tokenUsage)
        .toEqual({ input: 20, output: 5 });
    });
  });

  // The row's own 300-line window, pinned exactly as the two filePath readers
  // are: a record at line 1 of 301 is invisible (count <= 300) and one at
  // line 2 is visible (count >= 300). Both files are in ONE tree so the model
  // they report can be compared directly, and both are `llm_request`-only, so
  // the model is the single discriminator — the newer record always wins the
  // reverse walk, so only ABSENCE can pin the window from the top edge.
  it('reads parseSession from the last 300 lines, pinned from both edges', async () => {
    await withVscodeTree(async (Adapter, userDir) => {
      const llm = (model: string) =>
        JSON.stringify({ type: 'llm_request', attrs: { model, inputTokens: 3, outputTokens: 4 } });

      writeDebugLog(userDir, 'ws-window', 'model-at-1', windowLines(1, llm('HEAD-MODEL')));
      writeDebugLog(userDir, 'ws-window', 'model-at-2', windowLines(2, llm('WINDOW-MODEL')));
      // Control: unpadded, the same record resolves, so the null model below
      // is the window rather than a record that was never there. Two lines, so
      // `hasRealActivity` sees real activity and the row exists at all.
      writeDebugLog(userDir, 'ws-window', 'model-control', [filler(1), llm('CONTROL-MODEL')]);

      const sessions = await sessionsOf(Adapter, ACTIVE_WINDOW_MS);
      const row = (id: string) => sessions.find((s: any) => s.sessionId === `vscode:vscode:ws-window:${id}`);
      const ids = sessions.map((s: any) => s.sessionId).sort();
      expect(ids).toEqual([
        'vscode:vscode:ws-window:model-at-1',
        'vscode:vscode:ws-window:model-at-2',
        'vscode:vscode:ws-window:model-control',
      ]);

      // Line 1 of 301 is outside the tail: no model, and the two zero fallbacks.
      expect(row('model-at-1')).toMatchObject({
        model: 'vscode',
        lastMessage: null,
        lastTool: null,
        lastToolInput: null,
        tokens: { input: 0, output: 0 },
      });
      // Line 2 of 301 is the first line inside it.
      expect(row('model-at-2')).toMatchObject({ model: 'WINDOW-MODEL', tokens: { input: 3, output: 4 } });
      expect(row('model-control')).toMatchObject({ model: 'CONTROL-MODEL', tokens: { input: 3, output: 4 } });
    });
  });

  // The model's two sources and the channel fallback, all through the row.
  // `!detail.model` guards both branches (:177, :181), so the reverse walk
  // settles on the NEWEST record that names a model at all: `model-wins` meets
  // its `llm_request` first and never reads the older version, while
  // `from-version` has nothing else and is named `copilot-chat@<version>`.
  // `no-data` carries a version under `attrs` rather than `data`, which neither
  // branch reads, so the row falls back to the channel (vscode.ts:607).
  it('names the model from session.start data, or from llm_request, or from the channel', async () => {
    await withVscodeTree(async (Adapter, userDir) => {
      const version = JSON.stringify({ type: 'session.start', data: { vscodeVersion: '1.95.0' } });
      writeDebugLog(userDir, 'ws-ver', 'from-version', [filler(0), version]);
      writeDebugLog(userDir, 'ws-ver', 'model-wins', [
        filler(1),
        version.replace('1.95.0', '9.9.9'),
        JSON.stringify({ type: 'llm_request', attrs: { model: 'explicit-model' } }),
      ]);
      writeDebugLog(userDir, 'ws-ver', 'no-data', [
        filler(2),
        JSON.stringify({ type: 'session.start', attrs: { vscodeVersion: '1.95.0' } }),
      ]);

      const sessions = await sessionsOf(Adapter, ACTIVE_WINDOW_MS);
      expect(sessions.map((s: any) => s.sessionId).sort()).toEqual([
        'vscode:vscode:ws-ver:from-version',
        'vscode:vscode:ws-ver:model-wins',
        'vscode:vscode:ws-ver:no-data',
      ]);
      const row = (id: string) => rowOf(sessions, `vscode:vscode:ws-ver:${id}`);
      expect(row('from-version').model).toBe('copilot-chat@1.95.0');
      expect(row('model-wins').model).toBe('explicit-model');
      expect(row('no-data').model).toBe('vscode');
    });
  });

  // The row's 120 cap on `lastMessage` from an `agent_response`
  // (vscode.ts:212), plus the two guards that make an unreadable record
  // skippable rather than fatal: an `agent_response` with no `attrs` (:210) and
  // an `assistant.message` whose `data.content` is not a string (:215). Both
  // are pinned only in their shipped, skipping form — with `!detail.model`
  // false the walk never breaks, so both records really are visited.
  it('caps the row lastMessage at 120 from an agent_response, skipping unreadable records', async () => {
    await withVscodeTree(async (Adapter, userDir) => {
      writeDebugLog(userDir, 'ws-caps', 'dir-caps', [
        filler(0),
        JSON.stringify({ type: 'assistant.message', data: { content: 42 } }),
        JSON.stringify({ type: 'agent_response', attrs: { response: assistantReply(TEXT150) }, ts: 5 }),
        JSON.stringify({ type: 'tool_call', name: 'CAP-TOOL', attrs: { args: ARG80 }, ts: 6 }),
        JSON.stringify({ type: 'agent_response', ts: 7 }),
      ]);
      writeDebugLog(userDir, 'ws-caps', 'dir-assistant-msg', [
        filler(1),
        JSON.stringify({ type: 'assistant.message', data: { content: TEXT150 }, timestamp: 3 }),
      ]);

      const sessions = await sessionsOf(Adapter, ACTIVE_WINDOW_MS);
      const row = (id: string) => rowOf(sessions, `vscode:vscode:ws-caps:${id}`);
      expect(sessions.map((s: any) => s.sessionId).sort()).toEqual([
        'vscode:vscode:ws-caps:dir-assistant-msg',
        'vscode:vscode:ws-caps:dir-caps',
      ]);

      expect(row('dir-caps')).toMatchObject({
        model: 'vscode',
        lastMessage: TEXT120,
        lastTool: 'CAP-TOOL',
        lastToolInput: ARG60,
        tokens: { input: 0, output: 0 },
      });
      expect(row('dir-caps').lastMessage).toHaveLength(120);
      // The other source of `lastMessage`, with its own 120 cap
      // (vscode.ts:217) rather than the 200 the message reader uses.
      expect(row('dir-assistant-msg')).toMatchObject({
        model: 'vscode',
        lastMessage: TEXT120,
        lastTool: null,
        lastToolInput: null,
      });
      expect(row('dir-assistant-msg').lastMessage).toHaveLength(120);

      // The message reader, for contrast: the same response is read forward and
      // NOT truncated at 120. The `tool_call` and the attrs-less
      // `agent_response` contribute no message row either.
      const detail = await detailOf(Adapter, filePathOf(row('dir-caps')));
      expect(detail.messages).toEqual([
        { role: 'assistant', text: TEXT150, ts: 5 },
      ]);
      expect(detail.messages[0].text).toHaveLength(150);
      expect((await detailOf(Adapter, filePathOf(row('dir-assistant-msg')))).messages).toEqual([
        { role: 'assistant', text: TEXT150, ts: 3 },
      ]);
    });
  });

  // `lastToolInput` comes from `summarizeJson(_, 60)` — 60, not the 120 the
  // detail reader uses and not the unreachable 80 default — via each of the
  // three shapes `parseSession` recognises for a tool (:192, :197, :202). The
  // NULL-vs-EMPTY distinction is the load-bearing part: a tool record with no
  // args at all leaves `lastToolInput` as the empty STRING `''`, while a session
  // with no tool record leaves it `null`. `lastToolInput` is never `undefined`.
  it('fills lastToolInput from all three tool shapes, capped at 60, empty when args is absent', async () => {
    await withVscodeTree(async (Adapter, userDir) => {
      const cases: [string, unknown, string, string][] = [
        ['tc-long', { type: 'tool_call', name: 'T', attrs: { args: ARG80 }, ts: 1 }, 'T', ARG60],
        ['tc-object', { type: 'tool_call', name: 'T', attrs: { args: { p: 'q' } }, ts: 2 }, 'T', '{"p":"q"}'],
        ['tc-noargs', { type: 'tool_call', name: 'T', attrs: {}, ts: 3 }, 'T', ''],
        // No `name` at all, so `entry.name || 'tool_call'` (:193) supplies the
        // row's tool — and no `attrs` at all, so `entry.attrs && entry.attrs.args`
        // (:194) has to survive a missing object.
        ['tc-noname', { type: 'tool_call', attrs: { args: { k: 1 } }, ts: 8 }, 'tool_call', '{"k":1}'],
        ['tc-noattrs', { type: 'tool_call', name: 'T', ts: 9 }, 'T', ''],
        ['es-long', { type: 'tool.execution_start', data: { toolName: 'E', arguments: ARG80 }, timestamp: 4 }, 'E', ARG60],
        ['es-noargs', { type: 'tool.execution_start', data: {}, timestamp: 5 }, 'tool.execution_start', ''],
        ['tr-long', { type: 'assistant.message', data: { toolRequests: [{ name: 'R', arguments: ARG80 }] } }, 'R', ARG60],
        ['tr-noname', { type: 'assistant.message', data: { toolRequests: [{}] } }, 'tool_request', ''],
        // Only `toolRequests[0]` (:204) is read, so the SECOND request's name and
        // arguments must not reach the row.
        ['tr-two', {
          type: 'assistant.message',
          data: { toolRequests: [{ name: 'FIRST-REQ', arguments: 'first-args' }, { name: 'SECOND-REQ', arguments: 'second-args' }] },
        }, 'FIRST-REQ', 'first-args'],
        ['no-tool', { type: 'assistant.message', data: { content: 'plain text' } }, '', ''],
      ];
      for (const [id, record] of cases) {
        // Two lines, so `hasRealActivity` admits the session and the row
        // exists; the record itself is second, so the reverse walk meets it.
        writeDebugLog(userDir, 'ws-tools', id, [filler(0), JSON.stringify(record)]);
      }

      const sessions = await sessionsOf(Adapter, ACTIVE_WINDOW_MS);
      expect(sessions).toHaveLength(cases.length);
      for (const [id, , tool, input] of cases) {
        const row = rowOf(sessions, `vscode:vscode:ws-tools:${id}`);
        if (tool === '') {
          // No tool record: null, not ''.
          expect(row.lastTool).toBeNull();
          expect(row.lastToolInput).toBeNull();
        } else {
          expect(row.lastTool).toBe(tool);
          expect(row.lastToolInput).toBe(input);
        }
      }
      // Only the toolRequests shape reads `toolRequests[0]`, and only a tool
      // record with args leaves `lastToolInput` empty rather than null.
      expect(rowEndingWith(sessions, 'tr-noname').lastToolInput).toBe('');
      expect(rowEndingWith(sessions, 'tc-noattrs').lastToolInput).toBe('');
      expect(rowEndingWith(sessions, 'tr-two').lastToolInput).toBe('first-args');
    });
  });

  // ── parseSession: content.txt branch, through the row ─

  // The whole file, not a 300-line tail. `res-head`'s content.txt is 401 lines
  // and its first 120 characters are a marker that appears nowhere else, so a
  // tail-window read could not produce it. The row's `lastMessage` is that
  // marker, and no model, tool or usage is reported even though the file is
  // full of text — `parseSession` returned at vscode.ts:168.
  it('reads a content.txt whole — its head, not a 300-line tail — and stops there', async () => {
    await withVscodeTree(async (Adapter, userDir) => {
      const body = [HEAD_MARKER, ...Array.from({ length: 400 }, (_, i) => `line-${i}`)].join('\n');
      writeResourceContent(userDir, 'ws-res', 'res-head', 'call_head', `${body}\n`, 1000);
      // The whole body is one JSONL llm_request line. Parsing it would give the
      // row a model and usage; the early return gives it neither, and the only
      // thing that survives is the 120-char head of the raw text.
      writeResourceContent(userDir, 'ws-res', 'res-json', 'call_json', JSON_LLM_REQUEST_LINE, 1000);
      expect(HEAD_MARKER.length).toBe(205);
      expect(JSON_LLM_REQUEST_LINE.length).toBe(86);

      const sessions = await sessionsOf(Adapter, ACTIVE_WINDOW_MS);
      const row = (id: string) => rowOf(sessions, `vscode:vscode:ws-res:${id}`);

      const head = row('res-head');
      expect(head.lastMessage).toBe(HEAD_MARKER_120);
      expect(head.lastMessage).toHaveLength(120);
      expect(head.lastMessage).not.toContain('line-399');
      expect(head).toMatchObject({
        model: 'vscode',
        lastTool: null,
        lastToolInput: null,
        tokens: { input: 0, output: 0 },
      });

      const json = row('res-json');
      expect(json.lastMessage).toBe(JSON_LLM_REQUEST_LINE);
      expect(json.model).toBe('vscode');
      expect(json.model).not.toBe(JSON_LINE_MODEL);
      expect(json.tokens).toEqual({ input: 0, output: 0 });
      expect(json.lastTool).toBeNull();

      // The resource row reports only the NEWEST sibling's text: with a single
      // child that is the one written above, and `filePath` names its file.
      expect(filePathOf(head).endsWith(`${path.sep}call_head${path.sep}content.txt`)).toBe(true);
    });
  });

  // A content.txt is `text.trim()`ed whole (vscode.ts:161) before the 120 cap
  // (:163), so leading and trailing blank lines are gone from the row's
  // `lastMessage`. The trimmed-empty case is deliberately NOT asserted here:
  // a content.txt with no non-whitespace line is never activity
  // (`nonEmptyLines.length >= 1`, vscode.ts:386), so no such row can exist and
  // the `if (normalized)` guard at :162 is unobservable through the public
  // surface. Its outcome IS pinned, one test below, as a filtered-out session.
  it('trims a content.txt whole and caps the trimmed text at 120', async () => {
    await withVscodeTree(async (Adapter, userDir) => {
      writeResourceContent(userDir, 'ws-ws', 'res-space', 'call_a', '\n\n   padded text   \n\n', 1000);
      writeResourceContent(userDir, 'ws-ws', 'res-long', 'call_b', `${TEXT150}\n`, 2000);

      const sessions = await sessionsOf(Adapter, ACTIVE_WINDOW_MS);
      expect(sessions.map((s: any) => s.sessionId)).toEqual([
        'vscode:vscode:ws-ws:res-space',
        'vscode:vscode:ws-ws:res-long',
      ]);
      expect(rowEndingWith(sessions, ':res-space').lastMessage).toBe('padded text');
      const long = rowEndingWith(sessions, ':res-long');
      expect(long.lastMessage).toBe(TEXT120);
      expect(long.lastMessage).toHaveLength(120);
    });
  });

  // ── hasRealActivity ───────────────────────────────────

  // THE HEAD PIN. vscode.ts:380 reads `{ from: 'start', count: 5 }` while every
  // other reader in the file reads `{ from: 'end', ... }`. These seven lines are
  // built so the two windows DISAGREE: the head window (lines 1-5) holds two
  // non-empty lines and passes `nonEmptyLines.length > 1` (:388), while the tail
  // window (lines 3-7) holds one and fails it. Reading the tail drops the
  // session from the listing; reading the head keeps it.
  it('reads the HEAD of a debug log for activity, not the tail', async () => {
    await withVscodeTree(async (Adapter, userDir) => {
      writeWorkspace(userDir, 'ws-head', ROOT_PROJECT);
      const file = writeDebugLog(userDir, 'ws-head', 'head-session', [
        JSON.stringify({ type: 'session_start', attrs: { vscodeVersion: '1.95.0' } }),
        JSON.stringify({ type: 'llm_request', attrs: { model: 'head-model' } }),
        ' ',
        ' ',
        ' ',
        ' ',
        JSON.stringify({ type: 'llm_request', attrs: { model: 'tail-model' } }),
      ]);

      const sessions = await sessionsOf(Adapter, ACTIVE_WINDOW_MS);
      expect(sessions.map((s: any) => s.sessionId)).toEqual(['vscode:vscode:ws-head:head-session']);
      expect(sessions[0].filePath).toBe(file);
      // Same file, opposite window: hasRealActivity decided membership from the
      // HEAD, while the row's model comes from line 7, the only model record in
      // the file, which the 300-line tail read can see.
      expect(sessions[0].model).toBe('tail-model');
    });
  });

  // `count: 5` from both sides, and exactly. `count-low` is six lines whose first
  // five hold two non-empty records, so a `count` of 4 or less drops to one and
  // the session goes; `count-high` is six lines whose first five hold exactly
  // ONE, so shipped it is filtered out and a `count` of 6 would wrongly list it.
// The two together admit no count but 5. Note the first line of each is a
  // non-empty record and not whitespace: `readLines`' head path
  // `content.trim().split('\n')` (jsonl-utils.ts:35) discards LEADING blank
  // lines, so a leading-whitespace fixture would silently measure nothing.
  it('counts exactly the first 5 lines towards activity', async () => {
    await withVscodeTree(async (Adapter, userDir) => {
      writeDebugLog(userDir, 'ws-count', 'count-low', [
        JSON.stringify({ type: 'session_start', attrs: {} }),
        ' ',
        ' ',
        ' ',
        JSON.stringify({ type: 'llm_request', attrs: { model: 'a' } }),
        JSON.stringify({ type: 'tool_call', name: 'T2', attrs: { args: {} }, ts: 2 }),
      ]);
      const low = await sessionsOf(Adapter, ACTIVE_WINDOW_MS);
      expect(low.map((s: any) => s.sessionId)).toEqual(['vscode:vscode:ws-count:count-low']);
    });

    await withVscodeTree(async (Adapter, userDir) => {
      writeDebugLog(userDir, 'ws-count', 'count-high', [
        JSON.stringify({ type: 'session_start', attrs: {} }),
        ' ',
        ' ',
        ' ',
        ' ',
        JSON.stringify({ type: 'llm_request', attrs: { model: 'beyond-the-window' } }),
      ]);
      expect(await sessionsOf(Adapter, ACTIVE_WINDOW_MS)).toEqual([]);
    });
  });

  // A JSONL log needs MORE THAN ONE non-empty line (`> 1`, vscode.ts:388) while
  // a content.txt needs only one (`>= 1`, :386). `one-line` is a debug log with
  // a single record — one non-empty line, so not activity — and `one-text` is a
  // resource content.txt with a single line of text, which is enough. Both
  // thresholds are pinned by the pair, and `blank-ws` (whitespace only) and
  // `blank-empty` (0 bytes) pin the `stat.size === 0` and trimmed-empty cases
  // that no threshold rescues.
  it('needs two lines of JSONL activity but only one line of content.txt', async () => {
    await withVscodeTree(async (Adapter, userDir) => {
      writeDebugLog(userDir, 'ws-act', 'one-line', [
        JSON.stringify({ type: 'session_start', attrs: { vscodeVersion: '1.95.0' } }),
      ]);
      writeResourceContent(userDir, 'ws-act', 'one-text', 'call_a', 'one line of text\n', 1000);
      writeResourceContent(userDir, 'ws-act', 'blank-ws', 'call_b', '   \n', 2000);
      writeResourceContent(userDir, 'ws-act', 'blank-empty', 'call_c', '', 3000);
      // Two non-empty lines in a content.txt is still just text.
      writeResourceContent(userDir, 'ws-act', 'two-text', 'call_d', 'line one\nline two\n', 4000);

      const sessions = await sessionsOf(Adapter, ACTIVE_WINDOW_MS);
      expect(sessions.map((s: any) => s.sessionId)).toEqual([
        'vscode:vscode:ws-act:one-text',
        'vscode:vscode:ws-act:two-text',
      ]);
      // Newest first, by `lastActivity`: one-text is 1s old, two-text 4s.
      // `lastActivity` is optional on the summary, so both are proved present
      // before comparing — an absent one made `toBeGreaterThan` compare
      // `undefined`, which failed without saying which row was missing.
      const [newest, second] = sessions;
      assert(newest && second, 'both listed rows must be present');
      assert(newest.lastActivity !== undefined && second.lastActivity !== undefined,
        'both listed rows must report lastActivity');
      expect(newest.lastActivity).toBeGreaterThan(second.lastActivity);
      // The listed resource rows report the text of the file that was checked.
      const oneText = rowEndingWith(sessions, ':one-text');
      expect(oneText.lastMessage).toBe('one line of text');
      const twoText = rowEndingWith(sessions, ':two-text');
      expect(twoText.lastMessage).toBe('line one\nline two');
    });
  });

  // A missing file and a whitespace-only one are both filtered, and the listing
  // is sorted newest-first by `lastActivity` (vscode.ts:620) — asserted by
  // value here, so the two rows' order is pinned without racing mtimes.
  it('lists the active sessions newest first, and nothing else', async () => {
    await withVscodeTree(async (Adapter, userDir) => {
      writeWorkspace(userDir, 'ws-sort', ROOT_PROJECT);
      const older = writeDebugLog(userDir, 'ws-sort', 'older', [
        JSON.stringify({ type: 'session_start', attrs: {} }),
        JSON.stringify({ type: 'assistant.message', data: { content: 'older' }, timestamp: 1 }),
      ]);
      const newer = writeDebugLog(userDir, 'ws-sort', 'newer', [
        JSON.stringify({ type: 'session_start', attrs: {} }),
        JSON.stringify({ type: 'assistant.message', data: { content: 'newer' }, timestamp: 2 }),
      ]);
      const olderAt = Date.now() - 30_000;
      fs.utimesSync(older, new Date(olderAt), new Date(olderAt));
      expect(mtimeOf(newer)).toBeGreaterThan(mtimeOf(older));

      const sessions = await sessionsOf(Adapter, ACTIVE_WINDOW_MS);
      expect(sessions.map((s: any) => s.sessionId)).toEqual([
        'vscode:vscode:ws-sort:newer',
        'vscode:vscode:ws-sort:older',
      ]);
      expect(sessions.map((s: any) => s.lastActivity)).toEqual([mtimeOf(newer), mtimeOf(older)]);
      expect(sessions.map((s: any) => s.lastMessage)).toEqual(['newer', 'older']);
    });
  });

  // ─── #144: a DIRECTORY whose NAME matches the session-file filter ───
  //
  // The transcripts listing (vscode.ts:175, filtered four lines later at :182) is
  // a BARE `readdir`, so its entries arrive as `string[]` and the `.jsonl` filter
  // can ask about the NAME and nothing else. Note the filter is NOT adjacent to
  // its `readdir` — a mechanical "add isFile() next to the readdir" pass misses
  // it, which is why this case pins the observable rather than the line.
  //
  // A DIRECTORY named to match passes, `stat`s fine and is stat'd again by
  // `hasRealActivity`, which then reads it: `readLines` gets EISDIR and returns
  // zero lines (jsonl-utils.ts:57), so `hasRealActivity` answers false and the
  // candidate is dropped. The phantom row therefore NEVER reaches the listing —
  // this site SELF-NEUTRALISES, and a row-count assertion cannot be made red.
  // The observable is whether the adapter ATTEMPTED the read at all, which is
  // exactly what the `isFile()` term decides. Both halves are asserted.
  it('reads no transcript through a directory named *.jsonl, and does not try to read it', async () => {
    await withVscodeTree(async (Adapter, userDir) => {
      const transcriptsDir = path.join(
        userDir, 'workspaceStorage', 'ws-dir', 'GitHub.copilot-chat', 'transcripts',
      );
      fs.mkdirSync(transcriptsDir, { recursive: true });
      const real = path.join(transcriptsDir, 'real1.jsonl');
      fs.writeFileSync(real, [
        JSON.stringify({ type: 'session_start', attrs: {} }),
        JSON.stringify({ type: 'assistant.message', data: { content: 'real done' }, timestamp: 1 }),
        '',
      ].join('\n'));
      // The decoy: a DIRECTORY whose name satisfies the `.jsonl` filter.
      const decoy = path.join(transcriptsDir, 'dirdecoy.jsonl');
      fs.mkdirSync(decoy, { recursive: true });

      const { result, lines } = await withDebug(() => sessionsOf(Adapter, ACTIVE_WINDOW_MS));

      expect(result.map((s: any) => s.sessionId)).toEqual(['vscode:vscode:ws-dir:real1']);
      // No `readLines(start)` envelope from the `vscode-activity` scope for ANY
      // transcript: the decoy is dropped by `isFile()` before the read, not
      // rescued by the catch after it.
      expect(lines.filter((l) => l.includes('readLines(start)') && l.includes('transcripts'))).toEqual([]);
      expect(fs.statSync(decoy).isDirectory()).toBe(true);
    });
  });
});