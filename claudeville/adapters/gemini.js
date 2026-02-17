/**
 * Google Gemini CLI 어댑터
 * 데이터 소스: ~/.gemini/
 *
 * 세션 포맷 (JSON 배열):
 *   [
 *     {"role": "user", "parts": [{"text": "Hello"}]},
 *     {"role": "model", "parts": [{"text": "Hi!"}, {"functionCall": {...}}]}
 *   ]
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const GEMINI_DIR = path.join(os.homedir(), '.gemini');
const TMP_DIR = path.join(GEMINI_DIR, 'tmp');

// ─── 세션 파싱 ────────────────────────────────────────

/**
 * Gemini 세션 JSON에서 모델/도구/메시지 추출
 */
function parseSession(filePath) {
  const detail = {
    model: null,
    lastTool: null,
    lastToolInput: null,
    lastMessage: null,
  };

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const turns = JSON.parse(content);
    if (!Array.isArray(turns)) return detail;

    // 마지막부터 역순으로 탐색
    for (let i = turns.length - 1; i >= 0; i--) {
      const turn = turns[i];
      if (turn.role !== 'model') continue;

      const parts = turn.parts;
      if (!Array.isArray(parts)) continue;

      for (const part of parts) {
        // 도구 사용 (functionCall)
        if (!detail.lastTool && part.functionCall) {
          detail.lastTool = part.functionCall.name || 'function_call';
          if (part.functionCall.args) {
            const args = part.functionCall.args;
            if (args.command) {
              detail.lastToolInput = args.command.substring(0, 60);
            } else if (args.file_path || args.filePath) {
              const fp = args.file_path || args.filePath;
              detail.lastToolInput = fp.split('/').pop();
            } else {
              detail.lastToolInput = JSON.stringify(args).substring(0, 60);
            }
          }
        }

        // 텍스트 메시지
        if (!detail.lastMessage && part.text) {
          const text = part.text.trim();
          if (text.length > 0) {
            detail.lastMessage = text.substring(0, 80);
          }
        }
      }

      if (detail.lastTool && detail.lastMessage) break;
    }

    // 모델 정보: Gemini 세션에는 직접 명시 안 되는 경우가 많음
    // modelVersion 필드가 있으면 사용, 없으면 기본값
    if (turns.length > 0 && turns[0].modelVersion) {
      detail.model = turns[0].modelVersion;
    }
  } catch { /* 무시 */ }

  return detail;
}

/**
 * Gemini 세션에서 도구 히스토리 추출
 */
function getToolHistory(filePath, maxItems = 15) {
  const tools = [];
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const turns = JSON.parse(content);
    if (!Array.isArray(turns)) return tools;

    for (const turn of turns) {
      if (turn.role !== 'model') continue;
      const parts = turn.parts;
      if (!Array.isArray(parts)) continue;

      for (const part of parts) {
        if (!part.functionCall) continue;
        let detail = '';
        if (part.functionCall.args) {
          const args = part.functionCall.args;
          if (args.command) detail = args.command.substring(0, 80);
          else if (args.file_path || args.filePath) detail = args.file_path || args.filePath;
          else detail = JSON.stringify(args).substring(0, 80);
        }
        tools.push({
          tool: part.functionCall.name || 'function_call',
          detail,
          ts: 0, // Gemini JSON에는 타임스탬프가 없음
        });
      }
    }
  } catch { /* 무시 */ }
  return tools.slice(-maxItems);
}

/**
 * Gemini 세션에서 최근 메시지 추출
 */
function getRecentMessages(filePath, maxItems = 5) {
  const messages = [];
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const turns = JSON.parse(content);
    if (!Array.isArray(turns)) return messages;

    for (const turn of turns) {
      const parts = turn.parts;
      if (!Array.isArray(parts)) continue;

      for (const part of parts) {
        if (!part.text) continue;
        const text = part.text.trim();
        if (text.length === 0) continue;
        messages.push({
          role: turn.role === 'model' ? 'assistant' : turn.role,
          text: text.substring(0, 200),
          ts: 0,
        });
      }
    }
  } catch { /* 무시 */ }
  return messages.slice(-maxItems);
}

/**
 * 활성 세션 파일 스캔
 * ~/.gemini/tmp/<project_hash>/chats/session-*.json
 */
function scanActiveSessions(activeThresholdMs) {
  const results = [];
  if (!fs.existsSync(TMP_DIR)) return results;

  const now = Date.now();

  try {
    const projectDirs = fs.readdirSync(TMP_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const projDir of projectDirs) {
      const chatsDir = path.join(TMP_DIR, projDir.name, 'chats');
      if (!fs.existsSync(chatsDir)) continue;

      let sessionFiles;
      try {
        sessionFiles = fs.readdirSync(chatsDir)
          .filter(f => f.startsWith('session-') && f.endsWith('.json'));
      } catch { continue; }

      for (const file of sessionFiles) {
        const filePath = path.join(chatsDir, file);
        let stat;
        try { stat = fs.statSync(filePath); } catch { continue; }

        if (now - stat.mtimeMs > activeThresholdMs) continue;

        results.push({
          filePath,
          mtime: stat.mtimeMs,
          fileName: file,
          projectHash: projDir.name,
        });
      }
    }
  } catch { /* 무시 */ }

  return results;
}

/**
 * 프로젝트 해시에서 프로젝트 경로 복원 시도
 * logs.json에 cwd 정보가 있을 수 있음
 */
function resolveProjectPath(projectHash) {
  const logsFile = path.join(TMP_DIR, projectHash, 'logs.json');
  try {
    if (fs.existsSync(logsFile)) {
      const logs = JSON.parse(fs.readFileSync(logsFile, 'utf-8'));
      if (Array.isArray(logs) && logs.length > 0 && logs[0].cwd) {
        return logs[0].cwd;
      }
    }
  } catch { /* 무시 */ }
  return null;
}

// ─── 어댑터 클래스 ────────────────────────────────────

class GeminiAdapter {
  get name() { return 'Gemini CLI'; }
  get provider() { return 'gemini'; }
  get homeDir() { return GEMINI_DIR; }

  isAvailable() {
    return fs.existsSync(GEMINI_DIR);
  }

  getActiveSessions(activeThresholdMs) {
    const sessionFiles = scanActiveSessions(activeThresholdMs);
    const sessions = [];

    for (const { filePath, mtime, fileName, projectHash } of sessionFiles) {
      const detail = parseSession(filePath);
      const sessionId = fileName.replace('session-', '').replace('.json', '');
      const project = resolveProjectPath(projectHash);

      sessions.push({
        sessionId: `gemini-${sessionId}`,
        provider: 'gemini',
        agentId: null,
        agentType: 'main',
        model: detail.model || 'gemini',
        status: 'active',
        lastActivity: mtime,
        project: project || `~/.gemini/tmp/${projectHash}`,
        lastMessage: detail.lastMessage,
        lastTool: detail.lastTool,
        lastToolInput: detail.lastToolInput,
        parentSessionId: null,
      });
    }

    return sessions.sort((a, b) => b.lastActivity - a.lastActivity);
  }

  getSessionDetail(sessionId, project) {
    const cleanId = sessionId.replace('gemini-', '');
    const sessionFiles = scanActiveSessions(30 * 60 * 1000);

    for (const { filePath, fileName } of sessionFiles) {
      const fileId = fileName.replace('session-', '').replace('.json', '');
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
    if (fs.existsSync(TMP_DIR)) {
      try {
        const projDirs = fs.readdirSync(TMP_DIR, { withFileTypes: true })
          .filter(d => d.isDirectory());
        for (const dir of projDirs) {
          const chatsDir = path.join(TMP_DIR, dir.name, 'chats');
          if (fs.existsSync(chatsDir)) {
            paths.push({ type: 'directory', path: chatsDir, filter: '.json' });
          }
        }
      } catch { /* 무시 */ }
    }
    return paths;
  }
}

module.exports = { GeminiAdapter };
