/**
 * GitHub Copilot CLI adapter
 * Data source: ~/.copilot/
 *
 * Session format (JSONL per session UUID):
 *   ~/.copilot/session-state/{uuid}/events.jsonl
 *
 *   {"type":"session.start","data":{"sessionId":"...","selectedModel":"gpt-5-mini",
 *        "context":{"cwd":"/path/to/project","gitRoot":"...","branch":"main",...}},...}
 *   {"type":"user.message","data":{"content":"..."}}
 *   {"type":"assistant.message","data":{"content":[{"type":"text","text":"..."}],...}}
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const COPILOT_DIR = path.join(os.homedir(), '.copilot');
const SESSION_STATE_DIR = path.join(COPILOT_DIR, 'session-state');

// ─── Utility ─────────────────────────────────────────────

async function readLines(filePath, { from = 'end', count = 50 } = {}) {
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
    try { results.push(JSON.parse(line)); } catch { /* ignore */ }
  }
  return results;
}

// ─── Session parsing ──────────────────────────────────────

async function parseSession(filePath) {
  const detail = {
    model: null,
    project: null,
    lastTool: null,
    lastToolInput: null,
    lastMessage: null,
  };

  // Extract metadata from session.start
  const firstLines = await readLines(filePath, { from: 'start', count: 5 });
  const firstEntries = parseJsonLines(firstLines);
  for (const entry of firstEntries) {
    if (entry.type === 'session.start' && entry.data) {
      if (!detail.model && entry.data.selectedModel) {
        detail.model = entry.data.selectedModel;
      }
      if (!detail.project && entry.data.context && entry.data.context.cwd) {
        detail.project = entry.data.context.cwd;
      }
      break;
    }
  }

  // Extract tools/messages from the rest
  const lastLines = await readLines(filePath, { from: 'end', count: 80 });
  const entries = parseJsonLines(lastLines);

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];

    // assistant.message
    if (entry.type === 'assistant.message' && entry.data) {
      const msg = entry.data;

      // Model
      if (!detail.model && msg.selectedModel) {
        detail.model = msg.selectedModel;
      }

      // Text
      if (!detail.lastMessage && msg.content) {
        const text = extractText(msg.content);
        if (text) {
          detail.lastMessage = text.substring(0, 80);
        }
      }

      // Tool
      if (!detail.lastTool && msg.toolCalls && Array.isArray(msg.toolCalls)) {
        for (const tc of msg.toolCalls) {
          detail.lastTool = tc.name || 'tool_call';
          if (tc.input) {
            detail.lastToolInput = (typeof tc.input === 'string'
              ? tc.input : JSON.stringify(tc.input)
            ).substring(0, 60);
          }
          break;
        }
      }

      if (detail.lastMessage && detail.model) break;
    }

    // tool_call result
    if (!detail.lastTool && entry.type === 'tool_call' && entry.data) {
      const tc = entry.data;
      detail.lastTool = tc.name || 'tool_call';
      if (tc.input) {
        detail.lastToolInput = (typeof tc.input === 'string'
          ? tc.input : JSON.stringify(tc.input)
        ).substring(0, 60);
      }
    }
  }

  return detail;
}

function extractText(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  for (const block of content) {
    if ((block.type === 'text' || block.type === 'output_text') && block.text) {
      return block.text.trim();
    }
  }
  return '';
}

// ─── Tool history ────────────────────────────────────

async function getToolHistory(filePath, maxItems = 15) {
  const tools = [];
  try {
    const lines = await readLines(filePath, { from: 'end', count: 100 });
    const entries = parseJsonLines(lines);

    for (const entry of entries) {
      let toolName = null;
      let toolInput = null;
      let ts = 0;

      if (entry.type === 'assistant.message' && entry.data) {
        const msg = entry.data;
        if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
          for (const tc of msg.toolCalls) {
            toolName = tc.name || 'tool_call';
            toolInput = tc.input
              ? (typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input)).substring(0, 80)
              : '';
            ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
            break;
          }
        }
      }

      if (!toolName && entry.type === 'tool_call' && entry.data) {
        toolName = entry.data.name || 'tool_call';
        toolInput = entry.data.input
          ? (typeof entry.data.input === 'string' ? entry.data.input : JSON.stringify(entry.data.input)).substring(0, 80)
          : '';
        ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
      }

      if (toolName) {
        tools.push({ tool: toolName, detail: toolInput || '', ts });
      }
    }
  } catch { /* ignore */ }
  return tools.slice(-maxItems);
}

// ─── Recent messages ──────────────────────────────────────

async function getRecentMessages(filePath, maxItems = 5) {
  const messages = [];
  try {
    const lines = await readLines(filePath, { from: 'end', count: 60 });
    const entries = parseJsonLines(lines);

    for (const entry of entries) {
      if (entry.type !== 'user.message' && entry.type !== 'assistant.message') continue;
      if (!entry.data || !entry.data.content) continue;

      const text = extractText(entry.data.content);
      if (!text) continue;

      messages.push({
        role: entry.type === 'user.message' ? 'user' : 'assistant',
        text: text.substring(0, 200),
        ts: entry.timestamp ? new Date(entry.timestamp).getTime() : 0,
      });
    }
  } catch { /* ignore */ }
  return messages.slice(-maxItems);
}

// ─── Session scan ────────────────────────────────────────

async function scanAllSessions(activeThresholdMs) {
  const results = [];
  if (!fs.existsSync(SESSION_STATE_DIR)) return results;

  const now = Date.now();

  try {
    const sessionDirs = (await fs.promises.readdir(SESSION_STATE_DIR, { withFileTypes: true }))
      .filter(d => d.isDirectory());
    const dirResults = await Promise.all(sessionDirs.map(async (sessionDir) => {
      const eventsFile = path.join(SESSION_STATE_DIR, sessionDir.name, 'events.jsonl');
      if (!fs.existsSync(eventsFile)) return null;

      try {
        const stat = await fs.promises.stat(eventsFile);
        if (now - stat.mtimeMs > activeThresholdMs) return null;
        return {
          filePath: eventsFile,
          mtime: stat.mtimeMs,
          sessionId: sessionDir.name,
        };
      } catch {
        return null;
      }
    }));

    results.push(...dirResults.filter(Boolean));
  } catch { /* ignore */ }

  return results;
}

// ─── Adapter class ─────────────────────────────────────

class CopilotAdapter {
  get name() { return 'GitHub Copilot'; }
  get provider() { return 'copilot'; }
  get homeDir() { return COPILOT_DIR; }

  isAvailable() {
    return fs.existsSync(SESSION_STATE_DIR);
  }

  async getActiveSessions(activeThresholdMs) {
    const sessions = await scanAllSessions(activeThresholdMs);

    return Promise.all(sessions.map(async ({ filePath, mtime, sessionId }) => {
      const detail = await parseSession(filePath);

      return {
        sessionId: `copilot-${sessionId}`,
        provider: 'copilot',
        agentId: null,
        agentType: 'main',
        model: detail.model || 'copilot',
        status: 'active',
        lastActivity: mtime,
        project: detail.project,
        lastMessage: detail.lastMessage,
        lastTool: detail.lastTool,
        lastToolInput: detail.lastToolInput,
        parentSessionId: null,
        filePath,
      };
    })).then(results => results.sort((a, b) => b.lastActivity - a.lastActivity));
  }

  async getSessionDetail(sessionId, project, filePath = null) {
    if (filePath) {
      return {
        toolHistory: await getToolHistory(filePath),
        messages: await getRecentMessages(filePath),
        sessionId,
      };
    }

    const cleanId = sessionId.replace('copilot-', '');
    const sessions = await scanAllSessions(30 * 60 * 1000);

    const found = sessions.find(s => s.sessionId === cleanId);
    if (found) {
      return {
        toolHistory: await getToolHistory(found.filePath),
        messages: await getRecentMessages(found.filePath),
        sessionId,
      };
    }

    return { toolHistory: [], messages: [] };
  }

  getWatchPaths() {
    if (fs.existsSync(SESSION_STATE_DIR)) {
      return [{ type: 'directory', path: SESSION_STATE_DIR, recursive: true, filter: 'events.jsonl' }];
    }
    return [];
  }
}

module.exports = { CopilotAdapter };
