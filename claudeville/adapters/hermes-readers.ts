/**
 * The format-specific readers for the Hermes Agent adapter, split out of
 * `hermes.ts` for file size. `hermes.ts` stays the entry point and owns the
 * adapter class and the scan; the dependency is one-way.
 */
import fs from 'fs';

import type { AdapterSessionDetail } from '../../shared/types.js';
import { debugAdapterError, parseJsonLines, readLines } from './jsonl-utils.js';
import { safeJsonParse } from './sqlite-utils.js';

// ─── SQLite message reading ───────────────────────────────

type DbSessionRow = {
  id: string;
  source: string | null;
  model: string | null;
  title: string | null;
  cwd: string | null;
  display_name: string | null;
  origin_json: string | null;
  billing_provider: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  message_count: number | null;
  started_at: number | null;
  last_activity_at: number | null;
  ended_at: number | null;
  parent_session_id: string | null;
};

type DbMessageRow = {
  role: string | null;
  content: string | null;
  tool_calls: string | null;
  tool_name: string | null;
  timestamp: number | null;
};

async function readJson(filePath: string): Promise<any | null> {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, 'utf-8'));
  } catch (err) {
    debugAdapterError('hermes', 'readJson', err, filePath);
    return null;
  }
}

function asTimestamp(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

/**
 * Extract tool name from a Hermes entry, handling both:
 * - assistant entries with tool_calls array (e.g. tool_calls[0].function.name)
 * - tool entries with name/tool/tool_name fields
 */
function extractToolName(entry: any): string | null {
  // Check nested tool_calls first (Hermes assistant entries)
  const toolCalls = entry.tool_calls;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    const firstCall = toolCalls[0];
    if (firstCall?.function?.name) return firstCall.function.name;
    if (firstCall?.name) return firstCall.name;
    // Some providers use { id, type, function: { name, arguments } }
  }
  // Top-level fields
  return entry.name || entry.tool || entry.tool_name || null;
}

function summarizeTool(entry: any): { tool: string; detail: string; ts: number } | null {
  if (!entry || typeof entry !== 'object') return null;
  const role = entry.role || entry.type;
  const name = extractToolName(entry);
  if (role !== 'tool' && !name && role !== 'tool_call') return null;

  let detail = '';
  const content = entry.content ?? entry.input ?? entry.arguments;
  if (typeof content === 'string') detail = content;
  else if (content?.command) detail = String(content.command);
  else if (content) detail = JSON.stringify(content);

  return {
    tool: String(name || role || 'tool'),
    detail: detail.substring(0, 80),
    ts: asTimestamp(entry.timestamp ?? entry.created_at ?? entry.createdAt),
  };
}

function summarizeMessage(entry: any): { role: string; text: string; ts: number } | null {
  if (!entry || typeof entry !== 'object') return null;
  const role = entry.role || entry.type;
  if (role === 'tool' || role === 'tool_call') return null;

  const content = entry.content ?? entry.text ?? entry.message?.content;
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.find((part: any) => part?.type === 'text' && part.text)?.text
      : null;
  if (!text || text.trim().length === 0) return null;

  return {
    role: role || 'assistant',
    text: text.trim().substring(0, 200),
    ts: asTimestamp(entry.timestamp ?? entry.created_at ?? entry.createdAt),
  };
}

async function parseTranscript(filePath: string): Promise<AdapterSessionDetail & {
  lastTool: string | null;
  lastToolInput: string | null;
  lastMessage: string | null;
}> {
  const lines = await readLines(filePath, { count: 120, scope: 'hermes' });
  const entries = parseJsonLines(lines, 'hermes');
  const toolHistory: Array<{ tool: string; detail: string; ts: number }> = [];
  const messages: Array<{ role: string; text: string; ts: number }> = [];

  for (const entry of entries) {
    const tool = summarizeTool(entry);
    if (tool) {
      toolHistory.push(tool);
      continue;
    }
    const message = summarizeMessage(entry);
    if (message) messages.push(message);
  }

  const lastTool = toolHistory.at(-1) || null;
  const lastMessage = [...messages].reverse().find((message) => message.role === 'assistant') || messages.at(-1) || null;

  return {
    toolHistory,
    messages,
    lastTool: lastTool?.tool || null,
    lastToolInput: lastTool?.detail || null,
    lastMessage: lastMessage?.text?.substring(0, 80) || null,
  };
}

/**
 * Parse tool history and messages from a session metadata JSON file.
 * This handles sessions that only have session_*.json (no .jsonl transcript).
 */
function parseSessionMessages(metadata: any): {
  toolHistory: Array<{ tool: string; detail: string; ts: number }>;
  messages: Array<{ role: string; text: string; ts: number }>;
  lastTool: string | null;
  lastToolInput: string | null;
  lastMessage: string | null;
} {
  const rawMessages: any[] = metadata?.messages ?? [];
  const toolHistory: Array<{ tool: string; detail: string; ts: number }> = [];
  const messages: Array<{ role: string; text: string; ts: number }> = [];

  for (const entry of rawMessages) {
    // Extract tool calls from assistant entries with tool_calls array
    const toolCalls = entry.tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        const fn = tc?.function;
        if (fn?.name) {
          let detail = '';
          const args = typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? '');
          try {
            const parsed = JSON.parse(args);
            detail = parsed.command || parsed.query || parsed.filePath || parsed.path || parsed.prompt || parsed.description || '';
          } catch {
            detail = args;
          }
          toolHistory.push({
            tool: String(fn.name),
            detail: detail.substring(0, 80),
            ts: asTimestamp(entry.timestamp ?? entry.created_at ?? entry.createdAt),
          });
        }
      }
    }

    // Summarize messages (skip tool role entries)
    const role = entry.role || entry.type;
    if (role === 'tool' || role === 'tool_call') continue;

    const content = entry.content ?? entry.text;
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.find((part: any) => part?.type === 'text' && part.text)?.text
        : null;
    if (text && text.trim().length > 0) {
      messages.push({
        role: role || 'assistant',
        text: text.trim().substring(0, 200),
        ts: asTimestamp(entry.timestamp ?? entry.created_at ?? entry.createdAt),
      });
    }
  }

  const lastTool = toolHistory.at(-1) || null;
  const lastMessage = [...messages].reverse().find((m) => m.role === 'assistant') || messages.at(-1) || null;

  return {
    toolHistory,
    messages,
    lastTool: lastTool?.tool || null,
    lastToolInput: lastTool?.detail || null,
    lastMessage: lastMessage?.text?.substring(0, 80) || null,
  };
}
function modelName(metadata: any) {
  if (metadata?.provider && metadata?.model) return `${metadata.provider}/${metadata.model}`;
  return metadata?.model || 'hermes';
}

function projectName(metadata: any) {
  const origin = metadata?.origin;
  if (origin?.platform && (origin.chat_name || origin.chat_id)) return `${origin.platform}:${origin.chat_name || origin.chat_id}`;
  if (metadata?.platform && metadata?.display_name) return `${metadata.platform}:${metadata.display_name}`;
  if (metadata?.cwd) return metadata.cwd;
  return metadata?.platform || null;
}
function dbRowToEntry(row: DbMessageRow): any {
  return {
    role: row.role || undefined,
    content: row.content ?? undefined,
    tool_calls: safeJsonParse(row.tool_calls) ?? undefined,
    name: row.tool_name || undefined,
    timestamp: row.timestamp ?? undefined,
  };
}

function summarizeDbMessages(rows: DbMessageRow[], limit: number) {
  // rows are newest-first; aggregate newest-first then trim
  const toolHistory: Array<{ tool: string; detail: string; ts: number }> = [];
  const messages: Array<{ role: string; text: string; ts: number }> = [];

  for (const row of rows) {
    const entry = dbRowToEntry(row);
    const tool = summarizeTool(entry);
    if (tool) {
      toolHistory.push(tool);
      continue;
    }
    const message = summarizeMessage(entry);
    if (message) messages.push(message);
  }

  const lastTool = toolHistory[0] || null;
  const lastMessage = messages.find((message) => message.role === 'assistant') || messages[0] || null;

  return {
    toolHistory: toolHistory.slice(0, limit),
    messages: messages.slice(0, limit),
    lastTool: lastTool?.tool || null,
    lastToolInput: lastTool?.detail || null,
    lastMessage: lastMessage?.text?.substring(0, 80) || null,
  };
}

function dbSessionTokenUsage(row: DbSessionRow): AdapterSessionDetail['tokenUsage'] {
  const input = Number(row.input_tokens || 0);
  const output = Number(row.output_tokens || 0);
  if (!input && !output) return null;
  return { input, output, totalInput: input, totalOutput: output };
}
export type { DbSessionRow, DbMessageRow };
export { readJson, asTimestamp, parseTranscript, parseSessionMessages, modelName, projectName, summarizeDbMessages, dbSessionTokenUsage };
