/**
 * The format-specific readers for the OpenClaw adapter, split out of
 * `openclaw.ts` for file size. `openclaw.ts` stays the entry point and owns the
 * adapter class and the scan; the dependency is one-way.
 */
import { debugAdapterError, readLines, parseJsonLines } from './jsonl-utils.js';
import { decodeZstdText, queryAll, safeJsonParse } from './sqlite-utils.js';
import type { SqliteDb } from './sqlite-utils.js';
import { extractText } from './text-utils.js';
import type { AdapterSessionDetail } from '../../shared/types.js';

function toolBlockInfo(block: any): { name: string; input: unknown } | null {
  if (!block || typeof block !== 'object') return null;
  if (block.type === 'tool_use' || block.type === 'toolCall' || block.type === 'function_call' || block.name) {
    return {
      name: String(block.name || 'tool_use'),
      input: block.arguments ?? block.input ?? block.args,
    };
  }
  return null;
}

function normalizeTokenUsage(usage: any): AdapterSessionDetail['tokenUsage'] {
  if (!usage || typeof usage !== 'object') return null;
  const input = Number(usage.input ?? usage.promptTokens ?? usage.prompt_tokens ?? 0);
  const output = Number(usage.output ?? usage.completionTokens ?? usage.completion_tokens ?? 0);
  if (!input && !output) return null;
  return { input, output, totalInput: input, totalOutput: output };
}

// ─── Legacy JSONL session parsing ─────────────────────────

async function parseSession(filePath: string) {
  const detail = {
    model: null as string | null,
    provider: null as string | null,
    project: null as string | null,
    lastTool: null as string | null,
    lastToolInput: null as string | null,
    lastMessage: null as string | null,
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

      // Tool usage (tool call block in content)
      if (!detail.lastTool && msg.content && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          const info = toolBlockInfo(block);
          if (info) {
            detail.lastTool = info.name;
            if (info.input !== undefined) {
              detail.lastToolInput = (typeof info.input === 'string'
                ? info.input : JSON.stringify(info.input)
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

// ─── Legacy tool history / recent messages ────────────────

async function getToolHistory(filePath: string, maxItems = 15) {
  const tools: Array<{ tool: string; detail: string; ts: number }> = [];
  try {
    const lines = await readLines(filePath, { from: 'end', count: 100, scope: 'openclaw' });
    const entries = parseJsonLines(lines, 'openclaw');

    for (const entry of entries) {
      if (entry.type !== 'message' || !entry.message) continue;
      const msg = entry.message;
      if (!msg.content || !Array.isArray(msg.content)) continue;

      for (const block of msg.content) {
        const info = toolBlockInfo(block);
        if (!info) continue;
        let detail = '';
        if (info.input !== undefined) {
          detail = (typeof info.input === 'string'
            ? info.input : JSON.stringify(info.input)
          ).substring(0, 80);
        }
        tools.push({
          tool: info.name,
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

async function getRecentMessages(filePath: string, maxItems = 5) {
  const messages: Array<{ role: string; text: string; ts: number }> = [];
  try {
    const lines = await readLines(filePath, { from: 'end', count: 60, scope: 'openclaw' });
    const entries = parseJsonLines(lines, 'openclaw');

    for (const entry of entries) {
      if (entry.type !== 'message' || !entry.message) continue;
      const msg = entry.message;
      if (!msg.content) continue;
      if (msg.role === 'tool' || msg.role === 'toolResult') continue;

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

// ─── SQLite transcript reading ────────────────────────────

function decodeEventRows(rows: Array<{ event_json: string | null; event_zstd: Buffer | null }>): any[] {
  const entries: any[] = [];
  for (const row of rows) {
    const json = row.event_json ?? decodeZstdText(row.event_zstd);
    if (!json) continue;
    const entry = safeJsonParse<any>(json);
    if (entry) entries.push(entry);
  }
  return entries;
}

type DbDetail = {
  model: string | null;
  provider: string | null;
  project: string | null;
  lastTool: string | null;
  lastToolInput: string | null;
  lastMessage: string | null;
  tokenUsage: AdapterSessionDetail['tokenUsage'];
};

function emptyDetail(): DbDetail {
  return { model: null, provider: null, project: null, lastTool: null, lastToolInput: null, lastMessage: null, tokenUsage: null };
}

/**
 * Fill detail fields from an ordered (newest-first) list of transcript events.
 */
function applyEventsToDetail(entries: any[], detail: DbDetail) {
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;

    if (!detail.project && entry.type === 'session' && entry.cwd) {
      detail.project = entry.cwd;
    }
    if (!detail.model && entry.type === 'model_change') {
      detail.model = entry.modelId || null;
      detail.provider = entry.provider || null;
    }

    if (entry.type === 'message' && entry.message) {
      const msg = entry.message;
      if (!detail.model && msg.model) detail.model = msg.model;
      if (!detail.provider && msg.provider) detail.provider = msg.provider;
      if (!detail.tokenUsage) detail.tokenUsage = normalizeTokenUsage(msg.usage);

      const role = msg.role || 'assistant';
      if (!detail.lastMessage && role !== 'tool' && role !== 'toolResult' && msg.content) {
        const text = extractText(msg.content);
        if (text) detail.lastMessage = text.substring(0, 80);
      }

      if (!detail.lastTool && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          const info = toolBlockInfo(block);
          if (!info) continue;
          detail.lastTool = info.name;
          if (info.input !== undefined) {
            detail.lastToolInput = (typeof info.input === 'string'
              ? info.input : JSON.stringify(info.input)
            ).substring(0, 60);
          }
          break;
        }
      }
    }

    if (detail.lastMessage && detail.lastTool && detail.model) break;
  }
}

function readDbDetail(db: SqliteDb, sessionId: string, limit = 60): DbDetail {
  const rows = queryAll<{ event_json: string | null; event_zstd: Buffer | null }>(
    db,
    'SELECT event_json, event_zstd FROM transcript_events WHERE session_id = ? ORDER BY seq DESC LIMIT ?',
    [sessionId, limit],
  );
  const detail = emptyDetail();
  applyEventsToDetail(decodeEventRows(rows), detail);
  return detail;
}

export { toolBlockInfo, normalizeTokenUsage, decodeEventRows, parseSession, getToolHistory, getRecentMessages, readDbDetail };
