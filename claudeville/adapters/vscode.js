/**
 * VS Code / VS Code Insiders Copilot Chat 어댑터
 * 데이터 소스:
 *   ~/Library/Application Support/Code/User/workspaceStorage/<workspaceId>/GitHub.copilot-chat/debug-logs/<sessionId>/main.jsonl
 *   ~/Library/Application Support/Code - Insiders/User/workspaceStorage/<workspaceId>/GitHub.copilot-chat/debug-logs/<sessionId>/main.jsonl
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const VSCODE_USER_DIR = process.env.VSCODE_USER_DATA_DIR
  || path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User');
const VSCODE_INSIDERS_USER_DIR = process.env.VSCODE_INSIDERS_USER_DATA_DIR
  || path.join(os.homedir(), 'Library', 'Application Support', 'Code - Insiders', 'User');

const STORAGE_ROOTS = [
  { channel: 'vscode', workspaceStorageDir: path.join(VSCODE_USER_DIR, 'workspaceStorage') },
  { channel: 'vscode-insiders', workspaceStorageDir: path.join(VSCODE_INSIDERS_USER_DIR, 'workspaceStorage') },
];

async function readLines(filePath, { from = 'end', count = 60 } = {}) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    if (from === 'start') return lines.slice(0, count);
    return lines.slice(-count);
  } catch {
    return [];
  }
}

function parseJsonLines(lines) {
  const results = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { results.push(JSON.parse(line)); } catch { /* 무시 */ }
  }
  return results;
}

function toTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function summarizeJson(value, maxLength = 80) {
  if (value === null || value === undefined) return '';
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return raw.substring(0, maxLength);
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
    // JSON 파싱 실패 시 원문 일부를 그대로 사용
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

  const lines = await readLines(filePath, { from: 'end', count: 200 });
  const entries = parseJsonLines(lines);

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];

    if (!detail.model && entry.type === 'llm_request' && entry.attrs && entry.attrs.model) {
      detail.model = entry.attrs.model;
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

    if (!detail.lastMessage && entry.type === 'agent_response' && entry.attrs) {
      const text = extractAssistantText(entry.attrs.response);
      if (text) detail.lastMessage = text.substring(0, 120);
    }

    if (detail.model && detail.lastMessage && detail.lastTool) break;
  }

  return detail;
}

async function getToolHistory(filePath, maxItems = 15) {
  const tools = [];
  try {
    const lines = await readLines(filePath, { from: 'end', count: 300 });
    const entries = parseJsonLines(lines);

    for (const entry of entries) {
      if (entry.type !== 'tool_call') continue;
      tools.push({
        tool: entry.name || 'tool_call',
        detail: summarizeJson(entry.attrs && entry.attrs.args, 120),
        ts: toTimestamp(entry.ts),
      });
    }
  } catch { /* 무시 */ }

  return tools.slice(-maxItems);
}

async function getRecentMessages(filePath, maxItems = 5) {
  const messages = [];
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
        ts: toTimestamp(entry.ts),
      });
    }
  } catch { /* 무시 */ }

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
    // 무시
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
        const debugLogsDir = path.join(workspacePath, 'GitHub.copilot-chat', 'debug-logs');
        if (!fs.existsSync(debugLogsDir)) return [];

        const projectPath = await readWorkspacePath(workspacePath);
        let debugLogDirs = [];

        try {
          debugLogDirs = await fs.promises.readdir(debugLogsDir, { withFileTypes: true });
        } catch {
          return [];
        }

        const fileEntries = await Promise.all(debugLogDirs
          .filter(d => d.isDirectory())
          .map(async (logDir) => {
            const mainLogFile = path.join(debugLogsDir, logDir.name, 'main.jsonl');
            if (!fs.existsSync(mainLogFile)) return null;

            try {
              const stat = await fs.promises.stat(mainLogFile);
              if (now - stat.mtimeMs > activeThresholdMs) return null;

              return {
                channel: root.channel,
                workspaceId,
                debugLogId: logDir.name,
                filePath: mainLogFile,
                project: projectPath || `vscode:${root.channel}:${workspaceId}`,
                mtime: stat.mtimeMs,
              };
            } catch {
              return null;
            }
          }));

        return fileEntries.filter(Boolean);
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
    const sessions = await Promise.all(logs.map(async ({ channel, workspaceId, debugLogId, filePath, project, mtime }) => {
      const detail = await parseSession(filePath);
      return {
        sessionId: buildSessionId(channel, workspaceId, debugLogId),
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
      && s.debugLogId === parsed.debugLogId
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
        filter: 'main.jsonl',
      });
    }
    return paths;
  }
}

module.exports = { VSCodeAdapter };