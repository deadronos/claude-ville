/**
 * OpenClaw 어댑터
 * 데이터 소스: ~/.openclaw/agents/{agentId}/sessions/
 *
 * 세션 포맷 (JSONL):
 *   {"type":"session","version":3,"id":"...","timestamp":"...","cwd":"..."}
 *   {"type":"model_change","provider":"github-copilot","modelId":"gpt-5-mini",...}
 *   {"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"..."}],"model":"...","usage":{...}},...}
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const OPENCLAW_DIR = path.join(os.homedir(), '.openclaw');
const AGENTS_DIR = path.join(OPENCLAW_DIR, 'agents');

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
    provider: null,
    project: null,
    lastTool: null,
    lastToolInput: null,
    lastMessage: null,
  };

  const lines = readLines(filePath, { from: 'end', count: 80 });
  const entries = parseJsonLines(lines);

  // 마지막부터 역순으로 탐색
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];

    // 세션 시작에서 cwd/프로젝트 추출
    if (!detail.project && entry.type === 'session' && entry.cwd) {
      detail.project = entry.cwd;
    }

    // 모델 변경
    if (!detail.model && entry.type === 'model_change') {
      detail.model = entry.modelId || null;
      detail.provider = entry.provider || null;
    }

    // 메시지
    if (entry.type === 'message' && entry.message) {
      const msg = entry.message;

      // 모델
      if (!detail.model && msg.model) {
        detail.model = msg.model;
      }
      if (!detail.provider && msg.provider) {
        detail.provider = msg.provider;
      }

      // 마지막 텍스트 메시지
      if (!detail.lastMessage && msg.content) {
        const text = extractText(msg.content);
        if (text) {
          detail.lastMessage = text.substring(0, 80);
        }
      }

      // 도구 사용 (content에서 tool_use 블록)
      if (!detail.lastTool && msg.content) {
        for (const block of msg.content) {
          if (block.type === 'tool_use' || block.name) {
            detail.lastTool = block.name || 'tool_use';
            if (block.input) {
              detail.lastToolInput = (typeof block.input === 'string'
                ? block.input : JSON.stringify(block.input)
              ).substring(0, 60);
            }
            break;
          }
        }
      }

      if (detail.lastMessage && detail.model) break;
    }
  }

  return detail;
}

function extractText(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  for (const block of content) {
    if (block.type === 'text' && block.text) return block.text.trim();
    if (block.type === 'output_text' && block.text) return block.text.trim();
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
      if (entry.type !== 'message' || !entry.message) continue;
      const msg = entry.message;
      if (!msg.content) continue;

      for (const block of msg.content) {
        if (block.type !== 'tool_use' && !block.name) continue;
        let detail = '';
        if (block.input) {
          detail = (typeof block.input === 'string'
            ? block.input : JSON.stringify(block.input)
          ).substring(0, 80);
        }
        tools.push({
          tool: block.name || 'tool_use',
          detail,
          ts: entry.timestamp ? new Date(entry.timestamp).getTime() : 0,
        });
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
  } catch { /* 무시 */ }
  return messages.slice(-maxItems);
}

function encodeSessionKey(value) {
  return encodeURIComponent(value || '');
}

function decodeSessionKey(value) {
  return decodeURIComponent(value || '');
}

function buildSessionId(agentId, fileName) {
  const sessionId = fileName.replace('.jsonl', '');
  return `openclaw:${encodeSessionKey(agentId)}:${encodeSessionKey(sessionId)}`;
}

function parseSessionId(sessionId) {
  if (!sessionId.startsWith('openclaw:')) {
    return {
      agentId: null,
      fileId: sessionId.replace('openclaw-', ''),
    };
  }

  const [, encodedAgentId = '', encodedFileId = ''] = sessionId.split(':', 3);
  return {
    agentId: decodeSessionKey(encodedAgentId),
    fileId: decodeSessionKey(encodedFileId),
  };
}

// ─── 세션 스캔 ────────────────────────────────────────

function scanAllSessionFiles(activeThresholdMs) {
  const results = [];
  if (!fs.existsSync(AGENTS_DIR)) return results;

  const now = Date.now();

  try {
    const agentDirs = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const agentDir of agentDirs) {
      const sessionsDir = path.join(AGENTS_DIR, agentDir.name, 'sessions');
      if (!fs.existsSync(sessionsDir)) continue;

      let sessionFiles;
      try {
        sessionFiles = fs.readdirSync(sessionsDir)
          .filter(f => f.endsWith('.jsonl'));
      } catch { continue; }

      for (const file of sessionFiles) {
        const filePath = path.join(sessionsDir, file);
        let stat;
        try { stat = fs.statSync(filePath); } catch { continue; }

        if (now - stat.mtimeMs > activeThresholdMs) continue;

        results.push({
          filePath,
          mtime: stat.mtimeMs,
          fileName: file,
          agentId: agentDir.name,
        });
      }
    }
  } catch { /* 무시 */ }

  return results;
}

// ─── 어댑터 클래스 ─────────────────────────────────────

class OpenClawAdapter {
  get name() { return 'OpenClaw'; }
  get provider() { return 'openclaw'; }
  get homeDir() { return OPENCLAW_DIR; }

  isAvailable() {
    return fs.existsSync(AGENTS_DIR);
  }

  getActiveSessions(activeThresholdMs) {
    const sessionFiles = scanAllSessionFiles(activeThresholdMs);
    const sessions = [];

    for (const { filePath, mtime, fileName, agentId } of sessionFiles) {
      const detail = parseSession(filePath);

      sessions.push({
        sessionId: buildSessionId(agentId, fileName),
        provider: 'openclaw',
        agentId,
        displayName: agentId || null,
        agentType: 'main',
        model: detail.model || 'unknown',
        status: 'active',
        lastActivity: mtime,
        project: detail.project,
        lastMessage: detail.lastMessage,
        lastTool: detail.lastTool,
        lastToolInput: detail.lastToolInput,
        parentSessionId: null,
      });
    }

    return sessions.sort((a, b) => b.lastActivity - a.lastActivity);
  }

  getSessionDetail(sessionId, project) {
    const sessionFiles = scanAllSessionFiles(30 * 60 * 1000);
    const parsed = parseSessionId(sessionId);

    for (const { filePath, fileName, agentId } of sessionFiles) {
      const fileId = fileName.replace('.jsonl', '');
      if (
        fileId === parsed.fileId
        && (!parsed.agentId || parsed.agentId === agentId)
      ) {
        return {
          toolHistory: getToolHistory(filePath),
          messages: getRecentMessages(filePath),
          sessionId,
        };
      }
    }

    return { toolHistory: [], messages: [] };
  }

  getWatchPaths() {
    const paths = [];
    if (!fs.existsSync(AGENTS_DIR)) return paths;

    try {
      const agentDirs = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory());

      for (const dir of agentDirs) {
        const sessionsDir = path.join(AGENTS_DIR, dir.name, 'sessions');
        if (fs.existsSync(sessionsDir)) {
          paths.push({ type: 'directory', path: sessionsDir, filter: '.jsonl' });
        }
      }
    } catch { /* 무시 */ }

    return paths;
  }
}

module.exports = { OpenClawAdapter };
