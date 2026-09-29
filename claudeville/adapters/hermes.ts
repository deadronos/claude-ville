/**
 * Hermes Agent adapter
 *
 * Current Hermes stores all sessions (CLI, TUI, gateway, cron) in SQLite:
 *   ~/.hermes/state.db
 *     - sessions : one row per session (id, source, model, cwd, origin_json, tokens, ...)
 *     - messages : ordered message log (role, content, tool_calls, tool_name, timestamp)
 *
 * Older installs wrote one JSON metadata file per session plus optional JSONL
 * transcripts to ~/.hermes/sessions/. `sessions.json` is only a legacy mirror
 * of the gateway routing index, not a session list. We keep the file readers as
 * a fallback for older installs and fixtures.
 *
 * Data source: HERMES_DIR or ~/.hermes/
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import type { AdapterSessionDetail, AgentAdapter, AgentSessionSummary, WatchPath } from '../../shared/types.js';
import { debugAdapterError, parseJsonLines, readLines } from './jsonl-utils.js';
import { hasTable, queryAll, safeJsonParse, withReadonlySqlite } from './sqlite-utils.js';

const HERMES_DIR = process.env.HERMES_DIR || path.join(os.homedir(), '.hermes');
const SESSIONS_DIR = path.join(HERMES_DIR, 'sessions');
const DB_PATH = path.join(HERMES_DIR, 'state.db');

type SessionFile = { filePath: string; sessionId: string; mtime: number };

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

async function getSessionFiles(activeThresholdMs: number): Promise<SessionFile[]> {
  if (!fs.existsSync(SESSIONS_DIR)) return [];
  const now = Date.now();
  try {
    const entries = await fs.promises.readdir(SESSIONS_DIR, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.startsWith('session_') && entry.name.endsWith('.json'))
      .map((entry) => path.join(SESSIONS_DIR, entry.name));
    const stats = await Promise.all(files.map(async (filePath) => {
      try {
        const stat = await fs.promises.stat(filePath);
        if (now - stat.mtimeMs > activeThresholdMs) return null;
        const sessionId = path.basename(filePath, '.json').replace(/^session_/, '');
        return { filePath, sessionId, mtime: stat.mtimeMs };
      } catch (err) {
        debugAdapterError('hermes', 'getSessionFiles stat', err, filePath);
        return null;
      }
    }));
    return stats.filter((result): result is SessionFile => result !== null);
  } catch (err) {
    debugAdapterError('hermes', 'getSessionFiles readdir', err, SESSIONS_DIR);
    return [];
  }
}

function transcriptPath(sessionId: string) {
  return path.join(SESSIONS_DIR, `${sessionId}.jsonl`);
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

// ─── SQLite (current Hermes) ──────────────────────────────

const DB_SESSIONS_SQL = `
  SELECT id, source, model, title, cwd, display_name, origin_json, billing_provider,
         input_tokens, output_tokens, estimated_cost_usd, message_count,
         started_at, last_activity_at, ended_at, parent_session_id
  FROM sessions
  WHERE COALESCE(archived, 0) = 0
    AND COALESCE(hidden, 0) = 0
    AND COALESCE(last_activity_at, started_at) >= ?
  ORDER BY COALESCE(last_activity_at, started_at) DESC
`;

const DB_MESSAGES_SQL = `
  SELECT role, content, tool_calls, tool_name, timestamp
  FROM messages
  WHERE session_id = ? AND COALESCE(active, 1) = 1
  ORDER BY timestamp DESC
  LIMIT ?
`;

function dbModelName(row: DbSessionRow): string {
  if (row.billing_provider && row.model) return `${row.billing_provider}/${row.model}`;
  return row.model || row.billing_provider || 'hermes';
}

function dbProjectName(row: DbSessionRow): string | null {
  const origin = safeJsonParse<any>(row.origin_json);
  if (origin?.platform && (origin.chat_name || origin.chat_id)) {
    return `${origin.platform}:${origin.chat_name || origin.chat_id}`;
  }
  if (row.cwd) return row.cwd;
  if (row.source) return row.source;
  return null;
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

async function getDbSessions(activeThresholdMs: number): Promise<AgentSessionSummary[]> {
  const thresholdSeconds = (Date.now() - activeThresholdMs) / 1000;

  const sessions = withReadonlySqlite(DB_PATH, 'hermes', (db) => {
    if (!hasTable(db, 'sessions')) return null;
    const rows = queryAll<DbSessionRow>(db, DB_SESSIONS_SQL, [thresholdSeconds]);

    return rows.map((row) => {
      const messageRows = queryAll<DbMessageRow>(db, DB_MESSAGES_SQL, [row.id, 120]);
      const detail = summarizeDbMessages(messageRows, 15);
      const updated = (row.last_activity_at ?? row.started_at ?? 0) * 1000;
      const input = Number(row.input_tokens || 0);
      const output = Number(row.output_tokens || 0);

      return {
        sessionId: `hermes-${row.id}`,
        provider: 'hermes',
        agentId: null,
        agentType: 'main',
        model: dbModelName(row),
        status: 'active',
        lastActivity: updated,
        project: dbProjectName(row),
        lastMessage: detail.lastMessage,
        lastTool: detail.lastTool,
        lastToolInput: detail.lastToolInput,
        parentSessionId: row.parent_session_id,
        filePath: DB_PATH,
        tokens: input || output ? { input, output } : undefined,
      } satisfies AgentSessionSummary;
    });
  });

  return sessions || [];
}

function readDbSessionDetail(rawId: string, sessionId: string): AdapterSessionDetail {
  const detail = withReadonlySqlite(DB_PATH, 'hermes', (db) => {
    if (!hasTable(db, 'messages')) return null;
    const rows = queryAll<DbMessageRow>(db, DB_MESSAGES_SQL, [rawId, 200]);
    const summary = summarizeDbMessages(rows, 200);

    let tokenUsage: AdapterSessionDetail['tokenUsage'] = null;
    if (hasTable(db, 'sessions')) {
      const sessionRow = queryAll<DbSessionRow>(
        db,
        `SELECT id, source, model, title, cwd, display_name, origin_json, billing_provider,
                input_tokens, output_tokens, estimated_cost_usd, message_count,
                started_at, last_activity_at, ended_at, parent_session_id
         FROM sessions WHERE id = ? LIMIT 1`,
        [rawId],
      )[0];
      if (sessionRow) tokenUsage = dbSessionTokenUsage(sessionRow);
    }

    return {
      // newest-first -> reverse back to chronological for display
      toolHistory: summary.toolHistory.slice(0, 15).reverse(),
      messages: summary.messages.slice(0, 5).reverse(),
      tokenUsage,
      sessionId,
    };
  });

  return detail || { toolHistory: [], messages: [] };
}

// ─── Adapter class ────────────────────────────────────────

export class HermesAdapter implements AgentAdapter {
  get name() { return 'Hermes Agent'; }
  get provider() { return 'hermes'; }
  get homeDir() { return HERMES_DIR; }

  isAvailable() {
    return fs.existsSync(HERMES_DIR);
  }

  async getActiveSessions(activeThresholdMs: number): Promise<AgentSessionSummary[]> {
    if (fs.existsSync(DB_PATH)) {
      const dbSessions = await getDbSessions(activeThresholdMs);
      if (dbSessions.length > 0) {
        return dbSessions.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0));
      }
    }

    const files = await getSessionFiles(activeThresholdMs);
    const sessions = await Promise.all(files.map(async ({ filePath, sessionId, mtime }) => {
      const metadata = await readJson(filePath);
      const transcript = transcriptPath(sessionId);
      const hasTranscript = fs.existsSync(transcript);
      const detail = hasTranscript
        ? await parseTranscript(transcript)
        : parseSessionMessages(metadata);
      const updated = asTimestamp(metadata?.last_updated ?? metadata?.updated_at ?? metadata?.session_start) || mtime;

      return {
        sessionId: `hermes-${metadata?.session_id || sessionId}`,
        provider: 'hermes',
        agentId: null,
        agentType: 'main',
        model: modelName(metadata),
        status: metadata?.suspended ? 'suspended' : 'active',
        lastActivity: Math.max(updated, mtime),
        project: projectName(metadata),
        lastMessage: detail.lastMessage,
        lastTool: detail.lastTool,
        lastToolInput: detail.lastToolInput,
        parentSessionId: null,
        filePath: hasTranscript ? transcript : filePath,
      } satisfies AgentSessionSummary;
    }));

    return sessions.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0));
  }

  async getSessionDetail(sessionId: string, project: string | null, filePath: string | null = null): Promise<AdapterSessionDetail> {
    if (filePath && filePath.endsWith('.jsonl')) {
      const detail = await parseTranscript(filePath);
      return { toolHistory: detail.toolHistory.slice(-15), messages: detail.messages.slice(-5), sessionId };
    }

    const cleanId = sessionId.replace(/^hermes-/, '');

    // SQLite-backed session (current Hermes)
    if (fs.existsSync(DB_PATH)) {
      const dbDetail = readDbSessionDetail(cleanId, sessionId);
      if (dbDetail.toolHistory.length || dbDetail.messages.length) return dbDetail;
    }

    const transcript = transcriptPath(cleanId);
    if (fs.existsSync(transcript)) {
      const detail = await parseTranscript(transcript);
      return { toolHistory: detail.toolHistory.slice(-15), messages: detail.messages.slice(-5), sessionId };
    }

    // Fall back to the session metadata JSON file which has a messages array
    const sessionFile = path.join(SESSIONS_DIR, `session_${cleanId}.json`);
    if (fs.existsSync(sessionFile)) {
      const metadata = await readJson(sessionFile);
      if (metadata?.messages) {
        const detail = parseSessionMessages(metadata);
        return { toolHistory: detail.toolHistory.slice(-15), messages: detail.messages.slice(-5), sessionId };
      }
    }

    return { toolHistory: [], messages: [] };
  }

  getWatchPaths(): WatchPath[] {
    const paths: WatchPath[] = [];
    if (fs.existsSync(DB_PATH)) {
      paths.push({ type: 'file', path: DB_PATH });
    }
    if (fs.existsSync(SESSIONS_DIR)) {
      paths.push({ type: 'directory', path: SESSIONS_DIR, recursive: false, filter: '.json' });
    }
    return paths;
  }
}
