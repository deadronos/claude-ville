/**
 * The format-specific readers for the OpenCode CLI adapter, split out of
 * `opencode.ts` for file size. `opencode.ts` stays the entry point and owns the
 * adapter class and the scan; the dependency is one-way.
 */
import fs from 'fs';

import type { AdapterSessionDetail } from '../../shared/types.js';
import { debugAdapterError } from './jsonl-utils.js';

type DbMessage = {
  id: string;
  role: string;
  modelID?: string | null;
  providerID?: string | null;
  time_created: number;
  data: any;
  parts: Array<{ id: string; time_created: number; data: any }>;
};

/**
 * The per-session message read for the v1 `message`/`part` store.
 *
 * `queryDb` answers `[]` for "this session has no messages" and for "the query
 * raised" alike, which cost this one session its whole detail. That swallow is
 * load-bearing containment — the call sits inside a `.map()`, so a throw would
 * abort the map and take EVERY session with it (#156) — so it stays, and the
 * difference is reported instead of collapsed. Same shape as `hermes`'s
 * `readSessionMessages`, and for the same reason.
 */
type DbMessageRow = {
  message_id: string;
  message_time_created: number;
  message_data: string;
  part_id: string | null;
  part_time_created: number | null;
  part_data: string | null;
};

/**
 * The one v1 message query, for both readers. It is a FUNCTION because the
 * `LIMIT ?` differs between them — 30 for the listing's summary, 60 for the
 * detail — and two copies of this literal are two copies of a query that #156
 * already had to be reasoned about carefully.
 */
function dbMessagesSql(limit: number): string {
  return `SELECT
       recent.id AS message_id,
       recent.time_created AS message_time_created,
       recent.data AS message_data,
       p.id AS part_id,
       p.time_created AS part_time_created,
       p.data AS part_data
     FROM (
       SELECT id, time_created, data
       FROM message
       WHERE session_id = ?
       ORDER BY time_created DESC
       LIMIT ${limit}
     ) recent
     LEFT JOIN part p ON p.message_id = recent.id
     ORDER BY recent.time_created ASC, p.time_created ASC`;
}

/** The v1 rows to messages, shared by both readers so the per-row tolerance cannot drift. */
function buildDbMessages(rows: DbMessageRow[]): { messages: DbMessage[]; degraded: boolean } {
  const messageMap = new Map<string, DbMessage>();
  // A `message.data` or `part.data` column that does not parse arrives as its raw
  // string. That is audit instance 1's condition and #156's fix: the bad ROW
  // degrades, the listing does not. It is counted, not thrown.
  let unparsedRows = 0;
  for (const row of rows) {
    let message = messageMap.get(row.message_id);
    if (!message) {
      const messageData = normalizeDbJson(row.message_data) as any;
      if (typeof messageData === 'string') unparsedRows += 1;
      message = {
        id: row.message_id,
        role: messageData?.role || 'assistant',
        modelID: messageData?.modelID || null,
        providerID: messageData?.providerID || null,
        time_created: row.message_time_created,
        data: messageData,
        parts: [],
      };
      messageMap.set(row.message_id, message);
    }

    if (row.part_id && row.part_data) {
      if (typeof normalizeDbJson(row.part_data) === 'string') unparsedRows += 1;
      message.parts.push({
        id: row.part_id,
        time_created: row.part_time_created || row.message_time_created,
        data: normalizeDbJson(row.part_data),
      });
    }
  }

  return { messages: Array.from(messageMap.values()), degraded: unparsedRows > 0 };
}

/** A raw `session_message` row, as selected by {@link v2MessagesSql}. */
type V2MessageRow = {
  id: string;
  type: string;
  time_created: number;
  data: string;
};

/** A raw `session_v2` row, as selected by {@link DB_SESSIONS_V2_SQL}. */
type DbSessionV2 = {
  id: string;
  project_id: string;
  parent_id: string | null;
  directory: string;
  title: string;
  time_created: number;
  time_updated: number;
  model: string | null;
  tokens_input: number;
  tokens_output: number;
};

/**
 * `session_v2.model` and an assistant row's `data.model` are the same
 * `{ id, providerID, variant }` shape — a JSON string on the session column, an
 * object on the message. Both keys of the pair are answered even when the value is
 * absent, so a caller can compose `provider/model` without a null check.
 */
function normalizeV2Model(value: unknown): { modelID: string | null; providerID: string | null } {
  const model = normalizeDbJson(value) as {
    id?: unknown;
    modelID?: unknown;
    modelId?: unknown;
    providerID?: unknown;
    providerId?: unknown;
  } | null;
  if (typeof model !== 'object' || model === null) return { modelID: null, providerID: null };
  const modelID = model.modelID || model.modelId || model.id;
  const providerID = model.providerID || model.providerId;
  return {
    modelID: typeof modelID === 'string' ? modelID : null,
    providerID: typeof providerID === 'string' ? providerID : null,
  };
}

/**
 * The v2 rows to messages. Same per-row tolerance as {@link buildDbMessages}: a
 * `session_message.data` that will not parse arrives as its raw string, degrades
 * only its own row, and is counted rather than thrown (#156).
 *
 * The two stores disagree on where content lives — v1 splits it into the `part`
 * table, v2 inlines `data.content[]` — so the assistant path fans that array into
 * parts and the `user`/`system`/`synthetic` path wraps `data.text` in a single text
 * part. `reasoning` items are dropped: they are model scratch, not the assistant's
 * answer, and `extractDetail` would otherwise surface them as messages.
 */
function buildV2Messages(rows: V2MessageRow[]): { messages: DbMessage[]; degraded: boolean } {
  let unparsedRows = 0;
  const messages: DbMessage[] = [];

  for (const row of rows) {
    const data = normalizeDbJson(row.data) as any;
    if (typeof data === 'string') unparsedRows += 1;

    const parts: DbMessage['parts'] = [];
    let hasContentParts = false;
    if (Array.isArray(data?.content)) {
      data.content.forEach((item: any, index: number) => {
        // Tool detection is `toolFromPart`'s job — it already tolerates
        // `tool-call` / `tool_use` beside v2's `tool`, so the shaper must not
        // narrow it to one literal. Text stays `type === 'text'`, which is what
        // drops `reasoning`.
        if (item?.type !== 'text' && !toolFromPart(item)) return;
        hasContentParts = true;
        parts.push({ id: item.id || `${row.id}:${index}`, time_created: row.time_created, data: item });
      });
    }
    if (!hasContentParts && typeof data?.text === 'string') {
      parts.push({ id: `${row.id}:text`, time_created: row.time_created, data: { type: 'text', text: data.text } });
    }

    const { modelID, providerID } = normalizeV2Model(data?.model);
    messages.push({
      id: row.id,
      role: row.type || 'assistant',
      modelID,
      providerID,
      time_created: row.time_created,
      data,
      parts,
    });
  }

  return { messages, degraded: unparsedRows > 0 };
}

async function readJson(filePath: string): Promise<any | null> {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, 'utf-8'));
  } catch (err) {
    debugAdapterError('opencode', 'readJson', err, filePath);
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

function textFromPart(part: any): string | null {
  if (!part) return null;
  if (typeof part === 'string') return part;
  if (typeof part.text === 'string') return part.text;
  if (typeof part.content === 'string') return part.content;
  return null;
}

function toolFromPart(part: any): { tool: string; detail: string } | null {
  if (!part || typeof part !== 'object') return null;
  const type = part.type || part.kind;
  const tool = part.tool || part.name || part.toolName;
  if (!tool && type !== 'tool-call' && type !== 'tool_use') return null;

  const input = part.input ?? part.args ?? part.arguments ?? part.state?.input;
  let detail = '';
  if (typeof input === 'string') detail = input;
  else if (input?.command) detail = String(input.command);
  else if (input?.filePath) detail = String(input.filePath);
  else if (input?.file_path) detail = String(input.file_path);
  else if (input) detail = JSON.stringify(input);

  return { tool: String(tool || type || 'tool'), detail: detail.substring(0, 80) };
}

function dbToolFromPart(part: any): { tool: string; detail: string } | null {
  return toolFromPart(part);
}

function normalizeMessages(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.messages)) return raw.messages;
  if (Array.isArray(raw?.items)) return raw.items;
  return [];
}

function extractMessageTs(message: any): number {
  return asTimestamp(message?.time?.created ?? message?.time?.updated ?? message?.created ?? message?.createdAt ?? message?.timestamp);
}

function normalizeDbJson(value: unknown) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function addTokens(
  acc: { input: number; output: number },
  tokens: any,
): void {
  if (!tokens || typeof tokens !== 'object') return;
  acc.input += Number(tokens.input || 0);
  acc.output += Number(tokens.output || 0);
}

function normalizeModel(value: unknown, provider: unknown = null): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const model = value as { modelID?: unknown; modelId?: unknown; id?: unknown; providerID?: unknown; providerId?: unknown };
    const modelId = model.modelID || model.modelId || model.id;
    const providerId = model.providerID || model.providerId || provider;
    if (typeof modelId === 'string' && typeof providerId === 'string') return `${providerId}/${modelId}`;
    if (typeof modelId === 'string') return modelId;
  }
  return null;
}

function extractDetail(messages: any[]): AdapterSessionDetail & {
  model: string | null;
  lastTool: string | null;
  lastToolInput: string | null;
  lastMessage: string | null;
  tokenUsage: { input: number; output: number } | null;
} {
  const detail = {
    toolHistory: [] as Array<{ tool: string; detail: string; ts: number }>,
    messages: [] as Array<{ role: string; text: string; ts: number }>,
    model: null as string | null,
    lastTool: null as string | null,
    lastToolInput: null as string | null,
    lastMessage: null as string | null,
    tokenUsage: { input: 0, output: 0 },
  };

  for (const message of messages) {
    const ts = extractMessageTs(message);
    const role = message.role || message.type || 'assistant';
    if (!detail.model && (message.modelID || message.model || message.modelId)) {
      detail.model = message.modelID || message.model || message.modelId;
    }
    addTokens(detail.tokenUsage, message.tokens);

    const parts = Array.isArray(message.parts)
      ? message.parts
      : Array.isArray(message.content)
        ? message.content
        : [{ text: message.content ?? message.text }];

    for (const part of parts) {
      const tool = toolFromPart(part);
      if (tool) {
        detail.toolHistory.push({ ...tool, ts });
        detail.lastTool = tool.tool;
        detail.lastToolInput = tool.detail;
        continue;
      }

      const text = textFromPart(part);
      if (!text || text.trim().length === 0) continue;
      const trimmed = text.trim();
      detail.messages.push({ role, text: trimmed.substring(0, 200), ts });
      if (role === 'assistant') detail.lastMessage = trimmed.substring(0, 80);
    }
  }

  return {
    ...detail,
    tokenUsage: detail.tokenUsage.input || detail.tokenUsage.output ? detail.tokenUsage : null,
  };
}
function extractDbDetail(messages: DbMessage[]): AdapterSessionDetail & {
  model: string | null;
  lastTool: string | null;
  lastToolInput: string | null;
  lastMessage: string | null;
  tokenUsage: { input: number; output: number } | null;
} {
  const detail = {
    toolHistory: [] as Array<{ tool: string; detail: string; ts: number }>,
    messages: [] as Array<{ role: string; text: string; ts: number }>,
    model: null as string | null,
    lastTool: null as string | null,
    lastToolInput: null as string | null,
    lastMessage: null as string | null,
    tokenUsage: { input: 0, output: 0 },
  };

  for (const message of messages) {
    const messageData = normalizeDbJson(message.data) as any;
    const role = messageData?.role || message.role || 'assistant';
    if (!detail.model && (messageData?.modelID || messageData?.model || message.modelID)) {
      detail.model = normalizeModel(messageData?.modelID || messageData?.model || message.modelID, messageData?.providerID || message.providerID);
    }
    addTokens(detail.tokenUsage, messageData?.tokens);

    for (const part of message.parts) {
      const partData = normalizeDbJson(part.data) as any;
      const tool = dbToolFromPart(partData);
      if (tool) {
        detail.toolHistory.push({ ...tool, ts: part.time_created || message.time_created });
        detail.lastTool = tool.tool;
        detail.lastToolInput = tool.detail;
        continue;
      }

      const text = textFromPart(partData);
      if (!text || text.trim().length === 0) continue;
      const trimmed = text.trim();
      detail.messages.push({ role, text: trimmed.substring(0, 200), ts: part.time_created || message.time_created });
      if (role === 'assistant') detail.lastMessage = trimmed.substring(0, 80);
    }
  }

  return {
    ...detail,
    tokenUsage: detail.tokenUsage.input || detail.tokenUsage.output ? detail.tokenUsage : null,
  };
}
function projectFromSession(session: any, projectKey: string): string | null {
  return session?.project?.path || session?.cwd || session?.path || session?.directory || projectKey || null;
}

/**
 * The v1 session query, as a named constant so the classified reader can hand
 * it straight to `db.prepare`.
 *
 * Deliberately NOT projected from `tableColumns`, unlike `hermes`'s and
 * `openclaw`'s: here a drifted schema made SQLite raise `no such column`, and the
 * pre-contract behaviour of that raise was `[]` and then the legacy-file fallback.
 * Projecting would replace that fallback with a partial listing — a better answer,
 * but a behaviour change this refactor must not make. So the raise is classified
 * (`unknown`) and the fallback still runs.
 */
const DB_SESSIONS_SQL = `
  SELECT
    s.id,
    s.project_id,
    s.parent_id,
    s.directory,
    s.title,
    s.time_created,
    s.time_updated,
    (
      SELECT m.data
      FROM message m
      WHERE m.session_id = s.id
      ORDER BY m.time_created DESC
      LIMIT 1
    ) AS message_data
  FROM session s
  WHERE s.time_updated >= ?
    AND s.time_archived IS NULL
  ORDER BY s.time_updated DESC`;

/**
 * The v2 message query. `ORDER BY seq DESC LIMIT ?` takes the most recent N by
 * OpenCode's own monotonic per-session counter — not by `time_created`, which can
 * tie — matching the v1 query's "latest N" intent. The caller reverses to
 * chronological order (`extractDetail` walks forward).
 */
function v2MessagesSql(limit: number): string {
  return `SELECT
       id,
       type,
       time_created,
       data
     FROM session_message
     WHERE session_id = ?
     ORDER BY seq DESC
     LIMIT ${limit}`;
}

/** The session-level v2 token totals; v2 rows carry no per-message `tokens`. */
function v2TokensSql(): string {
  return `SELECT tokens_input, tokens_output FROM session_v2 WHERE id = ?`;
}

/**
 * The v2 session query. Unlike v1, `session_v2` carries `model` and the token
 * totals as first-class columns, so no per-session message subquery is needed for
 * the listing's model fallback.
 */
const DB_SESSIONS_V2_SQL = `
  SELECT
    id,
    project_id,
    parent_id,
    directory,
    title,
    time_created,
    time_updated,
    model,
    tokens_input,
    tokens_output
  FROM session_v2
  WHERE time_updated >= ?
    AND time_archived IS NULL
  ORDER BY time_updated DESC`;

export type { DbMessage, DbMessageRow, DbSessionV2, V2MessageRow };
export { readJson, asTimestamp, normalizeDbJson, normalizeMessages, normalizeModel, extractDetail, extractDbDetail, projectFromSession, buildDbMessages, dbMessagesSql, DB_SESSIONS_SQL, normalizeV2Model, buildV2Messages, v2MessagesSql, v2TokensSql, DB_SESSIONS_V2_SQL };
