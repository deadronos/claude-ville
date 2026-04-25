/**
 * Pi Coding Agent adapter
 * Data source: ~/.pi/agent/sessions/
 *
 * Session format (JSONL):
 *   {"type":"session","version":3,"id":"...","timestamp":"...","cwd":"..."}
 *   {"type":"model_change","provider":"minimax","modelId":"MiniMax-M2.7"}
 *   {"type":"message","message":{"role":"user","content":[{"type":"text","text":"..."}]}}
 *   {"type":"message","message":{"role":"assistant","content":[{"type":"toolCall","name":"bash","arguments":{...}}],"usage":{...}}}
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { readLines, parseJsonLines } = require('./jsonl-utils');

const PI_DIR = path.join(os.homedir(), '.pi');
const SESSIONS_DIR = path.join(PI_DIR, 'agent', 'sessions');

// ─── Utility ─────────────────────────────────────────────

// ─── Session parsing ──────────────────────────────────────

async function parseSession(filePath) {
  const detail = {
    model: null,
    provider: null,
    project: null,
    lastTool: null,
    lastToolInput: null,
    lastMessage: null,
  };

  const lines = await readLines(filePath, { from: 'end', count: 80 });
  const entries = parseJsonLines(lines);

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

      // Tool usage (toolCall block in content)
      if (!detail.lastTool && msg.content) {
        for (const block of msg.content) {
          if (block.type === 'toolCall' || block.name) {
            detail.lastTool = block.name || 'toolCall';
            if (block.arguments) {
              detail.lastToolInput = (typeof block.arguments === 'string'
                ? block.arguments : JSON.stringify(block.arguments)
              ).substring(0, 60);
            }
            break;
          }
        }
      }

      if (detail.lastMessage && detail.model && detail.project) break;
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

// ─── Tool history ───────────────────────────────────

async function getToolHistory(filePath, maxItems = 15) {
  const tools = [];
  try {
    const lines = await readLines(filePath, { from: 'end', count: 100 });
    const entries = parseJsonLines(lines);

    for (const entry of entries) {
      if (entry.type !== 'message' || !entry.message) continue;
      const msg = entry.message;
      if (!msg.content) continue;

      for (const block of msg.content) {
        if (block.type !== 'toolCall' && !block.name) continue;
        let detail = '';
        if (block.arguments) {
          detail = (typeof block.arguments === 'string'
            ? block.arguments : JSON.stringify(block.arguments)
          ).substring(0, 80);
        }
        tools.push({
          tool: block.name || 'toolCall',
          detail,
          ts: entry.timestamp ? new Date(entry.timestamp).getTime() : 0,
        });
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
  } catch { /* ignore */ }
  return messages.slice(-maxItems);
}

function encodeProjectKey(value) {
  return encodeURIComponent(value || '');
}

function decodeProjectKey(value) {
  return decodeURIComponent(value || '');
}

function buildSessionId(projectDir, fileName) {
  // projectDir is like --Users-openclaw-Github-claude-ville--
  // fileName is like 2026-04-24T22-19-42-919Z_019dc193-cfc7-71ff-bfd9-d2fc9f1735e6.jsonl
  const sessionId = fileName.replace('.jsonl', '');
  return `pi:${encodeProjectKey(projectDir)}:${encodeProjectKey(sessionId)}`;
}

function parseSessionId(sessionId) {
  if (!sessionId.startsWith('pi:')) {
    return {
      projectDir: null,
      fileId: sessionId.replace('pi-', ''),
    };
  }

  const [, encodedProjectDir = '', encodedFileId = ''] = sessionId.split(':', 3);
  return {
    projectDir: decodeProjectKey(encodedProjectDir),
    fileId: decodeProjectKey(encodedFileId),
  };
}

function projectDirToPath(projectDir) {
  // Convert --Users-openclaw-Github-claude-ville-- back to /Users/openclaw/Github/claude-ville
  return projectDir
    .replace(/^--/, '/')
    .replace(/--$/, '')
    .replace(/-/g, '/');
}

function resolveProjectPath(detail, projectDir) {
  return detail.project || projectDirToPath(projectDir);
}

// ─── Session scan ────────────────────────────────────────

async function scanAllSessionFiles(activeThresholdMs) {
  const results = [];
  if (!fs.existsSync(SESSIONS_DIR)) return results;

  const now = Date.now();

  try {
    const projectDirs = (await fs.promises.readdir(SESSIONS_DIR, { withFileTypes: true }))
      .filter(d => d.isDirectory());

    const dirResults = await Promise.all(
      projectDirs.map(async (projectDir) => {
        const projectPath = path.join(SESSIONS_DIR, projectDir.name);
        try {
          const sessionFiles = await fs.promises.readdir(projectPath);
          const jsonlFiles = sessionFiles.filter(f => f.endsWith('.jsonl'));

          const fileResults = await Promise.all(
            jsonlFiles.map(async (file) => {
              const filePath = path.join(projectPath, file);
              try {
                const stat = await fs.promises.stat(filePath);
                if (now - stat.mtimeMs > activeThresholdMs) return null;
                return {
                  filePath,
                  mtime: stat.mtimeMs,
                  fileName: file,
                  projectDir: projectDir.name,
                };
              } catch {
                return null;
              }
            })
          );
          return fileResults.filter(Boolean);
        } catch {
          return [];
        }
      })
    );

    for (const group of dirResults) {
      results.push(...group);
    }
  } catch { /* ignore */ }

  return results;
}

// ─── Adapter class ─────────────────────────────────────

class PiAdapter {
  get name() { return 'Pi Coding Agent'; }
  get provider() { return 'pi'; }
  get homeDir() { return PI_DIR; }

  isAvailable() {
    return fs.existsSync(SESSIONS_DIR);
  }

  async getActiveSessions(activeThresholdMs) {
    const sessionFiles = await scanAllSessionFiles(activeThresholdMs);
    const sessions = await Promise.all(sessionFiles.map(async ({ filePath, mtime, fileName, projectDir }) => {
      const detail = await parseSession(filePath);
      const projectPath = resolveProjectPath(detail, projectDir);

      return {
        sessionId: buildSessionId(projectDir, fileName),
        provider: 'pi',
        agentId: null,
        displayName: null,
        agentType: 'main',
        model: detail.model || 'unknown',
        status: 'active',
        lastActivity: mtime,
        project: projectPath,
        lastMessage: detail.lastMessage,
        lastTool: detail.lastTool,
        lastToolInput: detail.lastToolInput,
        parentSessionId: null,
        filePath,
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

    const sessionFiles = await scanAllSessionFiles(30 * 60 * 1000);
    const parsed = parseSessionId(sessionId);

    for (const { filePath, fileName, projectDir } of sessionFiles) {
      const fileId = fileName.replace('.jsonl', '');
      if (
        fileId === parsed.fileId
        && (!parsed.projectDir || parsed.projectDir === projectDir)
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

  getWatchPaths() {
    const paths = [];
    if (!fs.existsSync(SESSIONS_DIR)) return paths;

    try {
      paths.push({ type: 'directory', path: SESSIONS_DIR, recursive: true, filter: '.jsonl' });
    } catch { /* ignore */ }

    return paths;
  }
}

module.exports = { PiAdapter, parseSession, projectDirToPath, resolveProjectPath };