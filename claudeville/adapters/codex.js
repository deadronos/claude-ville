/**
 * OpenAI Codex CLI 어댑터
 * 데이터 소스: ~/.codex/
 *
 * 세션 롤아웃 포맷 (JSONL):
 *   {"type":"session_meta","timestamp":"...","model":"gpt-4o","cwd":"/path"}
 *   {"type":"response_item","item":{"type":"function_call","name":"shell","arguments":"ls"}}
 *   {"type":"response_item","item":{"type":"message","role":"assistant","content":[...]}}
 *   {"type":"event_msg","msg":{"type":"turn_complete","usage":{...}}}
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const CODEX_DIR = path.join(os.homedir(), '.codex');
const SESSIONS_DIR = path.join(CODEX_DIR, 'sessions');

// ─── 유틸 ─────────────────────────────────────────────

function readLastLines(filePath, lineCount) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    return lines.slice(-lineCount);
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

/**
 * Codex 롤아웃 JSONL에서 세션 메타/도구/메시지 추출
 */
function parseRollout(filePath) {
  const detail = {
    model: null,
    project: null,
    lastTool: null,
    lastToolInput: null,
    lastMessage: null,
  };

  const lines = readLastLines(filePath, 50);
  const entries = parseJsonLines(lines);

  for (const entry of entries) {
    // 세션 메타데이터
    if (entry.type === 'session_meta') {
      if (!detail.model && entry.model) detail.model = entry.model;
      if (!detail.project && entry.cwd) detail.project = entry.cwd;
    }

    // 응답 항목
    if (entry.type === 'response_item' && entry.item) {
      const item = entry.item;

      // 도구 사용 (function_call)
      if (!detail.lastTool && (item.type === 'function_call' || item.type === 'command_execution')) {
        detail.lastTool = item.name || item.type;
        if (item.arguments) {
          detail.lastToolInput = (typeof item.arguments === 'string'
            ? item.arguments : JSON.stringify(item.arguments)
          ).substring(0, 60);
        } else if (item.command) {
          detail.lastToolInput = item.command.substring(0, 60);
        }
      }

      // 텍스트 메시지
      if (!detail.lastMessage && item.type === 'message' && item.role === 'assistant') {
        const content = item.content;
        if (typeof content === 'string') {
          detail.lastMessage = content.substring(0, 80);
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              detail.lastMessage = block.text.trim().substring(0, 80);
              break;
            }
          }
        }
      }

      // agent_message (Codex exec 모드)
      if (!detail.lastMessage && item.type === 'agent_message' && item.text) {
        detail.lastMessage = item.text.substring(0, 80);
      }
    }
  }

  // 메타가 맨 앞에 있을 수 있으니 전체에서도 찾기
  if (!detail.model || !detail.project) {
    const allLines = readLastLines(filePath, 5);
    const firstEntries = parseJsonLines(allLines);
    for (const entry of firstEntries) {
      if (entry.type === 'session_meta') {
        if (!detail.model && entry.model) detail.model = entry.model;
        if (!detail.project && entry.cwd) detail.project = entry.cwd;
        break;
      }
    }
  }

  return detail;
}

/**
 * Codex 롤아웃에서 도구 히스토리 추출
 */
function getToolHistory(filePath, maxItems = 15) {
  const tools = [];
  try {
    const lines = readLastLines(filePath, 100);
    const entries = parseJsonLines(lines);

    for (const entry of entries) {
      if (entry.type !== 'response_item' || !entry.item) continue;
      const item = entry.item;

      if (item.type === 'function_call' || item.type === 'command_execution') {
        let detail = '';
        if (item.arguments) {
          detail = (typeof item.arguments === 'string'
            ? item.arguments : JSON.stringify(item.arguments)
          ).substring(0, 80);
        } else if (item.command) {
          detail = item.command.substring(0, 80);
        }
        tools.push({
          tool: item.name || item.type,
          detail,
          ts: entry.timestamp ? new Date(entry.timestamp).getTime() : 0,
        });
      }
    }
  } catch { /* 무시 */ }
  return tools.slice(-maxItems);
}

/**
 * Codex 롤아웃에서 최근 메시지 추출
 */
function getRecentMessages(filePath, maxItems = 5) {
  const messages = [];
  try {
    const lines = readLastLines(filePath, 60);
    const entries = parseJsonLines(lines);

    for (const entry of entries) {
      if (entry.type !== 'response_item' || !entry.item) continue;
      const item = entry.item;
      if (item.type !== 'message' && item.type !== 'agent_message') continue;

      const role = item.role || 'assistant';
      let text = '';
      if (item.type === 'agent_message' && item.text) {
        text = item.text;
      } else if (typeof item.content === 'string') {
        text = item.content;
      } else if (Array.isArray(item.content)) {
        for (const block of item.content) {
          if (block.type === 'text' && block.text) { text = block.text; break; }
        }
      }
      if (text.trim().length > 0) {
        messages.push({
          role,
          text: text.trim().substring(0, 200),
          ts: entry.timestamp ? new Date(entry.timestamp).getTime() : 0,
        });
      }
    }
  } catch { /* 무시 */ }
  return messages.slice(-maxItems);
}

/**
 * 최근 날짜 디렉토리에서 롤아웃 파일 스캔
 */
function scanRecentRollouts(activeThresholdMs) {
  const results = [];
  if (!fs.existsSync(SESSIONS_DIR)) return results;

  const now = Date.now();

  try {
    // YYYY 디렉토리 순회
    const years = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort()
      .reverse()
      .slice(0, 2); // 최근 2년만

    for (const year of years) {
      const yearDir = path.join(SESSIONS_DIR, year);
      const months = fs.readdirSync(yearDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .sort()
        .reverse()
        .slice(0, 2); // 최근 2개월만

      for (const month of months) {
        const monthDir = path.join(yearDir, month);
        const days = fs.readdirSync(monthDir, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => d.name)
          .sort()
          .reverse()
          .slice(0, 3); // 최근 3일만

        for (const day of days) {
          const dayDir = path.join(monthDir, day);
          let rolloutFiles;
          try {
            rolloutFiles = fs.readdirSync(dayDir)
              .filter(f => f.startsWith('rollout-') && f.endsWith('.jsonl'));
          } catch { continue; }

          for (const file of rolloutFiles) {
            const filePath = path.join(dayDir, file);
            let stat;
            try { stat = fs.statSync(filePath); } catch { continue; }

            if (now - stat.mtimeMs > activeThresholdMs) continue;

            results.push({ filePath, mtime: stat.mtimeMs, fileName: file });
          }
        }
      }
    }
  } catch { /* 무시 */ }

  return results;
}

// ─── 어댑터 클래스 ────────────────────────────────────

class CodexAdapter {
  get name() { return 'Codex CLI'; }
  get provider() { return 'codex'; }
  get homeDir() { return CODEX_DIR; }

  isAvailable() {
    return fs.existsSync(CODEX_DIR);
  }

  getActiveSessions(activeThresholdMs) {
    const rollouts = scanRecentRollouts(activeThresholdMs);
    const sessions = [];

    for (const { filePath, mtime, fileName } of rollouts) {
      const detail = parseRollout(filePath);
      // 파일명에서 세션 ID 추출: rollout-2025-01-22T10-30-00-abc123.jsonl
      const sessionId = fileName.replace('rollout-', '').replace('.jsonl', '');

      sessions.push({
        sessionId: `codex-${sessionId}`,
        provider: 'codex',
        agentId: null,
        agentType: 'main',
        model: detail.model || 'gpt-4o',
        status: 'active',
        lastActivity: mtime,
        project: detail.project || null,
        lastMessage: detail.lastMessage,
        lastTool: detail.lastTool,
        lastToolInput: detail.lastToolInput,
        parentSessionId: null,
      });
    }

    return sessions.sort((a, b) => b.lastActivity - a.lastActivity);
  }

  getSessionDetail(sessionId, project) {
    // sessionId에서 파일 찾기
    const cleanId = sessionId.replace('codex-', '');
    const rollouts = scanRecentRollouts(30 * 60 * 1000); // 30분 범위로 확대

    for (const { filePath, fileName } of rollouts) {
      const fileId = fileName.replace('rollout-', '').replace('.jsonl', '');
      if (fileId === cleanId) {
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
    if (fs.existsSync(SESSIONS_DIR)) {
      paths.push({ type: 'directory', path: SESSIONS_DIR, recursive: true, filter: '.jsonl' });
    }
    return paths;
  }
}

module.exports = { CodexAdapter };
