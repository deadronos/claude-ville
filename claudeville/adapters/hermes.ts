/**
 * Hermes Agent adapter
 * Data source: HERMES_DIR or ~/.hermes/
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import type { AdapterSessionDetail, AgentAdapter, AgentSessionSummary, WatchPath } from '../../shared/types.js';
import { debugAdapterError, parseJsonLines, readLines } from './jsonl-utils.js';

const HERMES_DIR = process.env.HERMES_DIR || path.join(os.homedir(), '.hermes');
const SESSIONS_DIR = path.join(HERMES_DIR, 'sessions');

type SessionFile = { filePath: string; sessionId: string; mtime: number };

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

function summarizeTool(entry: any): { tool: string; detail: string; ts: number } | null {
  if (!entry || typeof entry !== 'object') return null;
  const role = entry.role || entry.type;
  const name = entry.name || entry.tool || entry.tool_name;
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

export class HermesAdapter implements AgentAdapter {
  get name() { return 'Hermes Agent'; }
  get provider() { return 'hermes'; }
  get homeDir() { return HERMES_DIR; }

  isAvailable() {
    return fs.existsSync(HERMES_DIR);
  }

  async getActiveSessions(activeThresholdMs: number): Promise<AgentSessionSummary[]> {
    const files = await getSessionFiles(activeThresholdMs);
    const sessions = await Promise.all(files.map(async ({ filePath, sessionId, mtime }) => {
      const metadata = await readJson(filePath);
      const transcript = transcriptPath(sessionId);
      const detail = fs.existsSync(transcript)
        ? await parseTranscript(transcript)
        : { lastTool: null, lastToolInput: null, lastMessage: null };
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
        filePath: fs.existsSync(transcript) ? transcript : filePath,
      };
    }));

    return sessions.sort((a, b) => b.lastActivity - a.lastActivity);
  }

  async getSessionDetail(sessionId: string, project: string | null, filePath: string | null = null): Promise<AdapterSessionDetail> {
    if (filePath && filePath.endsWith('.jsonl')) {
      const detail = await parseTranscript(filePath);
      return { toolHistory: detail.toolHistory.slice(-15), messages: detail.messages.slice(-5), sessionId };
    }

    const cleanId = sessionId.replace(/^hermes-/, '');
    const transcript = transcriptPath(cleanId);
    if (!fs.existsSync(transcript)) return { toolHistory: [], messages: [] };
    return this.getSessionDetail(sessionId, project, transcript);
  }

  getWatchPaths(): WatchPath[] {
    return fs.existsSync(SESSIONS_DIR)
      ? [{ type: 'directory', path: SESSIONS_DIR, recursive: false, filter: '.json' }]
      : [];
  }
}
