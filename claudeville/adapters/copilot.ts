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
import fs from 'fs';
import path from 'path';
import os from 'os';

import type { AdapterDetailResult, AdapterSessionsResult, AgentAdapter, WatchPath } from '../../shared/types.js';
import { debugAdapterError, readLines, parseJsonLines, collectJsonl } from './jsonl-utils.js';
import { collectScanByMtime } from './scan-utils.js';
import { combineSources, detailFailed, detailOk, emptyDetail, sourceDetail } from './sources.js';
import { summarizeToolInput } from './sanitize.js';
import { extractText } from './text-utils.js';

const COPILOT_DIR = path.join(os.homedir(), '.copilot');
const SESSION_STATE_DIR = path.join(COPILOT_DIR, 'session-state');

// ─── Utility ─────────────────────────────────────────────

// ─── Session parsing ──────────────────────────────────────

async function parseSession(filePath: string) {
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

  // Extract metadata from session.start (first 50 lines covers most cases; model isn't always in first few lines)
  const firstLines = await readLines(filePath, { from: 'start', count: 50, scope: 'copilot' });
  const firstEntries = parseJsonLines(firstLines, 'copilot');
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
  const lastLines = await readLines(filePath, { from: 'end', count: 80, scope: 'copilot' });
  const entries = parseJsonLines(lastLines, 'copilot');

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
            detail.lastToolInput = summarizeToolInput(tc.input, 60);
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
        detail.lastToolInput = summarizeToolInput(tc.input, 60);
      }
    }
  }

  return detail;
}

// ─── Tool history ────────────────────────────────────

async function getToolHistory(filePath: string, maxItems = 15) {
  return collectJsonl<{ tool: string; detail: string; ts: number }>(filePath, {
    scope: 'copilot',
    operation: 'getToolHistory',
    count: 100,
    maxItems,
    onEntry: (entry, out) => {
      let toolName = null;
      let toolInput = null;
      let ts = 0;

      if (entry.type === 'assistant.message' && entry.data) {
        const msg = entry.data;
        if (msg.toolCalls && Array.isArray(msg.toolCalls)) {
          for (const tc of msg.toolCalls) {
            toolName = tc.name || 'tool_call';
            toolInput = tc.input ? summarizeToolInput(tc.input, 80) : '';
            ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
            break;
          }
        }
      }

      if (!toolName && entry.type === 'tool_call' && entry.data) {
        toolName = entry.data.name || 'tool_call';
        toolInput = entry.data.input ? summarizeToolInput(entry.data.input, 80) : '';
        ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
      }

      if (toolName) {
        out.push({ tool: toolName, detail: toolInput || '', ts });
      }
    },
  });
}

// ─── Recent messages ──────────────────────────────────────

async function getRecentMessages(filePath: string, maxItems = 5) {
  return collectJsonl<{ role: string; text: string; ts: number }>(filePath, {
    scope: 'copilot',
    operation: 'getRecentMessages',
    count: 60,
    maxItems,
    onEntry: (entry, out) => {
      if (entry.type !== 'user.message' && entry.type !== 'assistant.message') return;
      if (!entry.data || !entry.data.content) return;

      const text = extractText(entry.data.content);
      if (!text) return;

      out.push({
        role: entry.type === 'user.message' ? 'user' : 'assistant',
        text: text.substring(0, 200),
        ts: entry.timestamp ? new Date(entry.timestamp).getTime() : 0,
      });
    },
  });
}

// ─── Token usage ────────────────────────────────────────────

// Copilot only reports token totals in the terminal `session.shutdown` event,
// so live sessions legitimately return null.
async function getTokenUsage(filePath: string): Promise<{ input: number; output: number } | null> {
  try {
    const lines = await readLines(filePath, { from: 'end', count: 80, scope: 'copilot' });
    const entries = parseJsonLines(lines, 'copilot');
    let input = 0;
    let output = 0;
    let found = false;
    for (const entry of entries) {
      if (entry.type !== 'session.shutdown' || !entry.data?.modelMetrics) continue;
      for (const metric of Object.values(entry.data.modelMetrics) as any[]) {
        const usage = metric?.usage;
        if (!usage) continue;
        input += Number(usage.inputTokens || 0);
        output += Number(usage.outputTokens || 0);
        found = true;
      }
    }
    return found ? { input, output } : null;
  } catch (err) {
    debugAdapterError('copilot', 'getTokenUsage', err, filePath);
    return null;
  }
}

// ─── Session scan ────────────────────────────────────────

/**
 * The scan, plus whether its ROOT could be listed.
 *
 * The two answers used to be the same empty array, which is why an install whose
 * `session-state/` cannot be enumerated read exactly like an install with no
 * copilot sessions. `collectScanByMtime` reports the root failure through
 * `onRootUnreadable` rather than through a changed return type, so `getSessionDetail`
 * — which scans the same directory and wants only the records — is untouched.
 *
 * `fileFor` is `existsSync`-free by design: copilot's layout is
 * `session-state/{uuid}/events.jsonl`, so there is no per-child enumeration that
 * could fail. A missing or unstattable candidate is a per-ITEM loss contained by
 * `collectScanByMtime`'s own `stat` catch, and copilot has no cheap signal for it,
 * so it stays un-reported (audit instance 22 rated `getTokenUsage` the same way:
 * per-row tolerant by construction).
 */
async function scanAllSessions(activeThresholdMs: number): Promise<{ records: CopilotScanRecord[]; rootUnreadable: boolean }> {
  let rootUnreadable = false;
  const records = await collectScanByMtime<CopilotScanRecord>({
    dir: SESSION_STATE_DIR,
    scope: 'copilot',
    operation: 'scanAllSessions',
    thresholdMs: activeThresholdMs,
    fileFor: (name) => path.join(SESSION_STATE_DIR, name, 'events.jsonl'),
    build: ({ name, filePath, mtimeMs }) => ({ filePath, mtime: mtimeMs, sessionId: name }),
    onUnreadable: (scope, err, dir) => {
      // Copilot's `fileFor` never enumerates a child, so only the root can fail.
      if (scope !== 'root') return;
      rootUnreadable = true;
      debugAdapterError('copilot', 'scanAllSessions root', err, dir);
    },
  });
  return { records, rootUnreadable };
}

type CopilotScanRecord = { filePath: string; mtime: number; sessionId: string };

// ─── Adapter class ─────────────────────────────────────

export class CopilotAdapter implements AgentAdapter {
  get name() { return 'GitHub Copilot'; }
  get provider() { return 'copilot'; }
  get homeDir() { return COPILOT_DIR; }

  isAvailable() {
    return fs.existsSync(SESSION_STATE_DIR);
  }

  async getActiveSessions(activeThresholdMs: number): Promise<AdapterSessionsResult> {
    const { records, rootUnreadable } = await scanAllSessions(activeThresholdMs);

    const sessions = await Promise.all(records.map(async ({ filePath, mtime, sessionId }) => {
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

    // Copilot has ONE source, so the classification is the trivial case of the
    // shared rule: a root that could not be listed is `ok: false` (there is no
    // second half to fall back to, and an empty listing would be a lie), and a
    // root that answered is `ok: true` even with zero sessions. `absent` is kept
    // distinct from `rows` so an install with no `session-state/` at all does not
    // report a failure it does not have.
    return combineSources([
      rootUnreadable
        ? { kind: 'failed', code: 'root-unreadable', detail: sourceDetail('session-state directory could not be listed', COPILOT_DIR) }
        : fs.existsSync(SESSION_STATE_DIR)
          ? { kind: 'rows', sessions, warnings: [] }
          : { kind: 'absent' },
    ]);
  }

  async getSessionDetail(sessionId: string, project: string | null, filePath: string | null = null): Promise<AdapterDetailResult> {
    if (filePath) {
      const [toolHistory, messages, tokenUsage] = await Promise.all([
        getToolHistory(filePath),
        getRecentMessages(filePath),
        getTokenUsage(filePath),
      ]);
      return detailOk({ toolHistory, messages, tokenUsage, sessionId });
    }

    const cleanId = sessionId.replace('copilot-', '');
    const { records, rootUnreadable } = await scanAllSessions(30 * 60 * 1000);

    // Copilot's `fileFor` never enumerates a child, so the root is the only thing
    // the scan can lose — and losing it means the lookup cannot say whether this
    // session exists. Same code and same message the listing uses for it.
    if (rootUnreadable) {
      return detailFailed('root-unreadable', sourceDetail('session-state directory could not be listed', COPILOT_DIR));
    }

    const found = records.find(s => s.sessionId === cleanId);
    if (found) {
      const [toolHistory, messages, tokenUsage] = await Promise.all([
        getToolHistory(found.filePath),
        getRecentMessages(found.filePath),
        getTokenUsage(found.filePath),
      ]);
      return detailOk({ toolHistory, messages, tokenUsage, sessionId });
    }

    return detailOk(emptyDetail());
  }

  getWatchPaths(): WatchPath[] {
    if (fs.existsSync(SESSION_STATE_DIR)) {
      return [{ type: 'directory', path: SESSION_STATE_DIR, recursive: true, filter: 'events.jsonl' }];
    }
    return [];
  }
}
