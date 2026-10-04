/**
 * The format-specific readers for the VS Code / VS Code Insiders Copilot Chat
 * adapter, split out of `vscode.ts` for file size. `vscode.ts` stays the entry
 * point and owns the adapter class and the scan; the dependency is one-way.
 */
import fs from 'fs';
import path from 'path';

import { debugAdapterError, readLines, readJsonlEntries, foldEntries, foldJsonl } from './jsonl-utils.js';
import type { Dirent } from './scan-utils.js';

function summarizeJson(value: unknown, maxLength = 80) {
  if (value === null || value === undefined) return '';
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return raw.substring(0, maxLength);
}

function getResourceSessionRoot(filePath: string): string | null {
  if (!filePath.endsWith('content.txt')) return null;
  const callDir = path.dirname(filePath);
  return path.dirname(callDir);
}

async function scanResourceSessionContents(filePath: string): Promise<Array<{ callId: string; filePath: string; text: string; ts: number }>> {
  const sessionRoot = getResourceSessionRoot(filePath);
  if (!sessionRoot || !fs.existsSync(sessionRoot)) return [];

  let entries: Array<{ callId: string; filePath: string; text: string; ts: number }> = [];
  try {
    const children = await fs.promises.readdir(sessionRoot, { withFileTypes: true });
    const contentRows = await Promise.all(children
      .filter((d: Dirent) => d.isDirectory())
      .map(async (dirent: Dirent) => {
        const contentPath = path.join(sessionRoot, dirent.name, 'content.txt');
        if (!fs.existsSync(contentPath)) return null;
        try {
          const [text, stat] = await Promise.all([
            fs.promises.readFile(contentPath, 'utf-8'),
            fs.promises.stat(contentPath),
          ]);
          return {
            callId: dirent.name,
            filePath: contentPath,
            text: String(text || '').trim(),
            ts: stat.mtimeMs,
          };
        } catch (err) {
          debugAdapterError('vscode', 'scanResourceSessionContents file', err, contentPath);
          return null;
        }
      }));

    entries = contentRows.filter((item): item is { callId: string; filePath: string; text: string; ts: number } => item !== null).sort((a, b) => a.ts - b.ts);
  } catch (err) {
    debugAdapterError('vscode', 'scanResourceSessionContents', err, sessionRoot);
    entries = [];
  }

  return entries;
}

function extractAssistantText(responseRaw: string) {
  if (typeof responseRaw !== 'string' || responseRaw.trim().length === 0) return '';

  try {
    const response = JSON.parse(responseRaw);
    if (!Array.isArray(response)) return '';

    for (let i = response.length - 1; i >= 0; i--) {
      const message = response[i];
      if (!message || message.role !== 'assistant' || !Array.isArray(message.parts)) continue;
      for (const part of message.parts) {
        if (part && part.type === 'text' && typeof part.content === 'string') {
          const text = part.content.trim();
          if (text.length > 0) return text;
        }
      }
    }
  } catch (err) {
    debugAdapterError('vscode', 'extractAssistantText', err, responseRaw.substring(0, 120));
    // JSON parse failed; don't return garbage
    return '';
  }

  return '';
}

type SessionDetail = {
  model: string | null;
  lastTool: string | null;
  lastToolInput: string | null;
  lastMessage: string | null;
  tokens: { input: number; output: number } | null;
};

/** The one window every JSONL reader below reads: the LAST 300 lines. */
const SESSION_TAIL = { from: 'end', count: 300, scope: 'vscode' } as const;

/**
 * The activity probe reads the HEAD — the opposite window from every other read
 * in this file — and `readLines` DEFAULTS `from` to `'end'`. That default is why
 * this is a named constant and not an inline option bag: dropping `from` is a
 * one-token edit that looks like a no-op and reclassifies every blank-tab
 * session as active. Pinned from both directions.
 */
const ACTIVITY_HEAD = { from: 'start', count: 5, scope: 'vscode-activity' } as const;

/**
 * The accumulator step for `parseSession`. It mutates `detail` in place and
 * returns nothing: `foldEntries` discards an `onEntry` return value, so the
 * tempting `(acc, e) => ({ ...acc, model: e.model })` typechecks against a
 * `=> void` signature and silently returns `init` — an all-null session.
 *
 * The `!detail.lastX` guards are per-field, not a global stop: the walk
 * continues past the first match to fill the OTHER fields.
 */
function foldSessionEntry(detail: SessionDetail, entry: any) {
  if (!detail.model && entry.type === 'llm_request' && entry.attrs && entry.attrs.model) {
    detail.model = entry.attrs.model;
  }

  if (!detail.model && entry.type === 'session.start' && entry.data && entry.data.vscodeVersion) {
    detail.model = `copilot-chat@${entry.data.vscodeVersion}`;
  }

  if (!detail.tokens && entry.type === 'llm_request' && entry.attrs) {
    detail.tokens = {
      input: Number(entry.attrs.inputTokens || 0),
      output: Number(entry.attrs.outputTokens || 0),
    };
  }

  if (!detail.lastTool && entry.type === 'tool_call') {
    detail.lastTool = entry.name || 'tool_call';
    detail.lastToolInput = summarizeJson(entry.attrs && entry.attrs.args, 60);
  }

  if (!detail.lastTool && entry.type === 'tool.execution_start' && entry.data) {
    detail.lastTool = entry.data.toolName || 'tool.execution_start';
    detail.lastToolInput = summarizeJson(entry.data.arguments, 60);
  }

  if (!detail.lastTool && entry.type === 'assistant.message' && entry.data && Array.isArray(entry.data.toolRequests)) {
    const req = entry.data.toolRequests[0];
    if (req) {
      detail.lastTool = req.name || 'tool_request';
      detail.lastToolInput = summarizeJson(req.arguments, 60);
    }
  }

  if (!detail.lastMessage && entry.type === 'agent_response' && entry.attrs) {
    const text = extractAssistantText(entry.attrs.response);
    if (text) detail.lastMessage = text.substring(0, 120);
  }

  if (!detail.lastMessage && entry.type === 'assistant.message' && entry.data && typeof entry.data.content === 'string') {
    const text = entry.data.content.trim();
    if (text) detail.lastMessage = text.substring(0, 120);
  }
}

async function parseSession(filePath: string) {
  const detail: SessionDetail = {
    model: null,
    lastTool: null,
    lastToolInput: null,
    lastMessage: null,
    tokens: null,
  };

// A `content.txt` is not JSONL at all: the whole file is one message, so it is
  // read as text — whole, trimmed, head-capped. A >300-line `content.txt`
  // therefore reports its HEAD, unlike the JSONL path.
  if (filePath.endsWith('content.txt')) {
    try {
      const text = await fs.promises.readFile(filePath, 'utf-8');
      const normalized = text.trim();
      if (normalized) {
        detail.lastMessage = normalized.substring(0, 120);
      }
    } catch (err) {
      debugAdapterError('vscode', 'parseSession content.txt', err, filePath);
    }
    return detail;
  }

  // `readJsonlEntries` + `foldEntries`, deliberately NOT `foldJsonl`: that helper
  // wraps the fold in a catch and returns `init` on a throw, and this reader has
  // never had a catch. `scanAllSessions` relies on the throw — it wraps
  // `(await parseSession(file)).tokens` in its own try and DROPS the candidate —
  // so swallowing here would silently change which sessions it returns. The
  // fixture pins it: removing any `entry.data`/`entry.attrs` guard in
  // `foldSessionEntry` is red, and goes green under `foldJsonl` for that reason.
  const entries = await readJsonlEntries(filePath, { ...SESSION_TAIL });

  // NEWEST-FIRST, and load-bearing. This walk has always been
  // `for (let i = entries.length - 1; i >= 0; i--)`, so under the
  // `!detail.lastX` guards the first match is the genuinely LATEST tool and
  // message — which is what the field names claim. Do NOT harmonise this with
  // `getToolHistory`/`getRecentMessages`, which walk FORWARD on purpose.
  return foldEntries<SessionDetail>([...entries].reverse(), {
    init: detail,
    onEntry: foldSessionEntry,
    // `until` sits exactly where the old `break` did. A pure optimisation —
    // every write is already guarded — kept so the early exit stays visible.
    until: acc => Boolean(acc.model && acc.lastMessage && acc.lastTool),
  });
}

type ToolEvent = { tool: string; detail: string; ts: number };

/**
 * The two buckets `getToolHistory` accumulates, and the reason they exist.
 *
 * The reader this replaces ran TWO forward passes over the same entries — one
 * for `tool_call`, one for `tool.execution_start` — pushing into ONE list. The
 * emitted order is therefore GROUPED BY RECORD TYPE, not file order: an
 * `tool.execution_start` sitting between two `tool_call` records is still listed
 * after both. A one-pass `collectJsonl` or `foldJsonl` emits in FILE order, which
 * interleaves the two types and — the result is then `slice(-maxItems)` — changes
 * which records survive at all. A different list, not merely a different order.
 *
 * Hence one fold pass filling two buckets, with the concatenation reapplied at
 * the call site: one file read, grouping intact.
 */
type ToolBuckets = { toolCall: ToolEvent[]; executionStart: ToolEvent[] };

async function getToolHistory(filePath: string, maxItems = 15) {
  const tools: ToolEvent[] = [];

  if (filePath.endsWith('content.txt')) {
    const entries = await scanResourceSessionContents(filePath);
    for (const entry of entries) {
      tools.push({
        tool: entry.callId.startsWith('toolu_') ? 'tool_result' : 'call_result',
        detail: entry.callId.substring(0, 120),
        ts: typeof entry.ts === 'number' ? entry.ts : 0,
      });
    }
    return tools.slice(-maxItems);
  }

  const buckets = await foldJsonl<ToolBuckets>(filePath, {
    operation: 'getToolHistory',
    ...SESSION_TAIL,  // scope: 'vscode'
    // FORWARD, unlike `parseSession`: both passes this replaces were
    // `for (const entry of entries)` and each bucket must stay in file order.
    // Do NOT "harmonise" this with the detail read above by reversing the walk.
    init: { toolCall: [], executionStart: [] },
    onEntry: (acc, entry) => {
      if (entry.type === 'tool_call') {
        acc.toolCall.push({
          tool: entry.name || 'tool_call',
          detail: summarizeJson(entry.attrs && entry.attrs.args, 120),
          ts: typeof entry.ts === 'number' ? entry.ts : 0,
        });
      } else if (entry.type === 'tool.execution_start' && entry.data) {
        acc.executionStart.push({
          tool: entry.data.toolName || 'tool.execution_start',
          detail: summarizeJson(entry.data.arguments, 120),
          ts: typeof entry.timestamp === 'number' ? entry.timestamp : 0,
        });
      }
    },
  });

  // GROUPED BY TYPE, in the order the two old passes appended: tool_call rows
  // first, then tool.execution_start rows. Deliberately NOT file order.
  tools.push(...buckets.toolCall, ...buckets.executionStart);

  return tools.slice(-maxItems);
}

type ChatMessage = { role: string; text: string; ts: number };

/**
 * Same two-bucket problem as `ToolBuckets`, same fix, same reason: two forward
 * passes — `agent_response` then `assistant.message` — into one list, so the
 * order is grouped by record type and `slice(-maxItems)` is applied to the
 * concatenation.
 */
type MessageBuckets = { agentResponse: ChatMessage[]; assistantMessage: ChatMessage[] };

async function getRecentMessages(filePath: string, maxItems = 5) {
  const messages: ChatMessage[] = [];

  if (filePath.endsWith('content.txt')) {
    const entries = await scanResourceSessionContents(filePath);
    for (const entry of entries) {
      if (!entry.text) continue;
      messages.push({
        role: 'assistant',
        text: entry.text.substring(0, 200),
        ts: typeof entry.ts === 'number' ? entry.ts : 0,
      });
    }

    // preserve file text if messages are empty
    // (unreachable — the file being read is always one of the siblings listed
    // above. Left exactly as shipped: dead, but not this commit's to delete, and
    // its observable outcome — [] for a whitespace-only file — is pinned.)
    if (messages.length === 0) {
      try {
        const text = (await fs.promises.readFile(filePath, 'utf-8')).trim();
        if (text) {
          messages.push({
            role: 'assistant',
            text: text.substring(0, 200),
            ts: fs.existsSync(filePath) ? fs.statSync(filePath).mtimeMs : 0,
          });
        }
      } catch (err) {
        debugAdapterError('vscode', 'getRecentMessages content.txt', err, filePath);
      }
    }

    return messages.slice(-maxItems);
  }

  const buckets = await foldJsonl<MessageBuckets>(filePath, {
    operation: 'getRecentMessages',
    ...SESSION_TAIL,  // scope: 'vscode'
    // FORWARD, as both replaced passes were. See `ToolBuckets`.
    init: { agentResponse: [], assistantMessage: [] },
    onEntry: (acc, entry) => {
      if (entry.type === 'agent_response' && entry.attrs) {
        const text = extractAssistantText(entry.attrs.response);
        if (text) {
          acc.agentResponse.push({
            role: 'assistant',
            text: text.substring(0, 200),
            ts: typeof entry.ts === 'number' ? entry.ts : 0,
          });
        }
      } else if (entry.type === 'assistant.message' && entry.data && typeof entry.data.content === 'string') {
        const text = entry.data.content.trim();
        if (text) {
          acc.assistantMessage.push({
            role: 'assistant',
            text: text.substring(0, 200),
            ts: typeof entry.timestamp === 'number' ? entry.timestamp : 0,
          });
        }
      }
    },
  });

  // Grouped by type, not file order — see `MessageBuckets`.
  messages.push(...buckets.agentResponse, ...buckets.assistantMessage);

  return messages.slice(-maxItems);
}

async function getTokenUsage(filePath: string): Promise<{ input: number; output: number } | null> {
  const parsed = await parseSession(filePath);
  return parsed.tokens;
}

async function hasRealActivity(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size === 0) return false;

    // Optimize: Read only the first 5 lines to check for content/metadata.
    // Stays on `readLines` rather than a fold because it counts RAW lines: it
    // has to see unparseable ones that a JSONL parse would drop on the floor.
    const lines = await readLines(filePath, ACTIVITY_HEAD);
    const nonEmptyLines = lines.filter(ln => ln.trim().length > 0);

    // JSONL files (debug logs, transcripts): require session_start + at least one real event
    // content.txt text files: one line of actual text counts as real activity
    if (filePath.endsWith('content.txt')) {
      return nonEmptyLines.length >= 1;
    }
    return nonEmptyLines.length > 1;
  } catch {
    return false;
  }
}

export { parseSession, hasRealActivity, getToolHistory, getRecentMessages, getTokenUsage };
