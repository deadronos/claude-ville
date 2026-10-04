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
import { parseSession, getToolHistory, getRecentMessages, getTokenUsage } from './gemini-readers.js';
import { collectScanByMtime } from './scan-utils.js';

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
