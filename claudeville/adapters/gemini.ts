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

import type { AdapterDetailResult, AdapterSessionsResult, AgentAdapter, WatchPath } from '../../shared/types.js';
import { parseSession, getToolHistory, getRecentMessages, getTokenUsage } from './gemini-readers.js';
import { collectScanByMtime } from './scan-utils.js';
import { combineSources, degradedWarnings, detailFailed, detailOk, emptyDetail, sourceDetail } from './sources.js';
import { debugAdapterError } from './jsonl-utils.js';

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
 * guard, the `session-` name filter, and readdir order.
 *
 * NOT preserved — a DELIBERATE change (#144). This listing used to be a bare
 * `readdirSync`, so a DIRECTORY named `session-x.json` passed the name filter,
 * `stat`ed through and was emitted as a session row with all-null detail. It is
 * now read with `withFileTypes` and gated on `isFile()`, like `hermes` and
 * `opencode` always were.
 */
/**
 * The scan, plus the two failures the shared helper used to collapse into `[]`.
 *
 * Gemini has one source — `~/.gemini/tmp` — so the classification is the trivial
 * case of the shared rule: an unreadable `tmp/` is `ok: false`, and an unreadable
 * one project's `chats/` is a `warning`, because every other project was listed
 * and is still here. `collectScanByMtime`'s `onUnreadable` scope is what tells
 * the two apart; both reached `debugAdapterError` only, which is a no-op unless
 * `DEBUG` is set.
 */
async function scanActiveSessions(activeThresholdMs: number): Promise<{ records: ScanResult[]; rootUnreadable: boolean; childrenUnreadable: number }> {
  let rootUnreadable = false;
  let childrenUnreadable = 0;
  const records = await collectScanByMtime<ScanResult>({
    dir: TMP_DIR,
    scope: 'gemini-adapter',
    operation: 'scanActiveSessions',
    thresholdMs: activeThresholdMs,
    fileFor: (projectDirName) => {
      const chatsDir = path.join(TMP_DIR, projectDirName, 'chats');
      if (!fs.existsSync(chatsDir)) return null;
      // CALLED SYNCHRONOUSLY, so this is a readdirSync. Same list, same order.
      return fs
        .readdirSync(chatsDir, { withFileTypes: true })
        .filter((d: Dirent) => d.isFile() && d.name.startsWith('session-') && (d.name.endsWith('.json') || d.name.endsWith('.jsonl')))
        .map((d: Dirent) => path.join(chatsDir, d.name));
    },
    build: ({ name, filePath, mtimeMs }) => ({
      filePath,
      mtime: mtimeMs,
      fileName: path.basename(filePath),
      projectHash: name,
    }),
    onUnreadable: (scope, err, dir) => {
      debugAdapterError('gemini', `scanActiveSessions ${scope}`, err, dir);
      if (scope === 'root') rootUnreadable = true;
      // `'stat'` is excluded on purpose. Gemini's `fileFor` enumerates `chats/`
      // first, so every path it returns was in a listing moments ago and a stat
      // failure means the file was removed in between — not a whole project
      // directory lost. Folding it into `childrenUnreadable` would report "1
      // project directory(ies)" for what is one vanished file.
      else if (scope === 'child') childrenUnreadable += 1;
    },
  });
  return { records, rootUnreadable, childrenUnreadable };
}

// ─── Adapter class ────────────────────────────────────

export class GeminiAdapter implements AgentAdapter {
  get name() { return 'Gemini CLI'; }
  get provider() { return 'gemini'; }
  get homeDir() { return GEMINI_DIR; }

  isAvailable() {
    return fs.existsSync(GEMINI_DIR);
  }

  async getActiveSessions(activeThresholdMs: number): Promise<AdapterSessionsResult> {
    const { records, rootUnreadable, childrenUnreadable } = await scanActiveSessions(activeThresholdMs);
    const sessions = await Promise.all(records.map(async ({ filePath, mtime, fileName, projectHash }) => {
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

    return combineSources([
      rootUnreadable
        ? { kind: 'failed', code: 'root-unreadable', detail: sourceDetail('tmp directory could not be listed', GEMINI_DIR) }
        : fs.existsSync(TMP_DIR)
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

    const cleanId = sessionId.replace('gemini-', '');
    const { records, rootUnreadable, childrenUnreadable } = await scanActiveSessions(30 * 60 * 1000);

    if (rootUnreadable) {
      return detailFailed('root-unreadable', sourceDetail('tmp directory could not be listed', GEMINI_DIR));
    }
    // A project directory the scan could not enumerate leaves the search
    // incomplete; its siblings were searched, so this is a warning.
    const incomplete = degradedWarnings(childrenUnreadable, 'root-unreadable', 'project directory(ies)');

    for (const { filePath, fileName } of records) {
      const fileId = fileName.replace('session-', '').replace('.json', '');
      if (fileId === cleanId) {
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
