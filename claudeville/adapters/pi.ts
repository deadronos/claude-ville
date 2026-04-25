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

import type { AgentAdapter, WatchPath } from '../../shared/types.js';
import { debugAdapterError, readLines, parseJsonLines } from './jsonl-utils.js';

const PI_DIR = path.join(os.homedir(), '.pi');
const SESSIONS_DIR = path.join(PI_DIR, 'agent', 'sessions');

type Dirent = { name: string; isDirectory(): boolean; isFile(): boolean };

// ─── Utility ─────────────────────────────────────────────

// ─── Session parsing ──────────────────────────────────────

export async function parseSession(filePath: string) {
  const detail: {
    model: string | null;
    provider: string | null;
    project: string | null;
    lastTool: string | null;
    lastToolInput: string | null;
    lastMessage: string | null;
  } = {
    model: null,
    provider: null,
    project: null,
    lastTool: null,
    lastToolInput: null,
    lastMessage: null,
  };

  const lines = await readLines(filePath, { from: 'end', count: 80, scope: 'pi' });
  const entries = parseJsonLines(lines, 'pi');

  // Iterate in reverse from the end
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];

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
              detail.lastToolInput = (typeof block.arguments === 'string'
                ? block.arguments : JSON.stringify(block.arguments)
              ).substring(0, 60);
            }
            break;
          }
        }
      }

      if (detail.lastMessage && detail.model && detail.project) break;
    }
  }

  return detail;
}

function extractText(content: unknown) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  for (const block of content) {
    if ((block as { type?: string; text?: string }).type === 'text' && (block as { type?: string; text?: string }).text) return (block as { type?: string; text?: string }).text!.trim();
    if ((block as { type?: string; text?: string }).type === 'output_text' && (block as { type?: string; text?: string }).text) return (block as { type?: string; text?: string }).text!.trim();
  }
  return '';
}

// ─── Tool history ───────────────────────────────────

async function getToolHistory(filePath: string, maxItems = 15) {
  const tools = [];
  try {
    const lines = await readLines(filePath, { from: 'end', count: 100, scope: 'pi' });
    const entries = parseJsonLines(lines, 'pi');

    for (const entry of entries) {
      if (entry.type !== 'message' || !entry.message) continue;
      const msg = entry.message;
      if (!msg.content) continue;

      for (const block of msg.content) {
        if (block.type !== 'toolCall' && !block.name) continue;
        let detail = '';
        if (block.arguments) {
          detail = (typeof block.arguments === 'string'
            ? block.arguments : JSON.stringify(block.arguments)
          ).substring(0, 80);
        }
        tools.push({
          tool: block.name || 'toolCall',
          detail,
          ts: entry.timestamp ? new Date(entry.timestamp).getTime() : 0,
        });
      }
    }
  } catch (err) {
    debugAdapterError('pi', 'getToolHistory', err, filePath);
  }
  return tools.slice(-maxItems);
}

// ─── Recent messages ──────────────────────────────────────

async function getRecentMessages(filePath: string, maxItems = 5) {
  const messages = [];
  try {
    const lines = await readLines(filePath, { from: 'end', count: 60, scope: 'pi' });
    const entries = parseJsonLines(lines, 'pi');

    for (const entry of entries) {
      if (entry.type !== 'message' || !entry.message) continue;
      const msg = entry.message;
      if (!msg.content) continue;

      const text = extractText(msg.content);
      if (!text) continue;

      messages.push({
        role: msg.role || 'assistant',
        text: text.substring(0, 200),
        ts: entry.timestamp ? new Date(entry.timestamp).getTime() : 0,
      });
    }
  } catch (err) {
    debugAdapterError('pi', 'getRecentMessages', err, filePath);
  }
  return messages.slice(-maxItems);
}

function encodeProjectKey(value: string) {
  return encodeURIComponent(value || '');
}

function decodeProjectKey(value: string) {
  return decodeURIComponent(value || '');
}

function buildSessionId(projectDir: string, fileName: string) {
  // projectDir is like --Users-openclaw-Github-claude-ville--
  // fileName is like 2026-04-24T22-19-42-919Z_019dc193-cfc7-71ff-bfd9-d2fc9f1735e6.jsonl
  const sessionId = fileName.replace('.jsonl', '');
  return `pi:${encodeProjectKey(projectDir)}:${encodeProjectKey(sessionId)}`;
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
  // Convert --Users-openclaw-Github-claude-ville-- back to /Users/openclaw/Github/claude-ville
  return projectDir
    .replace(/^--/, '/')
    .replace(/--$/, '')
    .replace(/-/g, '/');
}

export function resolveProjectPath(detail: { project: string | null }, projectDir: string) {
  return detail.project || projectDirToPath(projectDir);
}

// ─── Session scan ────────────────────────────────────────

interface ScanResult { filePath: string; mtime: number; fileName: string; projectDir: string }

async function scanAllSessionFiles(activeThresholdMs: number): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  if (!fs.existsSync(SESSIONS_DIR)) return results;

  const now = Date.now();

  try {
    const projectDirs = (await fs.promises.readdir(SESSIONS_DIR, { withFileTypes: true }))
      .filter((d: Dirent) => d.isDirectory());

    const dirResults = await Promise.all(
      projectDirs.map(async (projectDir: Dirent) => {
        const projectPath = path.join(SESSIONS_DIR, projectDir.name);
        try {
          const sessionFiles = await fs.promises.readdir(projectPath);
          const jsonlFiles = sessionFiles.filter((f: string) => f.endsWith('.jsonl'));

          const fileResults = await Promise.all(
            jsonlFiles.map(async (file: string) => {
              const filePath = path.join(projectPath, file);
              try {
                const stat = await fs.promises.stat(filePath);
                if (now - stat.mtimeMs > activeThresholdMs) return null;
                return {
                  filePath,
                  mtime: stat.mtimeMs,
                  fileName: file,
                  projectDir: projectDir.name,
                } as ScanResult;
              } catch (err) {
                debugAdapterError('pi', 'scanAllSessionFiles stat', err, filePath);
                return null;
              }
            })
          );
          return fileResults.filter((r: ScanResult | null): r is ScanResult => r !== null);
        } catch (err) {
          debugAdapterError('pi', 'scanAllSessionFiles readdir project', err, projectPath);
          return [];
        }
      })
    );

    for (const group of dirResults) {
      results.push(...group);
    }
  } catch (err) {
    debugAdapterError('pi', 'scanAllSessionFiles', err, SESSIONS_DIR);
  }

  return results;
}

// ─── Adapter class ─────────────────────────────────────

export class PiAdapter implements AgentAdapter {
  get name() { return 'Pi Coding Agent'; }
  get provider() { return 'pi'; }
  get homeDir() { return PI_DIR; }

  isAvailable() {
    return fs.existsSync(SESSIONS_DIR);
  }

  async getActiveSessions(activeThresholdMs: number) {
    const sessionFiles = await scanAllSessionFiles(activeThresholdMs);
    const sessions = await Promise.all(sessionFiles.map(async ({ filePath, mtime, fileName, projectDir }) => {
      const detail = await parseSession(filePath);
      const projectPath = resolveProjectPath(detail, projectDir);

      return {
        sessionId: buildSessionId(projectDir, fileName),
        provider: 'pi',
        agentId: null,
        displayName: null,
        agentType: 'main',
        model: detail.model || 'unknown',
        status: 'active',
        lastActivity: mtime,
        project: projectPath,
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

    const sessionFiles = await scanAllSessionFiles(30 * 60 * 1000);
    const parsed = parseSessionId(sessionId);

    for (const { filePath, fileName, projectDir } of sessionFiles) {
      const fileId = fileName.replace('.jsonl', '');
      if (
        fileId === parsed.fileId
        && (!parsed.projectDir || parsed.projectDir === projectDir)
      ) {
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
    if (!fs.existsSync(SESSIONS_DIR)) return paths;

    try {
      paths.push({ type: 'directory', path: SESSIONS_DIR, recursive: true, filter: '.jsonl' });
    } catch (err) {
      debugAdapterError('pi', 'getWatchPaths', err, SESSIONS_DIR);
    }

    return paths;
  }
}
