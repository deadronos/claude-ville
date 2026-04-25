/**
 * OpenClaw adapter
 * Data source: ~/.openclaw/agents/{agentId}/sessions/
 *
 * Session format (JSONL):
 *   {"type":"session","version":3,"id":"...","timestamp":"...","cwd":"..."}
 *   {"type":"model_change","provider":"github-copilot","modelId":"gpt-5-mini",...}
 *   {"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"..."}],"model":"...","usage":{...}},...}
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { debugAdapterError, readLines, parseJsonLines } = require('./jsonl-utils');

const OPENCLAW_DIR = path.join(os.homedir(), '.openclaw');
const AGENTS_DIR = path.join(OPENCLAW_DIR, 'agents');

// Type for directory entries from readdirSync with withFileTypes: true
type Dirent = { name: string; isDirectory(): boolean; isFile(): boolean; isSymlink(): boolean };

// ─── Utility ─────────────────────────────────────────────

// ─── Session parsing ──────────────────────────────────────

async function parseSession(filePath: string) {
  const detail = {
    model: null,
    provider: null,
    project: null,
    lastTool: null,
    lastToolInput: null,
    lastMessage: null,
  };

  const lines = await readLines(filePath, { from: 'end', count: 80, scope: 'openclaw' });
  const entries = parseJsonLines(lines, 'openclaw');

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
        if (text) {
          detail.lastMessage = text.substring(0, 80);
        }
      }

      // Tool usage (tool_use block in content)
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

function extractText(content: unknown) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  for (const block of content) {
    if (block.type === 'text' && block.text) return block.text.trim();
    if (block.type === 'output_text' && block.text) return block.text.trim();
  }
  return '';
}

// ─── Tool history ────────────────────────────────────

async function getToolHistory(filePath: string, maxItems = 15) {
  const tools = [];
  try {
    const lines = await readLines(filePath, { from: 'end', count: 100, scope: 'openclaw' });
    const entries = parseJsonLines(lines, 'openclaw');

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
  } catch (err) {
    debugAdapterError('openclaw', 'getToolHistory', err, filePath);
  }
  return tools.slice(-maxItems);
}

// ─── Recent messages ──────────────────────────────────────

async function getRecentMessages(filePath: string, maxItems = 5) {
  const messages = [];
  try {
    const lines = await readLines(filePath, { from: 'end', count: 60, scope: 'openclaw' });
    const entries = parseJsonLines(lines, 'openclaw');

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
    debugAdapterError('openclaw', 'getRecentMessages', err, filePath);
  }
  return messages.slice(-maxItems);
}

function encodeSessionKey(value: string) {
  return encodeURIComponent(value || '');
}

function decodeSessionKey(value: string) {
  return decodeURIComponent(value || '');
}

function buildSessionId(agentId: string, fileName: string) {
  const sessionId = fileName.replace('.jsonl', '');
  return `openclaw:${encodeSessionKey(agentId)}:${encodeSessionKey(sessionId)}`;
}

function buildProjectKey(agentId: string | null, projectPath: string | null) {
  if (agentId) {
    return `openclaw:${agentId}`;
  }
  return projectPath || null;
}

function parseSessionId(sessionId: string) {
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

// ─── Session scan ────────────────────────────────────────

type OpenClawScanResult = { filePath: string; mtime: number; fileName: string; agentId: string };

async function scanAllSessionFiles(activeThresholdMs: number): Promise<OpenClawScanResult[]> {
  const results: OpenClawScanResult[] = [];
  if (!fs.existsSync(AGENTS_DIR)) return results;

  const now = Date.now();

  try {
    const agentDirs = (await fs.promises.readdir(AGENTS_DIR, { withFileTypes: true }))
      .filter((d: Dirent) => d.isDirectory());
    const agentResults = await Promise.all(
      agentDirs.map(async (agentDir: Dirent) => {
        const sessionsDir = path.join(AGENTS_DIR, agentDir.name, 'sessions');
        if (!fs.existsSync(sessionsDir)) return [];

        try {
          const sessionFiles = await fs.promises.readdir(sessionsDir);
          const jsonlFiles = sessionFiles.filter((f: string) => f.endsWith('.jsonl'));
          const fileResults = await Promise.all(
            jsonlFiles.map(async (file: string) => {
              const filePath = path.join(sessionsDir, file);
              try {
                const stat = await fs.promises.stat(filePath);
                if (now - stat.mtimeMs > activeThresholdMs) return null;
                return {
                  filePath,
                  mtime: stat.mtimeMs,
                  fileName: file,
                  agentId: agentDir.name,
                };
              } catch (err) {
                debugAdapterError('openclaw', 'scanAllSessionFiles stat', err, filePath);
                return null;
              }
            })
          );
          return fileResults.filter((r: OpenClawScanResult | null): r is OpenClawScanResult => r !== null);
        } catch (err) {
          debugAdapterError('openclaw', 'scanAllSessionFiles readdir sessions', err, sessionsDir);
          return [];
        }
      })
    );
    for (const group of agentResults) {
      results.push(...group);
    }
  } catch (err) {
    debugAdapterError('openclaw', 'scanAllSessionFiles', err, AGENTS_DIR);
  }

  return results;
}

// ─── Adapter class ─────────────────────────────────────

class OpenClawAdapter {
  get name() { return 'OpenClaw'; }
  get provider() { return 'openclaw'; }
  get homeDir() { return OPENCLAW_DIR; }

  isAvailable() {
    return fs.existsSync(AGENTS_DIR);
  }

  async getActiveSessions(activeThresholdMs: number) {
    const sessionFiles = await scanAllSessionFiles(activeThresholdMs);
    const sessions = await Promise.all(sessionFiles.map(async ({ filePath, mtime, fileName, agentId }) => {
      const detail = await parseSession(filePath);

      return {
        sessionId: buildSessionId(agentId, fileName),
        provider: 'openclaw',
        agentId,
        displayName: agentId || null,
        agentType: 'main',
        model: detail.model || 'unknown',
        status: 'active',
        lastActivity: mtime,
        project: buildProjectKey(agentId, detail.project),
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

    for (const { filePath, fileName, agentId } of sessionFiles) {
      const fileId = fileName.replace('.jsonl', '');
      if (
        fileId === parsed.fileId
        && (!parsed.agentId || parsed.agentId === agentId)
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

  getWatchPaths(): Array<{ type: string; path: string; recursive?: boolean; filter?: string }> {
    const paths: Array<{ type: string; path: string; recursive?: boolean; filter?: string }> = [];
    if (!fs.existsSync(AGENTS_DIR)) return paths;

    try {
      const agentDirs = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
        .filter((d: Dirent) => d.isDirectory());

      for (const dir of agentDirs) {
        const sessionsDir = path.join(AGENTS_DIR, dir.name, 'sessions');
        if (fs.existsSync(sessionsDir)) {
          paths.push({ type: 'directory', path: sessionsDir, filter: '.jsonl' });
        }
      }
    } catch (err) {
      debugAdapterError('openclaw', 'getWatchPaths', err, AGENTS_DIR);
    }

    return paths;
  }
}

module.exports = { OpenClawAdapter };
