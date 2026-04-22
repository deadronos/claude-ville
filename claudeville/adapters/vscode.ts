/**
 * VS Code / VS Code Insiders Copilot Chat adapter
 * Data source:
 *   ~/Library/Application Support/Code/User/workspaceStorage/<workspaceId>/GitHub.copilot-chat/debug-logs/<sessionId>/main.jsonl
 *   ~/Library/Application Support/Code - Insiders/User/workspaceStorage/<workspaceId>/GitHub.copilot-chat/debug-logs/<sessionId>/main.jsonl
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { readLines, parseJsonLines } = require('./jsonl-utils');

const VSCODE_USER_DIR = process.env.VSCODE_USER_DATA_DIR
  || path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User');
const VSCODE_INSIDERS_USER_DIR = process.env.VSCODE_INSIDERS_USER_DATA_DIR
  || path.join(os.homedir(), 'Library', 'Application Support', 'Code - Insiders', 'User');

const STORAGE_ROOTS = [
  { channel: 'vscode', workspaceStorageDir: path.join(VSCODE_USER_DIR, 'workspaceStorage') },
  { channel: 'vscode-insiders', workspaceStorageDir: path.join(VSCODE_INSIDERS_USER_DIR, 'workspaceStorage') },
];

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

function shouldReplaceCandidate(existing, incoming) {
  if (!existing) return true;
  const existingPriority = SOURCE_PRIORITY[existing.sourceType] || 0;
  const incomingPriority = SOURCE_PRIORITY[incoming.sourceType] || 0;

  if (incomingPriority > existingPriority) return true;
  if (incomingPriority < existingPriority) return false;

  return incoming.mtime > existing.mtime;
}

function summarizeJson(value, maxLength = 80) {
  if (value === null || value === undefined) return '';
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return raw.substring(0, maxLength);
}

function getResourceSessionRoot(filePath) {
  if (!filePath.endsWith('content.txt')) return null;
  const callDir = path.dirname(filePath);
  return path.dirname(callDir);
}

async function scanResourceSessionContents(filePath) {
  const sessionRoot = getResourceSessionRoot(filePath);
  if (!sessionRoot || !fs.existsSync(sessionRoot)) return [];

  let entries = [];
  try {
    const children = await fs.promises.readdir(sessionRoot, { withFileTypes: true });
    const contentRows = await Promise.all(children
      .filter(d => d.isDirectory())
      .map(async (dirent) => {
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
        } catch {
          return null;
        }
      }));

    entries = contentRows.filter(Boolean).sort((a, b) => a.ts - b.ts);
  } catch {
    entries = [];
  }

  return entries;
}

function extractAssistantText(responseRaw) {
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
  } catch {
    // JSON parse failed; use raw text as-is
    return responseRaw.substring(0, 200).trim();
  }

  return '';
}

async function parseSession(filePath) {
  const detail = {
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
    } catch {
      // ignore
    }
    return detail;
  }

  const lines = await readLines(filePath, { from: 'end', count: 300 });
  const entries = parseJsonLines(lines);

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

async function getToolHistory(filePath, maxItems = 15) {
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
    const lines = await readLines(filePath, { from: 'end', count: 300 });
    const entries = parseJsonLines(lines);

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
  } catch { /* ignore */ }

  return tools.slice(-maxItems);
}

async function getRecentMessages(filePath, maxItems = 5) {
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
      } catch {
        // ignore
      }
    }

    return messages.slice(-maxItems);
  }

  try {
    const lines = await readLines(filePath, { from: 'end', count: 300 });
    const entries = parseJsonLines(lines);

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
  } catch { /* ignore */ }

  return messages.slice(-maxItems);
}

async function readWorkspacePath(workspaceDir) {
  const workspaceFile = path.join(workspaceDir, 'workspace.json');
  if (!fs.existsSync(workspaceFile)) return null;

  try {
    const raw = await fs.promises.readFile(workspaceFile, 'utf-8');
    const json = JSON.parse(raw);

    const uri = json.folder || json.workspace || null;
    if (typeof uri === 'string' && uri.startsWith('file://')) {
      return decodeURIComponent(uri.replace('file://', ''));
    }
  } catch {
    // ignore
  }

  return null;
}

function buildSessionId(channel, workspaceId, debugLogId) {
  return `vscode:${channel}:${workspaceId}:${debugLogId}`;
}

function parseSessionId(sessionId) {
  if (!sessionId.startsWith('vscode:')) return null;
  const parts = sessionId.split(':');
  if (parts.length < 4) return null;
  return {
    channel: parts[1],
    workspaceId: parts[2],
    debugLogId: parts.slice(3).join(':'),
  };
}

async function scanAllSessions(activeThresholdMs) {
  const now = Date.now();
  const effectiveThresholdMs = Math.max(Number(activeThresholdMs || 0), MIN_ACTIVE_WINDOW_MS);
  const results = [];

  for (const root of STORAGE_ROOTS) {
    if (!fs.existsSync(root.workspaceStorageDir)) continue;

    let workspaceDirs = [];
    try {
      workspaceDirs = await fs.promises.readdir(root.workspaceStorageDir, { withFileTypes: true });
    } catch {
      continue;
    }

    const entries = await Promise.all(workspaceDirs
      .filter(d => d.isDirectory())
      .map(async (workspaceDir) => {
        const workspaceId = workspaceDir.name;
        const workspacePath = path.join(root.workspaceStorageDir, workspaceId);
        const copilotChatDir = path.join(workspacePath, 'GitHub.copilot-chat');
        if (!fs.existsSync(copilotChatDir)) return [];

        const projectPath = await readWorkspacePath(workspacePath);
        const candidates = [];

        // legacy/new debug logs
        const debugLogsDir = path.join(copilotChatDir, 'debug-logs');
        if (fs.existsSync(debugLogsDir)) {
          let debugLogDirs = [];
          try {
            debugLogDirs = await fs.promises.readdir(debugLogsDir, { withFileTypes: true });
          } catch {
            debugLogDirs = [];
          }

          const debugEntries = await Promise.all(debugLogDirs
            .filter(d => d.isDirectory())
            .map(async (logDir) => {
              const mainLogFile = path.join(debugLogsDir, logDir.name, 'main.jsonl');
              if (!fs.existsSync(mainLogFile)) return null;

              try {
                const stat = await fs.promises.stat(mainLogFile);
                if (now - stat.mtimeMs > effectiveThresholdMs) return null;
                return {
                  channel: root.channel,
                  workspaceId,
                  rawSessionId: logDir.name,
                  sourceType: 'debug',
                  filePath: mainLogFile,
                  project: projectPath || `vscode:${root.channel}:${workspaceId}`,
                  mtime: stat.mtimeMs,
                };
              } catch {
                return null;
              }
            }));

          candidates.push(...debugEntries.filter(Boolean));
        }

        // transcript jsonl
        const transcriptsDir = path.join(copilotChatDir, 'transcripts');
        if (fs.existsSync(transcriptsDir)) {
          let transcriptFiles = [];
          try {
            transcriptFiles = await fs.promises.readdir(transcriptsDir);
          } catch {
            transcriptFiles = [];
          }

          const transcriptEntries = await Promise.all(transcriptFiles
            .filter(f => f.endsWith('.jsonl'))
            .map(async (file) => {
              const transcriptPath = path.join(transcriptsDir, file);
              try {
                const stat = await fs.promises.stat(transcriptPath);
                if (now - stat.mtimeMs > effectiveThresholdMs) return null;

                return {
                  channel: root.channel,
                  workspaceId,
                  rawSessionId: file.replace('.jsonl', ''),
                  sourceType: 'transcript',
                  filePath: transcriptPath,
                  project: projectPath || `vscode:${root.channel}:${workspaceId}`,
                  mtime: stat.mtimeMs,
                };
              } catch {
                return null;
              }
            }));

          candidates.push(...transcriptEntries.filter(Boolean));
        }

        // live chat resources (often newest while a turn is running)
        const resourcesDir = path.join(copilotChatDir, 'chat-session-resources');
        if (fs.existsSync(resourcesDir)) {
          let sessionDirs = [];
          try {
            sessionDirs = await fs.promises.readdir(resourcesDir, { withFileTypes: true });
          } catch {
            sessionDirs = [];
          }

          const resourceEntries = await Promise.all(sessionDirs
            .filter(d => d.isDirectory())
            .map(async (sessionDir) => {
              const sessionRoot = path.join(resourcesDir, sessionDir.name);
              let toolDirs = [];
              try {
                toolDirs = await fs.promises.readdir(sessionRoot, { withFileTypes: true });
              } catch {
                return null;
              }

              const statPromises = toolDirs.map(async (td) => {
                if (!td.isDirectory()) return null;
                const contentFile = path.join(sessionRoot, td.name, 'content.txt');
                if (!fs.existsSync(contentFile)) return null;
                try {
                  const stat = await fs.promises.stat(contentFile);
                  return { filePath: contentFile, mtime: stat.mtimeMs };
                } catch {
                  return null;
                }
              });

              const stats = await Promise.all(statPromises);
              let newest = null;
              for (const stat of stats) {
                if (stat && (!newest || stat.mtime > newest.mtime)) {
                  newest = stat;
                }
              }

              if (!newest) return null;
              if (now - newest.mtime > effectiveThresholdMs) return null;

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

          candidates.push(...resourceEntries.filter(Boolean));
        }
        // dedupe by raw session key, keep newest source
        const bySession = new Map();
        for (const item of candidates) {
          const key = `${item.channel}:${item.workspaceId}:${item.rawSessionId}`;
          const existing = bySession.get(key);
          if (shouldReplaceCandidate(existing, item)) {
            bySession.set(key, item);
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

class VSCodeAdapter {
  get name() { return 'VS Code Copilot Chat'; }
  get provider() { return 'vscode'; }
  get homeDir() { return `${VSCODE_USER_DIR} | ${VSCODE_INSIDERS_USER_DIR}`; }

  isAvailable() {
    return STORAGE_ROOTS.some(root => fs.existsSync(root.workspaceStorageDir));
  }

  async getActiveSessions(activeThresholdMs) {
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

  async getSessionDetail(sessionId, project, filePath = null) {
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

  getWatchPaths() {
    const paths = [];
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

module.exports = { VSCodeAdapter };