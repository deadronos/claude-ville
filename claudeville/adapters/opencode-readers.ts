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
export type { DbMessage };
export { readJson, asTimestamp, normalizeDbJson, normalizeMessages, normalizeModel, extractDetail, extractDbDetail, projectFromSession };
