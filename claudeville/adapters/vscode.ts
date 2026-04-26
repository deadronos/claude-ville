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
import { debugAdapterError, readLines, parseJsonLines } from './jsonl-utils.js';

const VSCODE_USER_DIR = process.env.VSCODE_USER_DATA_DIR
  || path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User');
const VSCODE_INSIDERS_USER_DIR = process.env.VSCODE_INSIDERS_USER_DATA_DIR
  || path.join(os.homedir(), 'Library', 'Application Support', 'Code - Insiders', 'User');

const STORAGE_ROOTS = [
  { channel: 'vscode', workspaceStorageDir: path.join(VSCODE_USER_DIR, 'workspaceStorage') },
  { channel: 'vscode-insiders', workspaceStorageDir: path.join(VSCODE_INSIDERS_USER_DIR, 'workspaceStorage') },
];

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
    // JSON parse failed; use raw text as-is
    return responseRaw.substring(0, 200).trim();
  }

  return '';
}

async function parseSession(filePath: string) {
  const detail: {
    model: string | null;
    lastTool: string | null;
    lastToolInput: string | null;
    lastMessage: string | null;
    tokens: { input: number; output: number } | null;
  } = {
    model: null,
    lastTool: null,
    lastToolInput: null,
    lastMessage: null,
    tokens: null,
  };

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

  const lines = await readLines(filePath, { from: 'end', count: 300, scope: 'vscode' });
  const entries = parseJsonLines(lines, 'vscode');

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];

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

    if (detail.model && detail.lastMessage && detail.lastTool) break;
  }

  return detail;
}

async function getToolHistory(filePath: string, maxItems = 15) {
  const tools = [];

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

  try {
    const lines = await readLines(filePath, { from: 'end', count: 300, scope: 'vscode' });
    const entries = parseJsonLines(lines, 'vscode');

    for (const entry of entries) {
      if (entry.type !== 'tool_call') continue;
      tools.push({
        tool: entry.name || 'tool_call',
        detail: summarizeJson(entry.attrs && entry.attrs.args, 120),
        ts: typeof entry.ts === 'number' ? entry.ts : 0,
      });
    }

    for (const entry of entries) {
      if (entry.type === 'tool.execution_start' && entry.data) {
        tools.push({
          tool: entry.data.toolName || 'tool.execution_start',
          detail: summarizeJson(entry.data.arguments, 120),
          ts: typeof entry.timestamp === 'number' ? entry.timestamp : 0,
        });
      }
    }
  } catch (err) {
    debugAdapterError('vscode', 'getToolHistory', err, filePath);
  }

  return tools.slice(-maxItems);
}

async function getRecentMessages(filePath: string, maxItems = 5) {
  const messages = [];

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

  try {
    const lines = await readLines(filePath, { from: 'end', count: 300, scope: 'vscode' });
    const entries = parseJsonLines(lines, 'vscode');

    for (const entry of entries) {
      if (entry.type !== 'agent_response' || !entry.attrs) continue;
      const text = extractAssistantText(entry.attrs.response);
      if (!text) continue;
      messages.push({
        role: 'assistant',
        text: text.substring(0, 200),
        ts: typeof entry.ts === 'number' ? entry.ts : 0,
      });
    }

    for (const entry of entries) {
      if (entry.type !== 'assistant.message' || !entry.data || typeof entry.data.content !== 'string') continue;
      const text = entry.data.content.trim();
      if (!text) continue;
      messages.push({
        role: 'assistant',
        text: text.substring(0, 200),
        ts: typeof entry.timestamp === 'number' ? entry.timestamp : 0,
      });
    }
  } catch (err) {
    debugAdapterError('vscode', 'getRecentMessages', err, filePath);
  }

  return messages.slice(-maxItems);
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
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const nonEmptyLines = content.split('\n').filter(ln => ln.trim().length > 0);
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

        const projectPath = await readWorkspacePath(workspacePath);
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
                  project: projectPath || `vscode:${root.channel}:${workspaceId}`,
                  mtime: stat.mtimeMs,
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
                  project: projectPath || `vscode:${root.channel}:${workspaceId}`,
                  mtime: stat.mtimeMs,
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
                project: projectPath || `vscode:${root.channel}:${workspaceId}`,
                mtime: newest.mtime,
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
  get homeDir() { return `${VSCODE_USER_DIR} | ${VSCODE_INSIDERS_USER_DIR}`; }

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
      return {
        toolHistory: await getToolHistory(filePath),
        messages: await getRecentMessages(filePath),
        sessionId,
      };
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
