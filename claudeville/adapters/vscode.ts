/**
 * VS Code / VS Code Insiders Copilot Chat adapter
 * Data source:
 *   ~/Library/Application Support/Code/User/workspaceStorage/<workspaceId>/GitHub.copilot-chat/debug-logs/<sessionId>/main.jsonl
 *   ~/Library/Application Support/Code - Insiders/User/workspaceStorage/<workspaceId>/GitHub.copilot-chat/debug-logs/<sessionId>/main.jsonl
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

import type { AgentAdapter, WatchPath } from '../../shared/types.js';
import { debugAdapterError, readLines, readJsonlEntries, foldEntries, foldJsonl } from './jsonl-utils.js';

const VSCODE_USER_DIR = process.env.VSCODE_USER_DATA_DIR
  || path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User');
const VSCODE_INSIDERS_USER_DIR = process.env.VSCODE_INSIDERS_USER_DATA_DIR
  || path.join(os.homedir(), 'Library', 'Application Support', 'Code - Insiders', 'User');
const VSCODE_CURSOR_DIR = process.env.VSCODE_CURSOR_USER_DATA_DIR
  || path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User');
const VSCODE_OFFSET_DIR = process.env.VSCODE_OFFSET_USER_DATA_DIR
  || path.join(os.homedir(), 'Library', 'Application Support', 'Offset', 'User');

const STORAGE_ROOTS = [
  { channel: 'vscode', workspaceStorageDir: path.join(VSCODE_USER_DIR, 'workspaceStorage') },
  { channel: 'vscode-insiders', workspaceStorageDir: path.join(VSCODE_INSIDERS_USER_DIR, 'workspaceStorage') },
  { channel: 'cursor', workspaceStorageDir: path.join(VSCODE_CURSOR_DIR, 'workspaceStorage') },
  { channel: 'offset', workspaceStorageDir: path.join(VSCODE_OFFSET_DIR, 'workspaceStorage') },
].filter(root => root.workspaceStorageDir);

type Dirent = { name: string; isDirectory(): boolean; isFile(): boolean };

const DEFAULT_MIN_ACTIVE_WINDOW_MS = 30 * 60 * 1000;
const MIN_ACTIVE_WINDOW_MS = Math.max(
  60 * 1000,
  Number(process.env.VSCODE_ACTIVE_WINDOW_MS || DEFAULT_MIN_ACTIVE_WINDOW_MS)
);

const SOURCE_PRIORITY = {
  debug: 3,
  transcript: 2,
  resource: 1,
};

type ResourceSessionCandidate = {
  channel: string;
  workspaceId: string;
  rawSessionId: string;
  sourceType: 'debug' | 'transcript' | 'resource';
  filePath: string;
  project: string;
  mtime: number;
  tokens: { input: number; output: number } | null;
};

function shouldReplaceCandidate(existing: { sourceType: string; mtime: number } | null | undefined, incoming: { sourceType: string; mtime: number } | null | undefined): boolean {
  if (!existing) return true;
  if (!incoming) return false;
  const existingPriority = SOURCE_PRIORITY[existing.sourceType as keyof typeof SOURCE_PRIORITY] || 0;
  const incomingPriority = SOURCE_PRIORITY[incoming.sourceType as keyof typeof SOURCE_PRIORITY] || 0;

  if (incomingPriority > existingPriority) return true;
  if (incomingPriority < existingPriority) return false;

  return incoming.mtime > existing.mtime;
}

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

/**
 * The one window every JSONL reader below reads: the LAST 300 lines.
 *
 * `parseSession`, `getToolHistory` and `getRecentMessages` share it, and a drift
 * between them is invisible in review and subtle in the UI — a shorter window
 * drops old records from one pane and not the other. The fixture pins `300`
 * exactly for all three. `from: 'end'` is also the `readLines` default, so it is
 * stated rather than relied on.
 */
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
  // read as text — whole, trimmed, head-capped — and there is nothing to fold. A
  // >300-line `content.txt` therefore reports its HEAD, unlike the JSONL path, so
  // routing this branch through a JSONL helper would silently take its tail.
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
    // The old `break`. `foldEntries` consults `until` after every entry, exactly
    // where the `break` sat. A pure optimisation — every write sits behind a
    // guard — but kept so the early exit stays visible.
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

  // GROUPED BY TYPE — agent_response rows, then assistant.message rows — not
  // file order. See `MessageBuckets`.
  messages.push(...buckets.agentResponse, ...buckets.assistantMessage);

  return messages.slice(-maxItems);
}

async function getTokenUsage(filePath: string): Promise<{ input: number; output: number } | null> {
  const parsed = await parseSession(filePath);
  return parsed.tokens;
}

async function readWorkspacePath(workspaceDir: string): Promise<string | null> {
  const workspaceFile = path.join(workspaceDir, 'workspace.json');
  if (!fs.existsSync(workspaceFile)) return null;

  try {
    const raw = await fs.promises.readFile(workspaceFile, 'utf-8');
    const json = JSON.parse(raw);

    const uri = json.folder || json.workspace || null;
    if (typeof uri === 'string' && uri.startsWith('file://')) {
      return decodeURIComponent(uri.replace('file://', ''));
    }
  } catch (err) {
    debugAdapterError('vscode', 'readWorkspacePath', err, workspaceFile);
  }

  return null;
}

function buildSessionId(channel: string, workspaceId: string, debugLogId: string) {
  return `vscode:${channel}:${workspaceId}:${debugLogId}`;
}

function parseSessionId(sessionId: string): { channel: string; workspaceId: string; debugLogId: string } | null {
  if (!sessionId.startsWith('vscode:')) return null;
  const parts = sessionId.split(':');
  if (parts.length < 4) return null;
  return {
    channel: parts[1],
    workspaceId: parts[2],
    debugLogId: parts.slice(3).join(':'),
  };
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

async function scanAllSessions(activeThresholdMs: number) {
  const now = Date.now();
  const effectiveThresholdMs = Math.max(Number(activeThresholdMs || 0), MIN_ACTIVE_WINDOW_MS);
  const results: ResourceSessionCandidate[] = [];

  for (const root of STORAGE_ROOTS) {
    if (!fs.existsSync(root.workspaceStorageDir)) continue;

    let workspaceDirs: Dirent[] = [];
    try {
      workspaceDirs = await fs.promises.readdir(root.workspaceStorageDir, { withFileTypes: true });
    } catch (err) {
      debugAdapterError('vscode', 'scanAllSessions readdir workspaceStorage', err, root.workspaceStorageDir);
      continue;
    }

    const entries = await Promise.all(workspaceDirs
      .filter((d: Dirent) => d.isDirectory())
      .map(async (workspaceDir: Dirent): Promise<ResourceSessionCandidate[]> => {
        const workspaceId = workspaceDir.name;
        const workspacePath = path.join(root.workspaceStorageDir, workspaceId);
        const copilotChatDir = path.join(workspacePath, 'GitHub.copilot-chat');
        if (!fs.existsSync(copilotChatDir)) return [];

        const workspaceProject = await readWorkspacePath(workspacePath);
        const candidates: ResourceSessionCandidate[] = [];

        // legacy/new debug logs
        const debugLogsDir = path.join(copilotChatDir, 'debug-logs');
        if (fs.existsSync(debugLogsDir)) {
          let debugLogDirs: Dirent[] = [];
          try {
            debugLogDirs = await fs.promises.readdir(debugLogsDir, { withFileTypes: true });
          } catch (err) {
            debugAdapterError('vscode', 'scanAllSessions readdir debug-logs', err, debugLogsDir);
            debugLogDirs = [];
          }

          const debugEntries = await Promise.all(debugLogDirs
            .filter((d: Dirent) => d.isDirectory())
            .map(async (logDir: Dirent): Promise<ResourceSessionCandidate | null> => {
              const mainLogFile = path.join(debugLogsDir, logDir.name, 'main.jsonl');
              if (!fs.existsSync(mainLogFile)) return null;

              try {
                const stat = await fs.promises.stat(mainLogFile);
                if (now - stat.mtimeMs > effectiveThresholdMs) return null;
                // Filter out blank new-chat tabs (opened but never used)
                if (!(await hasRealActivity(mainLogFile))) return null;
                return {
                  channel: root.channel,
                  workspaceId,
                  rawSessionId: logDir.name,
                  sourceType: 'debug',
                  filePath: mainLogFile,
                  project: workspaceProject || `vscode:${root.channel}:${workspaceId}`,
                  mtime: stat.mtimeMs,
                  tokens: (await parseSession(mainLogFile)).tokens,
                };
              } catch (err) {
                debugAdapterError('vscode', 'scanAllSessions stat debug log', err, mainLogFile);
                return null;
              }
            }));

          candidates.push(...debugEntries.filter((item): item is ResourceSessionCandidate => item !== null));
        }

        // transcript jsonl
        const transcriptsDir = path.join(copilotChatDir, 'transcripts');
        if (fs.existsSync(transcriptsDir)) {
          let transcriptFiles: string[] = [];
          try {
            transcriptFiles = await fs.promises.readdir(transcriptsDir);
          } catch (err) {
            debugAdapterError('vscode', 'scanAllSessions readdir transcripts', err, transcriptsDir);
            transcriptFiles = [];
          }

          const transcriptEntries = await Promise.all(transcriptFiles
            .filter((f: string) => f.endsWith('.jsonl'))
            .map(async (file: string): Promise<ResourceSessionCandidate | null> => {
              const transcriptPath = path.join(transcriptsDir, file);
              try {
                const stat = await fs.promises.stat(transcriptPath);
                if (now - stat.mtimeMs > effectiveThresholdMs) return null;
                if (!(await hasRealActivity(transcriptPath))) return null;

                return {
                  channel: root.channel,
                  workspaceId,
                  rawSessionId: file.replace('.jsonl', ''),
                  sourceType: 'transcript',
                  filePath: transcriptPath,
                  project: workspaceProject || `vscode:${root.channel}:${workspaceId}`,
                  mtime: stat.mtimeMs,
                  tokens: (await parseSession(transcriptPath)).tokens,
                };
              } catch (err) {
                debugAdapterError('vscode', 'scanAllSessions stat transcript', err, transcriptPath);
                return null;
              }
            }));

          candidates.push(...transcriptEntries.filter((item): item is ResourceSessionCandidate => item !== null));
        }

        // live chat resources (often newest while a turn is running)
        const resourcesDir = path.join(copilotChatDir, 'chat-session-resources');
        if (fs.existsSync(resourcesDir)) {
          let sessionDirs: Dirent[] = [];
          try {
            sessionDirs = await fs.promises.readdir(resourcesDir, { withFileTypes: true });
          } catch (err) {
            debugAdapterError('vscode', 'scanAllSessions readdir resources', err, resourcesDir);
            sessionDirs = [];
          }

          const resourceEntries = await Promise.all(sessionDirs
            .filter((d: Dirent) => d.isDirectory())
            .map(async (sessionDir: Dirent): Promise<ResourceSessionCandidate | null> => {
              const sessionRoot = path.join(resourcesDir, sessionDir.name);
              let toolDirs: Dirent[] = [];
              try {
                toolDirs = await fs.promises.readdir(sessionRoot, { withFileTypes: true });
              } catch (err) {
                debugAdapterError('vscode', 'scanAllSessions readdir resource session', err, sessionRoot);
                return null;
              }

              const statPromises = toolDirs.map(async (td: Dirent) => {
                if (!td.isDirectory()) return null;
                const contentFile = path.join(sessionRoot, td.name, 'content.txt');
                if (!fs.existsSync(contentFile)) return null;
                try {
                  const stat = await fs.promises.stat(contentFile);
                  return { filePath: contentFile, mtime: stat.mtimeMs };
                } catch (err) {
                  debugAdapterError('vscode', 'scanAllSessions stat content', err, contentFile);
                  return null;
                }
              });

              const stats = await Promise.all(statPromises);
              let newest: { filePath: string; mtime: number } | null = null;
              for (const stat of stats) {
                if (stat && (!newest || stat.mtime > newest.mtime)) {
                  newest = stat;
                }
              }

              if (!newest) return null;
              if (now - newest.mtime > effectiveThresholdMs) return null;
              // Filter out blank sessions
              if (!(await hasRealActivity(newest.filePath))) return null;

              return {
                channel: root.channel,
                workspaceId,
                rawSessionId: sessionDir.name,
                sourceType: 'resource',
                filePath: newest.filePath,
                project: workspaceProject || `vscode:${root.channel}:${workspaceId}`,
                mtime: newest.mtime,
                tokens: (await parseSession(newest.filePath)).tokens,
              };
            }));

          candidates.push(...resourceEntries.filter((item): item is ResourceSessionCandidate => item !== null));
        }
        // dedupe by raw session key, keep newest source
        const bySession = new Map<string, ResourceSessionCandidate>();
        for (const item of candidates) {
          const candidate = item;
          if (!candidate) continue;
          const key = `${candidate.channel}:${candidate.workspaceId}:${candidate.rawSessionId}`;
          const existing = bySession.get(key);
          if (shouldReplaceCandidate(existing, candidate ?? null)) {
            bySession.set(key, candidate);
          }
        }

        return Array.from(bySession.values());
      }));

    for (const group of entries) {
      results.push(...group);
    }
  }

  return results;
}

export class VSCodeAdapter implements AgentAdapter {
  get name() { return 'VS Code Copilot Chat'; }
  get provider() { return 'vscode'; }
  // Primary VS Code user dir; the Insiders dir is also scanned (see STORAGE_ROOTS)
  // but homeDir stays a single path for display/consumers.
  get homeDir() { return VSCODE_USER_DIR; }

  isAvailable() {
    return STORAGE_ROOTS.some(root => fs.existsSync(root.workspaceStorageDir));
  }

  async getActiveSessions(activeThresholdMs: number) {
    const logs = await scanAllSessions(activeThresholdMs);
    const sessions = await Promise.all(logs.map(async ({ channel, workspaceId, rawSessionId, filePath, project, mtime }) => {
      const detail = await parseSession(filePath);
      return {
        sessionId: buildSessionId(channel, workspaceId, rawSessionId),
        provider: 'vscode',
        agentId: null,
        agentType: 'main',
        model: detail.model || channel,
        status: 'active',
        lastActivity: mtime,
        project,
        lastMessage: detail.lastMessage,
        lastTool: detail.lastTool,
        lastToolInput: detail.lastToolInput,
        parentSessionId: null,
        filePath,
        tokens: detail.tokens || { input: 0, output: 0 },
      };
    }));

    return sessions.sort((a, b) => b.lastActivity - a.lastActivity);
  }

  async getSessionDetail(sessionId: string, project: string | null, filePath: string | null = null) {
    if (filePath) {
      const [toolHistory, messages, tokenUsage] = await Promise.all([
        getToolHistory(filePath),
        getRecentMessages(filePath),
        getTokenUsage(filePath),
      ]);
      return { toolHistory, messages, tokenUsage, sessionId };
    }

    const parsed = parseSessionId(sessionId);
    if (!parsed) return { toolHistory: [], messages: [] };

    const sessions = await scanAllSessions(30 * 60 * 1000);
    const found = sessions.find(s => (
      s.channel === parsed.channel
      && s.workspaceId === parsed.workspaceId
      && s.rawSessionId === parsed.debugLogId
    ));

    if (!found) return { toolHistory: [], messages: [] };

    return {
      toolHistory: await getToolHistory(found.filePath),
      messages: await getRecentMessages(found.filePath),
      tokenUsage: found.tokens ?? null,
      sessionId,
    };
  }

  getWatchPaths(): WatchPath[] {
    const paths: WatchPath[] = [];
    for (const root of STORAGE_ROOTS) {
      if (!fs.existsSync(root.workspaceStorageDir)) continue;
      paths.push({
        type: 'directory',
        path: root.workspaceStorageDir,
        recursive: true,
        filter: '.jsonl',
      });
      paths.push({
        type: 'directory',
        path: root.workspaceStorageDir,
        recursive: true,
        filter: 'content.txt',
      });
    }
    return paths;
  }
}
