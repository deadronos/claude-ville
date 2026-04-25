/**
 * OpenAI Codex CLI adapter
 * Data source: ~/.codex/
 *
 * Session rollout format (JSONL):
 *   {"type":"session_meta","payload":{"id":"...","cwd":"/path","cli_version":"..."}}
 *   {"type":"response_item","payload":{"type":"function_call","name":"shell","arguments":"ls"}}
 *   {"type":"response_item","payload":{"type":"message","role":"assistant","content":[...]}}
 *   {"type":"event_msg","payload":{"type":"turn_complete","usage":{...}}}
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { debugAdapterError, readLines, parseJsonLines } = require('./jsonl-utils');

const CODEX_DIR = path.join(os.homedir(), '.codex');
const SESSIONS_DIR = path.join(CODEX_DIR, 'sessions');

// Type for directory entries from readdirSync with withFileTypes: true
type Dirent = { name: string; isDirectory(): boolean; isFile(): boolean; isSymlink(): boolean };

// ─── Utility ─────────────────────────────────────────────

// ─── Rollout parsing ──────────────────────────────────────

/**
 * Extract session meta/tools/messages from Codex rollout JSONL
 * Actual format: all data is inside entry.payload
 */
async function parseRollout(filePath: string) {
  const detail: {
    model: string | null;
    project: string | null;
    lastTool: string | null;
    lastToolInput: string | null;
    lastMessage: string | null;
  } = {
    model: null,
    project: null,
    lastTool: null,
    lastToolInput: null,
    lastMessage: null,
  };

  // session_meta is on the first line of the file → read first
  const firstLines = await readLines(filePath, { from: 'start', count: 5, scope: 'codex' });
  const firstEntries = parseJsonLines(firstLines, 'codex');
  for (const entry of firstEntries) {
    if (entry.type === 'session_meta' && entry.payload) {
      detail.model = entry.payload.model || null;
      detail.project = entry.payload.cwd || null;
      break;
    }
  }

  // Recent tools/messages are read from end of file
  const lastLines = await readLines(filePath, { from: 'end', count: 50, scope: 'codex' });
  const entries = parseJsonLines(lastLines, 'codex');

  for (const entry of entries) {
    const payload = entry.payload;
    if (!payload) continue;

    // response_item
    if (entry.type === 'response_item') {
      // Tool usage (function_call)
      if (!detail.lastTool && (payload.type === 'function_call' || payload.type === 'command_execution')) {
        detail.lastTool = payload.name || payload.type;
        if (payload.arguments) {
          detail.lastToolInput = (typeof payload.arguments === 'string'
            ? payload.arguments : JSON.stringify(payload.arguments)
          ).substring(0, 60);
        } else if (payload.command) {
          detail.lastToolInput = payload.command.substring(0, 60);
        }
      }

      // Text message (assistant)
      if (!detail.lastMessage && payload.type === 'message' && payload.role === 'assistant') {
        const content = payload.content;
        if (typeof content === 'string') {
          detail.lastMessage = content.substring(0, 80);
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'output_text' && block.text) {
              detail.lastMessage = block.text.trim().substring(0, 80);
              break;
            }
            if (block.type === 'text' && block.text) {
              detail.lastMessage = block.text.trim().substring(0, 80);
              break;
            }
          }
        }
      }
    }

    // If model is missing, try to extract from turn_context or event_msg
    if (!detail.model && entry.type === 'turn_context' && payload.model) {
      detail.model = payload.model;
    }
    if (!detail.model && entry.type === 'event_msg' && payload.model) {
      detail.model = payload.model;
    }
  }

  return detail;
}

/**
 * Extract tool history from Codex rollout
 */
async function getToolHistory(filePath: string, maxItems = 15) {
  const tools = [];
  try {
    const lines = await readLines(filePath, { from: 'end', count: 100, scope: 'codex' });
    const entries = parseJsonLines(lines, 'codex');

    for (const entry of entries) {
      if (entry.type !== 'response_item' || !entry.payload) continue;
      const payload = entry.payload;

      if (payload.type === 'function_call' || payload.type === 'command_execution') {
        let detail = '';
        if (payload.arguments) {
          detail = (typeof payload.arguments === 'string'
            ? payload.arguments : JSON.stringify(payload.arguments)
          ).substring(0, 80);
        } else if (payload.command) {
          detail = payload.command.substring(0, 80);
        }
        tools.push({
          tool: payload.name || payload.type,
          detail,
          ts: entry.timestamp ? new Date(entry.timestamp).getTime() : 0,
        });
      }
    }
  } catch (err) {
    debugAdapterError('codex', 'getToolHistory', err, filePath);
  }
  return tools.slice(-maxItems);
}

/**
 * Extract recent messages from Codex rollout
 */
async function getRecentMessages(filePath: string, maxItems = 5) {
  const messages = [];
  try {
    const lines = await readLines(filePath, { from: 'end', count: 60, scope: 'codex' });
    const entries = parseJsonLines(lines, 'codex');

    for (const entry of entries) {
      if (entry.type !== 'response_item' || !entry.payload) continue;
      const payload = entry.payload;
      if (payload.type !== 'message') continue;

      const role = payload.role || 'assistant';
      let text = '';
      if (typeof payload.content === 'string') {
        text = payload.content;
      } else if (Array.isArray(payload.content)) {
        for (const block of payload.content) {
          if ((block.type === 'output_text' || block.type === 'text') && block.text) {
            text = block.text;
            break;
          }
          if (block.type === 'input_text' && block.text && !block.text.startsWith('<environment_context>')) {
            text = block.text;
            break;
          }
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
  } catch (err) {
    debugAdapterError('codex', 'getRecentMessages', err, filePath);
  }
  return messages.slice(-maxItems);
}

/**
 * Scan rollout files from recent date directories
 */
async function scanRecentRollouts(activeThresholdMs: number) {
  type ScanResult = { filePath: string; mtime: number; fileName: string };
  const results: ScanResult[] = [];
  if (!fs.existsSync(SESSIONS_DIR)) return results;

  const now = Date.now();

  try {
    // Iterate YYYY directories
    const years = (await fs.promises.readdir(SESSIONS_DIR, { withFileTypes: true }))
      .filter((d: Dirent) => d.isDirectory())
      .map((d: Dirent) => d.name)
      .sort()
      .reverse()
      .slice(0, 2); // Last 2 years only

    const yearResults = await Promise.all(years.map(async (year: string) => {
      const yearDir = path.join(SESSIONS_DIR, year);
      try {
        const months = (await fs.promises.readdir(yearDir, { withFileTypes: true }))
          .filter((d: Dirent) => d.isDirectory())
          .map((d: Dirent) => d.name)
          .sort()
          .reverse()
          .slice(0, 2); // Last 2 months only

        const monthResults = await Promise.all(months.map(async (month: string) => {
          const monthDir = path.join(yearDir, month);
          try {
            const days = (await fs.promises.readdir(monthDir, { withFileTypes: true }))
              .filter((d: Dirent) => d.isDirectory())
              .map((d: Dirent) => d.name)
              .sort()
              .reverse()
              .slice(0, 3); // Last 3 days only

            const dayResults = await Promise.all(days.map(async (day: string) => {
              const dayDir = path.join(monthDir, day);
              try {
                const rolloutFiles = (await fs.promises.readdir(dayDir))
                  .filter((f: string) => f.startsWith('rollout-') && f.endsWith('.jsonl'));
                const fileResults = await Promise.all(rolloutFiles.map(async (file: string) => {
                  const filePath = path.join(dayDir, file);
                  try {
                    const stat = await fs.promises.stat(filePath);
                    if (now - stat.mtimeMs > activeThresholdMs) return null;
                    return { filePath, mtime: stat.mtimeMs, fileName: file };
                  } catch (err) {
                    debugAdapterError('codex', 'scanRecentRollouts stat', err, filePath);
                    return null;
                  }
                }));
                return fileResults.filter(Boolean);
              } catch (err) {
                debugAdapterError('codex', 'scanRecentRollouts readdir day', err, dayDir);
                return [];
              }
            }));

            return dayResults.flat();
          } catch (err) {
            debugAdapterError('codex', 'scanRecentRollouts readdir month', err, monthDir);
            return [];
          }
        }));

        return monthResults.flat();
      } catch (err) {
        debugAdapterError('codex', 'scanRecentRollouts readdir year', err, yearDir);
        return [];
      }
    }));

    for (const group of yearResults) {
      results.push(...group);
    }
  } catch (err) {
    debugAdapterError('codex', 'scanRecentRollouts', err, SESSIONS_DIR);
  }

  return results;
}

// ─── Adapter class ────────────────────────────────────

class CodexAdapter {
  get name() { return 'Codex CLI'; }
  get provider() { return 'codex'; }
  get homeDir() { return CODEX_DIR; }

  isAvailable() {
    return fs.existsSync(CODEX_DIR);
  }

  async getActiveSessions(activeThresholdMs: number) {
    const rollouts = await scanRecentRollouts(activeThresholdMs);
    const sessions = await Promise.all(rollouts.map(async ({ filePath, mtime, fileName }) => {
      const detail = await parseRollout(filePath);
      // Extract session ID from filename: rollout-2025-01-22T10-30-00-abc123.jsonl
      const sessionId = fileName.replace('rollout-', '').replace('.jsonl', '');

      return {
        sessionId: `codex-${sessionId}`,
        provider: 'codex',
        agentId: null,
        agentType: 'main',
        model: detail.model || 'codex',
        status: 'active',
        lastActivity: mtime,
        project: detail.project || null,
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

    // Find file from sessionId
    const cleanId = sessionId.replace('codex-', '');
    const rollouts = await scanRecentRollouts(30 * 60 * 1000); // Expand to 30 min range

    for (const { filePath, fileName } of rollouts) {
      const fileId = fileName.replace('rollout-', '').replace('.jsonl', '');
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

  getWatchPaths() {
    const paths = [];
    if (fs.existsSync(SESSIONS_DIR)) {
      paths.push({ type: 'directory', path: SESSIONS_DIR, recursive: true, filter: '.jsonl' });
    }
    return paths;
  }
}

module.exports = { CodexAdapter };
