/**
 * Google Gemini CLI adapter
 * Data source: ~/.gemini/
 *
 * Session format (JSON object):
 *   {
 *     "sessionId": "...",
 *     "projectHash": "...",      // SHA-256 hash of cwd
 *     "messages": [
 *       {"type": "user", "content": "Hello"},
 *       {"type": "gemini", "content": "Hi!", "model": "gemini-2.5-flash", "tokens": {...}},
 *       {"type": "info", "content": "..."}
 *     ]
 *   }
 *
 * Project path restoration: projectHash is SHA-256 of cwd, so
 * map by computing hashes of known project paths
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import type { Dirent } from 'fs';

import type { AgentAdapter, WatchPath } from '../../shared/types.js';
import { readLines, parseJsonLines, foldEntries } from './jsonl-utils.js';
import { collectScanByMtime } from './scan-utils.js';
import { extractText } from './text-utils.js';

const GEMINI_DIR = path.join(os.homedir(), '.gemini');
const TMP_DIR = path.join(GEMINI_DIR, 'tmp');

// ─── Project path restoration ──────────────────────────────

/**
 * Reverse-map project path from SHA-256 hash or handle named directories
 */
const MAX_HASH_CACHE_SIZE = 1000;
const _hashToPathCache = new Map<string, string | null>();

function evictIfNeeded() {
  if (_hashToPathCache.size >= MAX_HASH_CACHE_SIZE) {
    // Delete the oldest ~20% of entries (Map preserves insertion order)
    const toDelete = Math.floor(_hashToPathCache.size * 0.2);
    const keys = _hashToPathCache.keys();
    for (let i = 0; i < toDelete; i++) {
      const next = keys.next();
      if (next.value) _hashToPathCache.delete(next.value);
    }
  }
}

function sha256(str: string) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function resolveProjectPath(projectHash: string) {
  // Check cache
  const cached = _hashToPathCache.get(projectHash);
  if (cached !== undefined) {
    return cached;
  }

  evictIfNeeded();

  const homeDir = os.homedir();
  const cwd = process.cwd();

  // Candidate 0: Current working directory (match basename or hash)
  if (sha256(cwd) === projectHash || path.basename(cwd) === projectHash) {
    _hashToPathCache.set(projectHash, cwd);
    return cwd;
  }

  // Candidate 1: Home directory itself
  if (sha256(homeDir) === projectHash) {
    _hashToPathCache.set(projectHash, homeDir);
    return homeDir;
  }

  // Candidate 2: One level under home (Desktop, Documents, Projects, etc.)
  const commonDirs = ['Desktop', 'Documents', 'Projects', 'Developer', 'dev', 'src', 'code', 'repos', 'workspace', 'work', 'Github'];
  for (const dir of commonDirs) {
    const fullPath = path.join(homeDir, dir);
    if (sha256(fullPath) === projectHash || (projectHash.length < 64 && path.basename(fullPath) === projectHash)) {
      _hashToPathCache.set(projectHash, fullPath);
      return fullPath;
    }
    // Also check 2 levels
    try {
      if (fs.existsSync(fullPath)) {
        const subdirs = fs.readdirSync(fullPath, { withFileTypes: true })
          .filter((d: Dirent) => d.isDirectory() && !d.name.startsWith('.'))
          .slice(0, 100); // Limit if too many
        for (const sub of subdirs) {
          const subPath = path.join(fullPath, sub.name);
          if (sha256(subPath) === projectHash || (projectHash.length < 64 && sub.name === projectHash)) {
            _hashToPathCache.set(projectHash, subPath);
            return subPath;
          }
        }
      }
    } catch { /* ignore */ }
  }

  // Candidate 3: Also check Claude Code project paths
  const claudeProjectsDir = path.join(homeDir, '.claude', 'projects');
  try {
    if (fs.existsSync(claudeProjectsDir)) {
      const projDirs = fs.readdirSync(claudeProjectsDir);
      for (const dir of projDirs) {
        // Claude projects dir name format: -Users-name-path
        const projPath = '/' + dir.replace(/-/g, '/').replace(/^\//, '');
        if (sha256(projPath) === projectHash || (projectHash.length < 64 && path.basename(projPath) === projectHash)) {
          _hashToPathCache.set(projectHash, projPath);
          return projPath;
        }
      }
    }
  } catch { /* ignore */ }

  // Mapping failed → return null (don't show hash directory name)
  _hashToPathCache.set(projectHash, null);
  return null;
}

// ─── Session parsing ────────────────────────────────────────

async function readJsonFile(filePath: string) {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Load a session's records from EITHER of the two shapes gemini writes.
 *
 * A `.jsonl` session is a stream of records, one per line, so only the last
 * `count` of them are read. A `.json` session is ONE document whose `messages`
 * array holds the same records; it is parsed whole, so `count` does not apply to
 * it and that reader sees every record the session has. This asymmetry is real and
 * observable — a `.jsonl` session whose last 20 lines are all tool calls reports
 * no conversation at all, while the `.json` twin of it reports five messages.
 *
 * This is the ONE place that knows about the split, and it is why the fold that
 * consumes these records is `foldEntries` over the returned array and NOT
 * `foldJsonl`: `foldJsonl` reads lines, so in a `.json` document every chunk
 * fails `JSON.parse` and the fold sees nothing. `collectJsonl` is unusable here
 * for the same reason.
 *
 * `count` stays per call site because the four readers genuinely disagree —
 * 50 / 100 / 20 / 2000 — and each of those numbers is pinned by
 * gemini.fixture.test.ts. Do not hoist it to a default.
 */
async function loadSessionMessages(filePath: string, count: number): Promise<any[]> {
  if (filePath.endsWith('.jsonl')) {
    const lines = await readLines(filePath, { count, scope: 'gemini-adapter' });
    return parseJsonLines(lines, 'gemini-adapter');
  }
  const session = await readJsonFile(filePath);
  return session && Array.isArray(session.messages) ? session.messages : [];
}

/**
 * Extract model/tools/messages from Gemini session JSON
 * Actual format: {sessionId, projectHash, messages: [{type, content, model, ...}]}
 */
async function parseSession(filePath: string) {
  const detail: {
    model: string | null;
    lastTool: string | null;
    lastToolInput: string | null;
    lastMessage: string | null;
  } = {
    model: null,
    lastTool: null,
    lastToolInput: null,
    lastMessage: null,
  };

  try {
    const messages = await loadSessionMessages(filePath, 50);

    if (messages.length === 0) return detail;

    // Iterate in reverse from the end
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];

      // Gemini response message
      if (msg.type === 'gemini') {
        // Model info
        if (!detail.model && msg.model) {
          detail.model = msg.model;
        }

        // Text message
        if (!detail.lastMessage && msg.content) {
          const text = extractText(msg.content);
          if (text.length > 0) {
            detail.lastMessage = text.substring(0, 80);
          }
        }

        // Tool usage (when toolCalls exists)
        if (!detail.lastTool && msg.toolCalls && Array.isArray(msg.toolCalls)) {
          for (const tc of msg.toolCalls) {
            detail.lastTool = tc.name || 'function_call';
            if (tc.args) {
              const args = tc.args;
              if (args.command) detail.lastToolInput = args.command.substring(0, 60);
              else if (args.file_path) detail.lastToolInput = args.file_path.split('/').pop();
              else detail.lastToolInput = JSON.stringify(args).substring(0, 60);
            }
            break;
          }
        }
      }

      // Tool call result (tool_call type)
      if (!detail.lastTool && msg.type === 'tool_call') {
        detail.lastTool = msg.name || msg.toolName || 'tool';
        if (msg.input) {
          detail.lastToolInput = (typeof msg.input === 'string'
            ? msg.input : JSON.stringify(msg.input)
          ).substring(0, 60);
        }
      }

      if (detail.lastMessage && detail.model) break;
    }
  } catch { /* ignore */ }

  return detail;
}

/**
 * Extract tool history from Gemini session
 */
async function getToolHistory(filePath: string, maxItems = 15) {
  type ToolEntry = { tool: string; detail: string; ts: number };
  const tools: ToolEntry[] = [];
  try {
    const messages = await loadSessionMessages(filePath, 100);

    for (const msg of messages) {
      // Check toolCalls in gemini type
      if (msg.type === 'gemini' && msg.toolCalls && Array.isArray(msg.toolCalls)) {
        for (const tc of msg.toolCalls) {
          let detail = '';
          if (tc.args) {
            if (tc.args.command) detail = tc.args.command.substring(0, 80);
            else if (tc.args.file_path) detail = tc.args.file_path;
            else detail = JSON.stringify(tc.args).substring(0, 80);
          }
          tools.push({
            tool: tc.name || 'function_call',
            detail,
            ts: msg.timestamp ? new Date(msg.timestamp).getTime() : 0,
          });
        }
      }

      // tool_call type
      if (msg.type === 'tool_call') {
        let detail = '';
        if (msg.input) {
          detail = (typeof msg.input === 'string'
            ? msg.input : JSON.stringify(msg.input)
          ).substring(0, 80);
        }
        tools.push({
          tool: msg.name || msg.toolName || 'tool',
          detail,
          ts: msg.timestamp ? new Date(msg.timestamp).getTime() : 0,
        });
      }
    }
  } catch { /* ignore */ }
  return tools.slice(-maxItems);
}

/**
 * Extract recent messages from Gemini session
 */
async function getRecentMessages(filePath: string, maxItems = 5) {
  type MsgEntry = { role: string; text: string; ts: number };
  const msgList: MsgEntry[] = [];
  try {
    const messages = await loadSessionMessages(filePath, 20);

    for (const msg of messages) {
      if (msg.type === 'info') continue; // Skip info messages

      const text = typeof msg.content === 'string' ? msg.content.trim() : '';
      if (text.length === 0) continue;

      msgList.push({
        role: msg.type === 'gemini' ? 'assistant' : msg.type === 'user' ? 'user' : 'system',
        text: text.substring(0, 200),
        ts: msg.timestamp ? new Date(msg.timestamp).getTime() : 0,
      });
    }
  } catch { /* ignore */ }
  return msgList.slice(-maxItems);
}

type ScanResult = { filePath: string; mtime: number; fileName: string; projectHash: string };

/**
 * Scan active session files
 * ~/.gemini/tmp/<project_hash>/chats/session-*.json
 *
 * This fits `collectScanByMtime` without flattening anything: the project
 * directory is the child, and `fileFor` is the `chats` subdirectory beneath it —
 * the "one child, many files" case the helper was widened for. What is preserved
 * exactly: the single `now` taken before the readdir, the mtime comparison and
 * its sign, the `isDirectory` filter on the root, the per-child `existsSync`
 * guard, the `session-` name filter, readdir order, and the fact that a
 * DIRECTORY named `session-x.json` still stats through as a session (the readdir
 * here has no `withFileTypes`, exactly as before — see the report).
 */
async function scanActiveSessions(activeThresholdMs: number) {
  return collectScanByMtime<ScanResult>({
    dir: TMP_DIR,
    scope: 'gemini-adapter',
    operation: 'scanActiveSessions',
    thresholdMs: activeThresholdMs,
    fileFor: (projectDirName) => {
      const chatsDir = path.join(TMP_DIR, projectDirName, 'chats');
      if (!fs.existsSync(chatsDir)) return null;
      // CALLED SYNCHRONOUSLY, so this is a readdirSync. Same list, same order.
      return fs
        .readdirSync(chatsDir)
        .filter((f: string) => f.startsWith('session-') && (f.endsWith('.json') || f.endsWith('.jsonl')))
        .map((f: string) => path.join(chatsDir, f));
    },
    build: ({ name, filePath, mtimeMs }) => ({
      filePath,
      mtime: mtimeMs,
      fileName: path.basename(filePath),
      projectHash: name,
    }),
  });
}

// ─── Adapter class ────────────────────────────────────

/** The accumulator `getTokenUsage` folds over. `found` is what makes the
 *  no-reading answer `null` rather than `{ input: 0, output: 0 }`. */
type TokenFold = { input: number; output: number; found: boolean };

/**
 * Sum per-response `tokens` records into session totals.
 *
 * `foldEntries` over the ALREADY-LOADED records, not `foldJsonl` over the file:
 * a `.json` session is one parsed document, and `foldJsonl` would find no lines
 * in it. `onEntry` is `=> void` and the return value is discarded, so `acc` is
 * mutated in place — `(acc, e) => ({ ...acc, input: e.x })` would typecheck and
 * sum nothing at all.
 *
 * The two `typeof` guards are independent, as they have always been: a record
 * whose `input` is a string still contributes its numeric `output`. gemini
 * guards where codex coerces, and that difference is deliberate.
 */
async function getTokenUsage(filePath: string) {
  try {
    const fold = foldEntries<TokenFold>(await loadSessionMessages(filePath, 2000), {
      init: { input: 0, output: 0, found: false },
      onEntry: (acc, msg) => {
        const tokens = msg?.tokens;
        if (!tokens) return;
        if (typeof tokens.input === 'number') {
          acc.input += tokens.input;
          acc.found = true;
        }
        if (typeof tokens.output === 'number') {
          acc.output += tokens.output;
          acc.found = true;
        }
      },
    });
    return fold.found ? { input: fold.input, output: fold.output } : null;
  } catch {
    return null;
  }
}

export class GeminiAdapter implements AgentAdapter {
  get name() { return 'Gemini CLI'; }
  get provider() { return 'gemini'; }
  get homeDir() { return GEMINI_DIR; }

  isAvailable() {
    return fs.existsSync(GEMINI_DIR);
  }

  async getActiveSessions(activeThresholdMs: number) {
    const sessionFiles = await scanActiveSessions(activeThresholdMs);
    const sessions = await Promise.all(sessionFiles.map(async ({ filePath, mtime, fileName, projectHash }) => {
      const detail = await parseSession(filePath);
      const sessionId = fileName.replace('session-', '').replace('.json', '');
      const project = resolveProjectPath(projectHash);

      return {
        sessionId: `gemini-${sessionId}`,
        provider: 'gemini',
        agentId: null,
        agentType: 'main',
        model: detail.model || 'gemini',
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

    const cleanId = sessionId.replace('gemini-', '');
    const sessionFiles = await scanActiveSessions(30 * 60 * 1000);

    for (const { filePath, fileName } of sessionFiles) {
      const fileId = fileName.replace('session-', '').replace('.json', '');
      if (fileId === cleanId) {
        const [toolHistory, messages, tokenUsage] = await Promise.all([
          getToolHistory(filePath),
          getRecentMessages(filePath),
          getTokenUsage(filePath),
        ]);
        return { toolHistory, messages, tokenUsage, sessionId };
      }
    }

    return { toolHistory: [], messages: [] };
  }

  getWatchPaths(): WatchPath[] {
    const paths: WatchPath[] = [];
    if (fs.existsSync(TMP_DIR)) {
      try {
        const projDirs = fs.readdirSync(TMP_DIR, { withFileTypes: true })
          .filter((d: Dirent) => d.isDirectory());
        for (const dir of projDirs) {
          const chatsDir = path.join(TMP_DIR, dir.name, 'chats');
          if (fs.existsSync(chatsDir)) {
            paths.push({ type: 'directory', path: chatsDir, filter: '.json' });
            paths.push({ type: 'directory', path: chatsDir, filter: '.jsonl' });
          }
        }
      } catch { /* ignore */ }
    }
    return paths;
  }
}
