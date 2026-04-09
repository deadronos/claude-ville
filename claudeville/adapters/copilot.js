/**
 * GitHub Copilot CLI 어댑터
 * 데이터 소스: ~/.copilot/
 *
 * 세션 포맷 (JSONL per session UUID):
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

// ─── 유틸 ─────────────────────────────────────────────

function readLines(filePath, { from = 'end', count = 50 } = {}) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf-8');
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

// ─── 롤아웃 파싱 ──────────────────────────────────────

function parseSession(filePath) {
  const detail = {
    model: null,
    project: null,
    lastTool: null,
    lastToolInput: null,
    lastMessage: null,
  };

  // session.start에서 메타데이터 추출
  const firstLines = readLines(filePath, { from: 'start', count: 5 });
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

  // 나머지에서 도구/메시지 추출
  const lastLines = readLines(filePath, { from: 'end', count: 80 });
  const entries = parseJsonLines(lastLines);

  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];

    // assistant.message
    if (entry.type === 'assistant.message' && entry.data) {
      const msg = entry.data;

      // 모델
      if (!detail.model && msg.selectedModel) {
        detail.model = msg.selectedModel;
      }

      // 텍스트
      if (!detail.lastMessage && msg.content) {
        const text = extractText(msg.content);
        if (text) {
          detail.lastMessage = text.substring(0, 80);
        }
      }

      // 도구
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

    // tool_call 결과
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

// ─── 도구 히스토리 ────────────────────────────────────

function getToolHistory(filePath, maxItems = 15) {
  const tools = [];
  try {
    const lines = readLines(filePath, { from: 'end', count: 100 });
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
  } catch { /* 무시 */ }
  return tools.slice(-maxItems);
}

// ─── 최근 메시지 ──────────────────────────────────────

function getRecentMessages(filePath, maxItems = 5) {
  const messages = [];
  try {
    const lines = readLines(filePath, { from: 'end', count: 60 });
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
  } catch { /* 무시 */ }
  return messages.slice(-maxItems);
}

// ─── 세션 스캔 ────────────────────────────────────────

function scanAllSessions(activeThresholdMs) {
  const results = [];
  if (!fs.existsSync(SESSION_STATE_DIR)) return results;

  const now = Date.now();

  try {
    const sessionDirs = fs.readdirSync(SESSION_STATE_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const sessionDir of sessionDirs) {
      const eventsFile = path.join(SESSION_STATE_DIR, sessionDir.name, 'events.jsonl');
      if (!fs.existsSync(eventsFile)) continue;

      let stat;
      try { stat = fs.statSync(eventsFile); } catch { continue; }

      if (now - stat.mtimeMs > activeThresholdMs) continue;

      results.push({
        filePath: eventsFile,
        mtime: stat.mtimeMs,
        sessionId: sessionDir.name,
      });
    }
  } catch { /* 무시 */ }

  return results;
}

// ─── 어댑터 클래스 ─────────────────────────────────────

class CopilotAdapter {
  get name() { return 'GitHub Copilot'; }
  get provider() { return 'copilot'; }
  get homeDir() { return COPILOT_DIR; }

  isAvailable() {
    return fs.existsSync(SESSION_STATE_DIR);
  }

  getActiveSessions(activeThresholdMs) {
    const sessions = scanAllSessions(activeThresholdMs);

    return sessions.map(({ filePath, mtime, sessionId }) => {
      const detail = parseSession(filePath);

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
      };
    }).sort((a, b) => b.lastActivity - a.lastActivity);
  }

  getSessionDetail(sessionId, project) {
    const cleanId = sessionId.replace('copilot-', '');
    const sessions = scanAllSessions(30 * 60 * 1000);

    const found = sessions.find(s => s.sessionId === cleanId);
    if (found) {
      return {
        toolHistory: getToolHistory(found.filePath),
        messages: getRecentMessages(found.filePath),
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
