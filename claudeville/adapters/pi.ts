/**
 * Pi Coding Agent adapter
 * Data source: ~/.pi/agent/sessions/
 *
 * Session format (JSONL):
 *   {"type":"session","version":3,"id":"...","timestamp":"...","cwd":"..."}
 *   {"type":"model_change","provider":"minimax","modelId":"MiniMax-M2.7"}
 *   {"type":"message","message":{"role":"user","content":[{"type":"text","text":"..."}]}}
 *   {"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","name":"bash","arguments":{...}}],"usage":{...}}}
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

import type { AdapterDetailResult, AdapterSessionsResult, AgentAdapter, WatchPath } from '../../shared/types.js';
import { debugAdapterError, collectJsonl, foldJsonl } from './jsonl-utils.js';
import { collectScanByMtime } from './scan-utils.js';
import { combineSources, degradedWarnings, detailFailed, detailOk, emptyDetail, sourceDetail } from './sources.js';
import { summarizeToolInput } from './sanitize.js';
import { extractText } from './text-utils.js';
import type { Dirent } from './scan-utils.js';

const PI_DIR = path.join(os.homedir(), '.pi');
const SESSIONS_DIR = path.join(PI_DIR, 'agent', 'sessions');

// ─── Utility ─────────────────────────────────────────────

// ─── Session parsing ──────────────────────────────────────

type SessionDetail = {
  model: string | null;
  provider: string | null;
  project: string | null;
  lastTool: string | null;
  lastToolInput: string | null;
  lastMessage: string | null;
};

export async function parseSession(filePath: string): Promise<SessionDetail> {
  // `reverse: true` walks the tail window newest-first, which is the direction
  // this scan always ran in; `from` stays at its `'end'` default.
  return foldJsonl<SessionDetail>(filePath, {
    scope: 'pi',
    operation: 'parseSession',
    count: 80,
    reverse: true,
    init: {
      model: null,
      provider: null,
      project: null,
      lastTool: null,
      lastToolInput: null,
      lastMessage: null,
    },
    onEntry: (detail, entry) => {
      // Extract cwd/project from session start
      if (!detail.project && entry.type === 'session' && entry.cwd) {
        detail.project = entry.cwd;
      }

      // Model change
      if (!detail.model && entry.type === 'model_change') {
        detail.model = entry.modelId || null;
        detail.provider = entry.provider || null;
      }

      // Message
      if (entry.type === 'message' && entry.message) {
        const msg = entry.message;

        // Model
        if (!detail.model && msg.model) {
          detail.model = msg.model;
        }
        if (!detail.provider && msg.provider) {
          detail.provider = msg.provider;
        }

        // Last text message
        if (!detail.lastMessage && msg.content) {
          const text = extractText(msg.content);
          const msgText: string | null = text ? text.substring(0, 80) : null;
          if (msgText !== null) {
            detail.lastMessage = msgText;
          }
        }

        // Tool usage (toolCall block in content)
        if (!detail.lastTool && msg.content) {
          for (const block of msg.content) {
            if (block.type === 'toolCall' || block.name) {
              detail.lastTool = block.name || 'toolCall';
              if (block.arguments) {
                detail.lastToolInput = summarizeToolInput(block.arguments, 60);
              }
              break;
            }
          }
        }
      }
    },
    // The early break this replaces sat INSIDE the message branch, so it fired
    // only after a message had been folded — not whenever the three fields
    // happened to be set. The fields can be completed by a non-message entry: a
    // trailing `type: 'session'` line supplies `project` after the last text
    // message and the last `model_change` have already been seen, and in that
    // case the original loop kept walking and could still pick up `lastTool`
    // from an earlier message. Gating on the entry keeps that reachable.
    until: (detail, entry) => {
      if (entry?.type !== 'message' || !entry?.message) return false;
      return !!(detail.lastMessage && detail.model && detail.project);
    },
  });
}

// ─── Tool history ───────────────────────────────────

type ToolEvent = { tool: string; detail: string; ts: number };

async function getToolHistory(filePath: string, maxItems = 15) {
  return collectJsonl<ToolEvent>(filePath, {
    scope: 'pi',
    operation: 'getToolHistory',
    count: 100,
    maxItems,
    onEntry: (entry, out) => {
      if (entry.type !== 'message' || !entry.message) return;
      const msg = entry.message;
      if (!msg.content) return;

      for (const block of msg.content) {
        if (block.type !== 'toolCall' && !block.name) continue;
        out.push({
          tool: block.name || 'toolCall',
          detail: block.arguments ? summarizeToolInput(block.arguments, 80) : '',
          ts: entry.timestamp ? new Date(entry.timestamp).getTime() : 0,
        });
      }
    },
  });
}

// ─── Recent messages ──────────────────────────────────────

type ChatMessage = { role: string; text: string; ts: number };

async function getRecentMessages(filePath: string, maxItems = 5) {
  return collectJsonl<ChatMessage>(filePath, {
    scope: 'pi',
    operation: 'getRecentMessages',
    count: 60,
    maxItems,
    onEntry: (entry, out) => {
      if (entry.type !== 'message' || !entry.message) return;
      const msg = entry.message;
      if (!msg.content) return;

      const text = extractText(msg.content);
      if (!text) return;

      out.push({
        role: msg.role || 'assistant',
        text: text.substring(0, 200),
        ts: entry.timestamp ? new Date(entry.timestamp).getTime() : 0,
      });
    },
  });
}

function encodeProjectKey(value: string) {
  return encodeURIComponent(value || '');
}

function decodeProjectKey(value: string) {
  return decodeURIComponent(value || '');
}

function buildSessionId(projectDir: string, fileName: string) {
  // projectDir is like --Users-openclaw-Github-claude-ville--
  // The encoding uses -- as boundary markers and - as path separators.
  // This is ambiguous for paths containing hyphens but is the established format.
  const sessionId = fileName.replace('.jsonl', '');
  return `pi:${encodeProjectKey(projectDir)}:${encodeProjectKey(sessionId)}`;
}

type TokenFold = { input: number; output: number; found: boolean };

async function getTokenUsage(filePath: string): Promise<{ input: number; output: number } | null> {
  const fold = await foldJsonl<TokenFold>(filePath, {
    scope: 'pi',
    operation: 'getTokenUsage',
    count: 2000,
    init: { input: 0, output: 0, found: false },
    onEntry: (acc, entry) => {
      // Deliberately NOT gated on `entry.type === 'message'`, and deliberately
      // NOT `Number(...)` coercion: this reads any entry carrying a
      // `message.usage`, and the typeof guards are what keep a string-valued
      // `input`/`output` out of the sum. Coercing would fold '7' into it.
      const usage = entry?.message?.usage;
      if (!usage) return;
      if (typeof usage.input === 'number') {
        acc.input += usage.input;
        acc.found = true;
      }
      if (typeof usage.output === 'number') {
        acc.output += usage.output;
        acc.found = true;
      }
    },
  });
  return fold.found ? { input: fold.input, output: fold.output } : null;
}

function parseSessionId(sessionId: string) {
  if (!sessionId.startsWith('pi:')) {
    return {
      projectDir: null,
      fileId: sessionId.replace('pi-', ''),
    };
  }

  const [, encodedProjectDir = '', encodedFileId = ''] = sessionId.split(':', 3);
  return {
    projectDir: decodeProjectKey(encodedProjectDir),
    fileId: decodeProjectKey(encodedFileId),
  };
}

export function projectDirToPath(projectDir: string) {
  if (!projectDir || projectDir.length < 3) return null;
  // Format: --Users-openclaw-Github-claude-ville--
  // Decoding: strip -- prefix/suffix, replace - with /
  const decoded = projectDir
    .replace(/^--/, '/')
    .replace(/--$/, '')
    .replace(/--/g, '/'); // Restore any legitimate double-hyphen in path
  const pathSegments = decoded.split('/').filter(s => s.length > 0);
  // Must look like an absolute path (starts with / or has drive letter pattern)
  if (pathSegments.length < 2) return null;
  return decoded;
}

export function resolveProjectPath(detail: { project: string | null }, projectDir: string) {
  return detail.project || projectDirToPath(projectDir);
}

// ─── Session scan ────────────────────────────────────────

interface ScanResult { filePath: string; mtime: number; fileName: string; projectDir: string }

/**
 * The scan, plus the two failures the shared helper used to collapse into `[]`.
 *
 * Pi has exactly one source — `~/.pi/agent/sessions` — so the classification is
 * the trivial case of the shared rule: a root that could not be listed is
 * `ok: false`, and one project directory that could not be enumerated is a
 * `warning`, because its siblings were listed and are still here.
 *
 * The two are told apart by `collectScanByMtime`'s `onUnreadable` scope, which is
 * why neither is silent any more. Both used to reach `debugAdapterError` only,
 * which is a no-op unless `DEBUG` is set.
 */
async function scanAllSessionFiles(activeThresholdMs: number): Promise<{ records: ScanResult[]; rootUnreadable: boolean; childrenUnreadable: number }> {
  let rootUnreadable = false;
  let childrenUnreadable = 0;
  const records = await collectScanByMtime<ScanResult>({
    dir: SESSIONS_DIR,
    scope: 'pi',
    operation: 'scanAllSessionFiles',
    thresholdMs: activeThresholdMs,
    // Synchronous by necessity: `fileFor` is called synchronously, so listing
    // the project directory has to be `readdirSync`. A throw here is what the
    // old `'scanAllSessionFiles readdir project'` catch used to absorb, and
    // `collectScanByMtime` confines it to this one project directory under its
    // `resolve` label.
    fileFor: (projectDir) => {
      const dirPath = path.join(SESSIONS_DIR, projectDir);
      return fs.readdirSync(dirPath, { withFileTypes: true })
        .filter((d: Dirent) => d.isFile() && d.name.endsWith('.jsonl'))
        .map((d: Dirent) => path.join(dirPath, d.name));
    },
    build: ({ name, filePath, mtimeMs }) => ({
      filePath,
      mtime: mtimeMs,
      fileName: path.basename(filePath),
      projectDir: name,
    }),
    onUnreadable: (scope, err, dir) => {
      debugAdapterError('pi', `scanAllSessionFiles ${scope}`, err, dir);
      if (scope === 'root') rootUnreadable = true;
      else childrenUnreadable += 1;
    },
  });
  return { records, rootUnreadable, childrenUnreadable };
}

// ─── Adapter class ─────────────────────────────────────

export class PiAdapter implements AgentAdapter {
  get name() { return 'Pi Coding Agent'; }
  get provider() { return 'pi'; }
  get homeDir() { return PI_DIR; }

  isAvailable() {
    return fs.existsSync(SESSIONS_DIR);
  }

  async getActiveSessions(activeThresholdMs: number): Promise<AdapterSessionsResult> {
    const { records, rootUnreadable, childrenUnreadable } = await scanAllSessionFiles(activeThresholdMs);
    const sessions = await Promise.all(records.map(async ({ filePath, mtime, fileName, projectDir }) => {
      const detail = await parseSession(filePath);
      const project = resolveProjectPath(detail, projectDir);

      return {
        sessionId: buildSessionId(projectDir, fileName),
        provider: 'pi',
        agentId: null,
        displayName: null,
        agentType: 'main',
        model: detail.model || 'unknown',
        status: 'active',
        lastActivity: mtime,
        project,
        lastMessage: detail.lastMessage,
        lastTool: detail.lastTool,
        lastToolInput: detail.lastToolInput,
        parentSessionId: null,
        filePath,
      };
    }));

    return combineSources([
      rootUnreadable
        ? { kind: 'failed', code: 'root-unreadable', detail: sourceDetail('sessions directory could not be listed', PI_DIR) }
        : fs.existsSync(SESSIONS_DIR)
          ? {
            kind: 'rows',
            sessions: sessions.sort((a, b) => b.lastActivity - a.lastActivity),
            warnings: degradedWarnings(childrenUnreadable, 'root-unreadable', 'project directory(ies)'),
          }
          : { kind: 'absent' },
    ]);
  }

  async getSessionDetail(sessionId: string, project: string | null, filePath: string | null = null): Promise<AdapterDetailResult> {
    if (filePath) {
      const [toolHistory, messages, tokenUsage] = await Promise.all([
        getToolHistory(filePath),
        getRecentMessages(filePath),
        getTokenUsage(filePath),
      ]);
      return detailOk({ toolHistory, messages, tokenUsage, sessionId });
    }

    const { records, rootUnreadable, childrenUnreadable } = await scanAllSessionFiles(30 * 60 * 1000);
    const parsed = parseSessionId(sessionId);

    if (rootUnreadable) {
      return detailFailed('root-unreadable', sourceDetail('sessions directory could not be listed', PI_DIR));
    }
    // `pi`'s `fileFor` enumerates the project directory, so a project directory
    // the scan could not list leaves the search incomplete. Its siblings were
    // searched, so this is a warning rather than a failure.
    const incomplete = degradedWarnings(childrenUnreadable, 'root-unreadable', 'project directory(ies)');

    for (const { filePath, fileName, projectDir } of records) {
      const fileId = fileName.replace('.jsonl', '');
      if (
        fileId === parsed.fileId
        && (!parsed.projectDir || parsed.projectDir === projectDir)
      ) {
        const [toolHistory, messages, tokenUsage] = await Promise.all([
          getToolHistory(filePath),
          getRecentMessages(filePath),
          getTokenUsage(filePath),
        ]);
        return detailOk({ toolHistory, messages, tokenUsage, sessionId }, incomplete);
      }
    }

    return detailOk(emptyDetail(), incomplete);
  }

  getWatchPaths(): WatchPath[] {
    const paths: WatchPath[] = [];
    if (!fs.existsSync(SESSIONS_DIR)) return paths;

    try {
      paths.push({ type: 'directory', path: SESSIONS_DIR, recursive: true, filter: '.jsonl' });
    } catch (err) {
      debugAdapterError('pi', 'getWatchPaths', err, SESSIONS_DIR);
    }

    return paths;
  }
}
