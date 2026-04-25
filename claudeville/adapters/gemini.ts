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

import type { AgentAdapter, WatchPath } from '../../shared/types.js';

const GEMINI_DIR = path.join(os.homedir(), '.gemini');
const TMP_DIR = path.join(GEMINI_DIR, 'tmp');

// Type for directory entries from readdirSync with withFileTypes: true
type Dirent = { name: string; isDirectory(): boolean; isFile(): boolean };

// ─── Project path restoration ──────────────────────────────

/**
 * Reverse-map project path from SHA-256 hash
 * Compute hashes of candidate paths to match
 */
const _hashToPathCache = new Map();

function sha256(str: string) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function resolveProjectPath(projectHash: string) {
  // Check cache
  if (_hashToPathCache.has(projectHash)) {
    return _hashToPathCache.get(projectHash);
  }

  const homeDir = os.homedir();

  // Candidate 1: Home directory itself
  if (sha256(homeDir) === projectHash) {
    _hashToPathCache.set(projectHash, homeDir);
    return homeDir;
  }

  // Candidate 2: One level under home (Desktop, Documents, Projects, etc.)
  const commonDirs = ['Desktop', 'Documents', 'Projects', 'Developer', 'dev', 'src', 'code', 'repos', 'workspace', 'work'];
  for (const dir of commonDirs) {
    const fullPath = path.join(homeDir, dir);
    if (sha256(fullPath) === projectHash) {
      _hashToPathCache.set(projectHash, fullPath);
      return fullPath;
    }
    // Also check 2 levels
    try {
      if (fs.existsSync(fullPath)) {
        const subdirs = fs.readdirSync(fullPath, { withFileTypes: true })
          .filter((d: Dirent) => d.isDirectory() && !d.name.startsWith('.'))
          .slice(0, 50); // Limit if too many
        for (const sub of subdirs) {
          const subPath = path.join(fullPath, sub.name);
          if (sha256(subPath) === projectHash) {
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
        if (sha256(projPath) === projectHash) {
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
    const session = await readJsonFile(filePath);
    if (!session) return detail;

    const messages = session.messages;
    if (!Array.isArray(messages)) return detail;

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
          const text = typeof msg.content === 'string' ? msg.content.trim() : '';
          if (text.length > 0) {
            detail.lastMessage = text.substring(0, 80);
          }
        }

        // Tool usage (when functionCall exists)
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
    const session = await readJsonFile(filePath);
    if (!session) return tools;
    const messages = session.messages;
    if (!Array.isArray(messages)) return tools;

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
    const session = await readJsonFile(filePath);
    if (!session) return msgList;
    const messages = session.messages;
    if (!Array.isArray(messages)) return msgList;

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

/**
 * Scan active session files
 * ~/.gemini/tmp/<project_hash>/chats/session-*.json
 */
async function scanActiveSessions(activeThresholdMs: number) {
  type ScanResult = { filePath: string; mtime: number; fileName: string; projectHash: string };
  const results: ScanResult[] = [];
  if (!fs.existsSync(TMP_DIR)) return results;

  const now = Date.now();

  try {
    const projectDirs = (await fs.promises.readdir(TMP_DIR, { withFileTypes: true }))
      .filter((d: Dirent) => d.isDirectory());
    const projectResults = await Promise.all(projectDirs.map(async (projDir: Dirent) => {
      const chatsDir = path.join(TMP_DIR, projDir.name, 'chats');
      if (!fs.existsSync(chatsDir)) return [];

      try {
        const sessionFiles = await fs.promises.readdir(chatsDir);
        const jsonFiles = sessionFiles.filter((f: string) => f.startsWith('session-') && f.endsWith('.json'));
        const fileResults = await Promise.all(jsonFiles.map(async (file: string): Promise<ScanResult | null> => {
          const filePath = path.join(chatsDir, file);
          try {
            const stat = await fs.promises.stat(filePath);
            if (now - stat.mtimeMs > activeThresholdMs) return null;
            return {
              filePath,
              mtime: stat.mtimeMs,
              fileName: file,
              projectHash: projDir.name,
            };
          } catch {
            return null;
          }
        }));
        return fileResults.filter((result): result is ScanResult => result !== null);
      } catch {
        return [];
      }
    }));

    for (const group of projectResults) {
      results.push(...(group as ScanResult[]));
    }
  } catch { /* ignore */ }

  return results;
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
      return {
        toolHistory: await getToolHistory(filePath),
        messages: await getRecentMessages(filePath),
        sessionId,
      };
    }

    const cleanId = sessionId.replace('gemini-', '');
    const sessionFiles = await scanActiveSessions(30 * 60 * 1000);

    for (const { filePath, fileName } of sessionFiles) {
      const fileId = fileName.replace('session-', '').replace('.json', '');
      if (fileId === cleanId) {
        return {
          toolHistory: await getToolHistory(filePath),
          messages: await getRecentMessages(filePath),
          sessionId,
        };
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
          }
        }
      } catch { /* ignore */ }
    }
    return paths;
  }
}
