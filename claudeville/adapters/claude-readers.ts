/**
 * The format-specific readers for the Claude Code CLI adapter, split out of
 * `claude.ts` for file size. `claude.ts` stays the entry point and owns the
 * adapter class and the scan; the dependency is one-way.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { debugAdapterError, collectJsonl, foldJsonl } from './jsonl-utils.js';

// Lives here rather than in `claude.ts` so that the three readers below, which
// all resolve paths under it, need nothing from the entry point: the
// dependency stays one-way. `claude.ts` imports it back for its constants.
export const CLAUDE_DIR = process.env.CLAUDE_DIR || path.join(os.homedir(), '.claude');

function resolveProjectDisplayPath(projectPathMap: Map<string, string>, encodedProjectDirName: string) {
  const mapped = projectPathMap.get(encodedProjectDirName);
  if (mapped) return mapped;
  // Encoded project dir names use '/' -> '-' substitution; reverse-transform loses info.
  // Instead of guessing a wrong path, expose a stable identifier.
  return `claude:projects:${encodedProjectDirName}`;
}

// ─── Shared session detail extraction ─────────────────────

type SessionDetail = {
  model: string | null;
  lastTool: string | null;
  lastMessage: string | null;
  lastToolInput: string | null;
};

function newSessionDetail(): SessionDetail {
  return { model: null, lastTool: null, lastMessage: null, lastToolInput: null };
}

/**
 * The accumulator step for every detail read below. It mutates `detail` in
 * place and returns nothing: `foldJsonl` discards an `onEntry` return value, so
 * the tempting `(acc, e) => ({ ...acc, lastTool: e.x })` typechecks and silently
 * leaves the detail all-null. The direction and the absence of an `until` are
 * documented on `foldNewestFirstDetail`.
 */
function foldDetailEntry(detail: SessionDetail, entry: any) {
  const msg = entry.message;
  if (!msg || msg.role !== 'assistant') return;

  if (!detail.model && msg.model) detail.model = msg.model;

  const content = msg.content;
  if (!Array.isArray(content)) return;

  for (const block of content) {
    if (!detail.lastTool && block.type === 'tool_use') {
      detail.lastTool = block.name || null;
      if (block.input) {
        if (block.input.command) detail.lastToolInput = block.input.command.substring(0, 60);
        else if (block.input.file_path) detail.lastToolInput = block.input.file_path.split('/').pop();
        else if (block.input.pattern) detail.lastToolInput = block.input.pattern;
        else if (block.input.query) detail.lastToolInput = block.input.query.substring(0, 40);
        else if (block.input.recipient) detail.lastToolInput = block.input.recipient;
      }
    }
    if (!detail.lastMessage && block.type === 'text' && block.text) {
      const text = block.text.trim();
      if (text.length > 0) detail.lastMessage = text.substring(0, 80);
    }
  }
}

/**
 * The single place this file's detail read decides its DIRECTION.
 *
 * `reverse: true` is load-bearing and must NOT be harmonised with `codex`. This
 * walk has always been NEWEST-FIRST (`claude.ts:41` was
 * `for (let i = entries.length - 1; i >= 0; i--)`), so under the `!detail.lastX`
 * guards the first match is the genuinely LATEST tool and message — which is
 * what the field names claim. `codex`'s `parseRollout` walks FORWARD under the
 * same guards, so its first match is the OLDEST and it reports the wrong tool
 * on every session row; that is a real defect there, deliberately left unfixed.
 * Neither direction should be copied into the other.
 *
 * Both readers share this one flag rather than each declaring its own: every
 * sub-agent and orphan fixture file holds a single assistant turn, so a second,
 * independently-set `reverse` at the `getSubAgentDetail` call site would be
 * observable by nothing. One direction, one place to get it wrong.
 *
 * No `until` is passed here either, deliberately. The `!detail.lastX` guards in
 * `foldDetailEntry` are per-field, not a global stop, so the walk keeps going
 * after the first match to fill the OTHER fields — the `break` this replaces was
 * provably a no-op, since every write sat behind a guard. That is the opposite of
 * `pi`'s `until`, which B2b proved load-bearing.
 */
function foldNewestFirstDetail(filePath: string, count: number, operation: string) {
  return foldJsonl<SessionDetail>(filePath, {
    scope: 'claude',
    operation,
    count,
    reverse: true, // newest-first — see above
    init: newSessionDetail(),
    onEntry: foldDetailEntry,
  });
}

// ─── Session parsing ─────────────────────────────────────

async function getSessionDetail(sessionId: string, project: string | null) {
  if (!project) return newSessionDetail();

  const encoded = project.replace(/\//g, '-');
  const sessionFile = path.join(CLAUDE_DIR, 'projects', encoded, `${sessionId}.jsonl`);
  if (!fs.existsSync(sessionFile)) return newSessionDetail();

  return foldNewestFirstDetail(sessionFile, 30, 'getSessionDetail');
}

async function getSubAgentDetail(filePath: string) {
  return foldNewestFirstDetail(filePath, 20, 'getSubAgentDetail');
}

// ─── Tool history ───────────────────────────────────

type ToolEvent = { tool: string; detail: string; ts: number };

async function getToolHistory(sessionFilePath: string, maxItems = 15) {
  return collectJsonl<ToolEvent>(sessionFilePath, {
    scope: 'claude',
    operation: 'getToolHistory',
    count: 100,
    maxItems,
    onEntry: (entry, out) => {
      const msg = entry.message;
      if (!msg || msg.role !== 'assistant') return;
      const content = msg.content;
      if (!Array.isArray(content)) return;

      for (const block of content) {
        if (block.type !== 'tool_use') continue;
        let detail = '';
        if (block.input) {
          if (block.input.command) detail = block.input.command.substring(0, 80);
          else if (block.input.file_path) detail = block.input.file_path;
          else if (block.input.pattern) detail = block.input.pattern;
          else if (block.input.query) detail = block.input.query.substring(0, 60);
          else if (block.input.prompt) detail = block.input.prompt.substring(0, 60);
          else if (block.input.url) detail = block.input.url;
          else if (block.input.description) detail = block.input.description.substring(0, 60);
        }
        out.push({ tool: block.name || 'unknown', detail, ts: entry.timestamp || 0 });
      }
    },
  });
}

// ─── Recent messages ──────────────────────────────────────

type ChatMessage = { role: string; text: string; ts: number };

async function getRecentMessages(sessionFilePath: string, maxItems = 5) {
  return collectJsonl<ChatMessage>(sessionFilePath, {
    scope: 'claude',
    operation: 'getRecentMessages',
    count: 60,
    maxItems,
    onEntry: (entry, out) => {
      const msg = entry.message;
      if (!msg) return;
      const content = msg.content;
      if (!Array.isArray(content)) return;

      for (const block of content) {
        if (block.type !== 'text' || !block.text) continue;
        const text = block.text.trim();
        if (text.length === 0) continue;
        // No role fallback (unlike `pi`): an entry with array content and no
        // `role` yields `role: undefined`. Recorded, deliberately unchanged.
        out.push({ role: msg.role, text: text.substring(0, 200), ts: entry.timestamp || 0 });
      }
    },
  });
}

type TokenFold = {
  totalInput: number;
  totalOutput: number;
  cacheRead: number;
  cacheCreate: number;
  turnCount: number;
  lastUsage: any | null;
};

async function getTokenUsage(sessionFilePath: string) {
  const usage = await foldJsonl<TokenFold>(sessionFilePath, {
    scope: 'claude',
    operation: 'getTokenUsage',
    count: 200,
    init: { totalInput: 0, totalOutput: 0, cacheRead: 0, cacheCreate: 0, turnCount: 0, lastUsage: null },
    // FORWARD, unlike codex's token lookup: the sums are order-independent and
    // `contextWindow` must come from the LAST turn in the window, so this must
    // NOT gain `reverse: true`.
    onEntry: (usage, entry) => {
      const msg = entry.message;
      if (!msg || !msg.usage) return;
      const u = msg.usage;
      usage.totalInput += u.input_tokens || 0;
      usage.totalOutput += u.output_tokens || 0;
      usage.cacheRead += u.cache_read_input_tokens || 0;
      usage.cacheCreate += u.cache_creation_input_tokens || 0;
      usage.turnCount++;
      usage.lastUsage = u;
    },
  });
  const lastUsage = usage.lastUsage;
  return {
    totalInput: usage.totalInput,
    totalOutput: usage.totalOutput,
    cacheRead: usage.cacheRead,
    cacheCreate: usage.cacheCreate,
    // last turn context = input + cache_read + cache_create
    contextWindow: lastUsage
      ? (lastUsage.input_tokens || 0) +
        (lastUsage.cache_read_input_tokens || 0) +
        (lastUsage.cache_creation_input_tokens || 0)
      : 0,
    turnCount: usage.turnCount,
  };
}

async function resolveSessionFilePath(sessionId: string, project: string | null) {
  if (!project) return null;
  const encoded = project.replace(/\//g, '-');
  const projectsDir = path.join(CLAUDE_DIR, 'projects', encoded);

  if (sessionId.startsWith('subagent-')) {
    const agentId = sessionId.replace('subagent-', '');
    try {
      const sessionDirs = await fs.promises.readdir(projectsDir, { withFileTypes: true });
      for (const dir of sessionDirs) {
        if (!dir.isDirectory()) continue;
        const agentFile = path.join(projectsDir, dir.name, 'subagents', `agent-${agentId}.jsonl`);
        if (fs.existsSync(agentFile)) return agentFile;
      }
    } catch (err) {
      debugAdapterError('claude', 'resolveSessionFilePath', err, projectsDir);
    }
    return null;
  }

  const sessionFile = path.join(projectsDir, `${sessionId}.jsonl`);
  return fs.existsSync(sessionFile) ? sessionFile : null;
}

async function getSessionFileActivity(sessionId: string, project: string | null) {
  if (!project) return 0;
  const encoded = project.replace(/\//g, '-');
  const sessionFile = path.join(CLAUDE_DIR, 'projects', encoded, `${sessionId}.jsonl`);
  try {
    if (fs.existsSync(sessionFile)) {
      const stat = await fs.promises.stat(sessionFile);
      return stat.mtimeMs;
    }
  } catch (err) {
    debugAdapterError('claude', 'getSessionFileActivity', err, sessionFile);
  }
  return 0;
}

export { resolveProjectDisplayPath, getSessionDetail, getSubAgentDetail, getToolHistory, getRecentMessages, getTokenUsage, resolveSessionFilePath, getSessionFileActivity };
