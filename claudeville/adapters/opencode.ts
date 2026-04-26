/**
 * OpenCode CLI adapter
 * Data source: OPENCODE_DATA_DIR or ~/.local/share/opencode/
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

import type { AgentAdapter, AdapterSessionDetail, AgentSessionSummary, WatchPath } from '../../shared/types.js';
import { debugAdapterError } from './jsonl-utils.js';

const OPENCODE_DIR = process.env.OPENCODE_DATA_DIR || path.join(os.homedir(), '.local', 'share', 'opencode');
const STORAGE_DIR = path.join(OPENCODE_DIR, 'storage');
const SESSION_DIR = path.join(STORAGE_DIR, 'session');
const MESSAGE_DIR = path.join(STORAGE_DIR, 'message');
const DB_FILE = path.join(OPENCODE_DIR, 'opencode.db');
const execFileAsync = promisify(execFile);

type Dirent = { name: string; isDirectory(): boolean; isFile(): boolean };
type SessionFile = { filePath: string; sessionId: string; projectKey: string; mtime: number };
type DbSession = {
  id: string;
  project_id: string;
  parent_id: string | null;
  directory: string;
  title: string;
  time_created: number;
  time_updated: number;
  modelID?: string | null;
  providerID?: string | null;
};
type DbMessage = {
  id: string;
  role: string;
  modelID?: string | null;
  providerID?: string | null;
  time_created: number;
  data: any;
  parts: Array<{ id: string; time_created: number; data: any }>;
};

async function collectJsonFiles(root: string): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    const groups = await Promise.all(entries.map(async (entry: Dirent) => {
      const entryPath = path.join(root, entry.name);
      if (entry.isDirectory()) return collectJsonFiles(entryPath);
      if (entry.isFile() && entry.name.endsWith('.json')) return [entryPath];
      return [];
    }));
    return groups.flat();
  } catch (err) {
    debugAdapterError('opencode', 'collectJsonFiles', err, root);
    return [];
  }
}

async function readJson(filePath: string): Promise<any | null> {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, 'utf-8'));
  } catch (err) {
    debugAdapterError('opencode', 'readJson', err, filePath);
    return null;
  }
}

async function queryDb<T>(sql: string, params: string[] = []): Promise<T[]> {
  if (!fs.existsSync(DB_FILE)) return [];
  try {
    let renderedSql = sql;
    for (const param of params) {
      renderedSql = renderedSql.replace('?', `'${param.replace(/'/g, "''")}'`);
    }
    const { stdout } = await execFileAsync('sqlite3', ['-json', DB_FILE, renderedSql], { maxBuffer: 10 * 1024 * 1024 });
    if (!stdout.trim()) return [];
    return JSON.parse(stdout) as T[];
  } catch (err) {
    debugAdapterError('opencode', 'queryDb', err, DB_FILE);
    return [];
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
} {
  const detail = {
    toolHistory: [] as Array<{ tool: string; detail: string; ts: number }>,
    messages: [] as Array<{ role: string; text: string; ts: number }>,
    model: null as string | null,
    lastTool: null as string | null,
    lastToolInput: null as string | null,
    lastMessage: null as string | null,
  };

  for (const message of messages) {
    const ts = extractMessageTs(message);
    const role = message.role || message.type || 'assistant';
    if (!detail.model && (message.modelID || message.model || message.modelId)) {
      detail.model = message.modelID || message.model || message.modelId;
    }

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

  return detail;
}

async function getSessionFiles(activeThresholdMs: number): Promise<SessionFile[]> {
  if (!fs.existsSync(SESSION_DIR)) return [];
  const now = Date.now();
  const files = await collectJsonFiles(SESSION_DIR);
  const stats = await Promise.all(files.map(async (filePath) => {
    try {
      const stat = await fs.promises.stat(filePath);
      if (now - stat.mtimeMs > activeThresholdMs) return null;
      const sessionId = path.basename(filePath, '.json');
      const projectKey = path.basename(path.dirname(filePath));
      return { filePath, sessionId, projectKey, mtime: stat.mtimeMs };
    } catch (err) {
      debugAdapterError('opencode', 'getSessionFiles stat', err, filePath);
      return null;
    }
  }));
  return stats.filter((result): result is SessionFile => result !== null);
}

function extractDbDetail(messages: DbMessage[]): AdapterSessionDetail & {
  model: string | null;
  lastTool: string | null;
  lastToolInput: string | null;
  lastMessage: string | null;
} {
  const detail = {
    toolHistory: [] as Array<{ tool: string; detail: string; ts: number }>,
    messages: [] as Array<{ role: string; text: string; ts: number }>,
    model: null as string | null,
    lastTool: null as string | null,
    lastToolInput: null as string | null,
    lastMessage: null as string | null,
  };

  for (const message of messages) {
    const messageData = normalizeDbJson(message.data) as any;
    const role = messageData?.role || message.role || 'assistant';
    if (!detail.model && (messageData?.modelID || messageData?.model || message.modelID)) {
      detail.model = normalizeModel(messageData?.modelID || messageData?.model || message.modelID, messageData?.providerID || message.providerID);
    }

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

  return detail;
}

async function getDbMessages(sessionId: string, limit = 30): Promise<DbMessage[]> {
  const rows = await queryDb<{
    message_id: string;
    message_time_created: number;
    message_data: string;
    part_id: string | null;
    part_time_created: number | null;
    part_data: string | null;
  }>(
    `SELECT
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
     ORDER BY recent.time_created ASC, p.time_created ASC`,
    [sessionId],
  );

  const messageMap = new Map<string, DbMessage>();
  for (const row of rows) {
    let message = messageMap.get(row.message_id);
    if (!message) {
      const messageData = normalizeDbJson(row.message_data) as any;
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
      message.parts.push({
        id: row.part_id,
        time_created: row.part_time_created || row.message_time_created,
        data: normalizeDbJson(row.part_data),
      });
    }
  }

  return Array.from(messageMap.values());
}

async function getDbSessions(activeThresholdMs: number): Promise<DbSession[]> {
  if (!fs.existsSync(DB_FILE)) return [];
  const cutoff = Date.now() - activeThresholdMs;
  const rows = await queryDb<DbSession & { message_model: string | null; message_provider: string | null }>(
    `SELECT
       s.id,
       s.project_id,
       s.parent_id,
       s.directory,
       s.title,
       s.time_created,
       s.time_updated,
       (
         SELECT json_extract(m.data, '$.modelID')
         FROM message m
         WHERE m.session_id = s.id
         ORDER BY m.time_created DESC
         LIMIT 1
       ) AS message_model,
       (
         SELECT json_extract(m.data, '$.providerID')
         FROM message m
         WHERE m.session_id = s.id
         ORDER BY m.time_created DESC
         LIMIT 1
       ) AS message_provider
     FROM session s
     WHERE s.time_updated >= ?
       AND s.time_archived IS NULL
     ORDER BY s.time_updated DESC`,
    [String(cutoff)],
  );

  return rows.map((row) => ({
    ...row,
    modelID: row.message_model || null,
    providerID: row.message_provider || null,
  }));
}

function resolveMessageFile(projectKey: string, sessionId: string) {
  return path.join(MESSAGE_DIR, projectKey, `${sessionId}.json`);
}

function projectFromSession(session: any, projectKey: string): string | null {
  return session?.project?.path || session?.cwd || session?.path || session?.directory || projectKey || null;
}

export class OpenCodeAdapter implements AgentAdapter {
  get name() { return 'OpenCode'; }
  get provider() { return 'opencode'; }
  get homeDir() { return OPENCODE_DIR; }

  isAvailable() {
    return fs.existsSync(OPENCODE_DIR);
  }

  async getActiveSessions(activeThresholdMs: number): Promise<AgentSessionSummary[]> {
    const dbSessions = await getDbSessions(activeThresholdMs);
    if (dbSessions.length > 0) {
      const sessions = await Promise.all(dbSessions.map(async (session) => {
        const messages = await getDbMessages(session.id);
        const detail = extractDbDetail(messages);
        return {
          sessionId: `opencode-${session.id}`,
          provider: 'opencode',
          agentId: null,
          agentType: 'main',
          model: detail.model || normalizeModel(session.modelID, session.providerID) || 'opencode',
          status: 'active',
          lastActivity: session.time_updated,
          project: session.directory || session.project_id || null,
          lastMessage: detail.lastMessage,
          lastTool: detail.lastTool,
          lastToolInput: detail.lastToolInput,
          parentSessionId: session.parent_id || null,
          filePath: `opencode-db:${session.id}`,
        };
      }));
      return sessions.sort((a, b) => b.lastActivity - a.lastActivity);
    }

    const files = await getSessionFiles(activeThresholdMs);
    const sessions = await Promise.all(files.map(async ({ filePath, sessionId, projectKey, mtime }) => {
      const [session, rawMessages] = await Promise.all([
        readJson(filePath),
        readJson(resolveMessageFile(projectKey, sessionId)),
      ]);
      const messageFile = resolveMessageFile(projectKey, sessionId);
      const detail = extractDetail(normalizeMessages(rawMessages));
      const updated = asTimestamp(session?.time?.updated ?? session?.updatedAt ?? session?.updated) || mtime;

      return {
        sessionId: `opencode-${session?.id || sessionId}`,
        provider: 'opencode',
        agentId: null,
        agentType: session?.agent || 'main',
        model: detail.model || session?.model || 'opencode',
        status: 'active',
        lastActivity: Math.max(updated, mtime),
        project: projectFromSession(session, projectKey),
        lastMessage: detail.lastMessage,
        lastTool: detail.lastTool,
        lastToolInput: detail.lastToolInput,
        parentSessionId: session?.parentID || session?.parentId || null,
        filePath: fs.existsSync(messageFile) ? messageFile : filePath,
      };
    }));

    return sessions.sort((a, b) => b.lastActivity - a.lastActivity);
  }

  async getSessionDetail(sessionId: string, project: string | null, filePath: string | null = null): Promise<AdapterSessionDetail> {
    if (filePath?.startsWith('opencode-db:')) {
      const dbSessionId = filePath.replace('opencode-db:', '');
      const detail = extractDbDetail(await getDbMessages(dbSessionId, 60));
      return { toolHistory: detail.toolHistory.slice(-15), messages: detail.messages.slice(-5), sessionId };
    }

    const raw = filePath ? await readJson(filePath) : null;
    if (raw) {
      const detail = extractDetail(normalizeMessages(raw));
      return { toolHistory: detail.toolHistory.slice(-15), messages: detail.messages.slice(-5), sessionId };
    }

    const cleanId = sessionId.replace(/^opencode-/, '');
    const files = await getSessionFiles(30 * 60 * 1000);
    const match = files.find((file) => file.sessionId === cleanId);
    if (!match) return { toolHistory: [], messages: [] };

    return this.getSessionDetail(sessionId, project, resolveMessageFile(match.projectKey, cleanId));
  }

  getWatchPaths(): WatchPath[] {
    const paths: WatchPath[] = [];
    if (fs.existsSync(DB_FILE)) paths.push({ type: 'file', path: DB_FILE });
    if (fs.existsSync(SESSION_DIR)) paths.push({ type: 'directory', path: SESSION_DIR, recursive: true, filter: '.json' });
    if (fs.existsSync(MESSAGE_DIR)) paths.push({ type: 'directory', path: MESSAGE_DIR, recursive: true, filter: '.json' });
    return paths;
  }
}
