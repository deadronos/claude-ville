/**
 * Claude Code CLI adapter
 * Data source: ~/.claude/
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

import type { AgentAdapter, WatchPath } from '../../shared/types.js';
import { debugAdapterError, readLines, parseJsonLines, collectJsonl, foldJsonl } from './jsonl-utils.js';

// Type for directory entries from readdirSync with withFileTypes: true
type Dirent = { name: string; isDirectory(): boolean; isFile(): boolean };

const CLAUDE_DIR = process.env.CLAUDE_DIR || path.join(os.homedir(), '.claude');
const HISTORY_FILE = path.join(CLAUDE_DIR, 'history.jsonl');
const TEAMS_DIR = path.join(CLAUDE_DIR, 'teams');
const TASKS_DIR = path.join(CLAUDE_DIR, 'tasks');

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

// ─── Adapter class ──────────────────────────────────────

export class ClaudeAdapter implements AgentAdapter {
  get name() { return 'Claude Code'; }
  get provider() { return 'claude'; }
  get homeDir() { return CLAUDE_DIR; }

  isAvailable() {
    return fs.existsSync(CLAUDE_DIR);
  }

  async getActiveSessions(activeThresholdMs: number) {
    const lines = await readLines(HISTORY_FILE, { count: 1000, scope: 'claude' });
    const entries = parseJsonLines(lines, 'claude');
    const now = Date.now();
    const sessionsMap = new Map();
    const projectPathMap = new Map(); // encoded dir name -> actual path

    const HISTORY_SCAN_MS = activeThresholdMs;
    for (const entry of entries) {
      // Build project path map from all entries (regardless of active status)
      if (entry.project) {
        const encoded = entry.project.replace(/\//g, '-');
        projectPathMap.set(encoded, entry.project);
      }

      if (!entry.sessionId) continue;
      if (now - (entry.timestamp || 0) > HISTORY_SCAN_MS) continue;

      const existing = sessionsMap.get(entry.sessionId);
      if (!existing || (entry.timestamp || 0) > (existing.timestamp || 0)) {
        sessionsMap.set(entry.sessionId, {
          sessionId: entry.sessionId,
          provider: 'claude',
          agentId: entry.agentId || null,
          agentType: entry.agentType || (entry.agentId ? 'sub-agent' : 'main'),
          model: entry.model || 'unknown',
          status: 'active',
          lastActivity: entry.timestamp || 0,
          project: entry.project || null,
          lastMessage: entry.display ? entry.display.substring(0, 100) : null,
        });
      }
    }

    const sessionArray = Array.from(sessionsMap.values());
    // Fetch file activity for all sessions in parallel
    const sessionWithActivity = await Promise.all(sessionArray.map(async (session) => {
      const fileMtime = await getSessionFileActivity(session.sessionId, session.project);
      return { session, fileMtime };
    }));

    const mainSessions = [];
    for (const { session, fileMtime } of sessionWithActivity) {
      const lastActive = Math.max(session.lastActivity, fileMtime);
      if (now - lastActive > activeThresholdMs) continue;

      session.lastActivity = lastActive;
      const detail = await getSessionDetail(session.sessionId, session.project);
      mainSessions.push({
        ...session,
        model: detail.model || session.model,
        lastTool: detail.lastTool,
        lastToolInput: detail.lastToolInput,
        lastMessage: detail.lastMessage || session.lastMessage,
      });
    }

    mainSessions.sort((a, b) => b.lastActivity - a.lastActivity);

    // Sub-agents (pass project path map)
    const subAgents = await this._getActiveSubAgents(activeThresholdMs, projectPathMap);

    // Orphan sessions (not in history.jsonl or subagents/)
    const knownIds = new Set([
      ...Array.from(sessionsMap.keys()),
      ...subAgents.map(s => s.sessionId.replace('subagent-', '')),
    ]);
    const orphans = await this._getOrphanSessions(activeThresholdMs, projectPathMap, knownIds);

    return [...mainSessions, ...subAgents, ...orphans];
  }

  async _getActiveSubAgents(activeThresholdMs: number, projectPathMap: Map<string, string> = new Map()) {
    const projectsDir = path.join(CLAUDE_DIR, 'projects');
    if (!fs.existsSync(projectsDir)) return [];

    const now = Date.now();

    let projDirs: Dirent[] = [];
    try {
      projDirs = (await fs.promises.readdir(projectsDir, { withFileTypes: true }))
        .filter((d: Dirent) => d.isDirectory());
    } catch (err) {
      debugAdapterError('claude', 'getActiveSubAgents readdir projects', err, projectsDir);
      return [];
    }

    const projectResults = await Promise.all(projDirs.map(async (projDir: Dirent) => {
      const projPath = path.join(projectsDir, projDir.name);

      let sessionDirs: Dirent[] = [];
      try {
        sessionDirs = (await fs.promises.readdir(projPath, { withFileTypes: true }))
          .filter((d: Dirent) => d.isDirectory());
      } catch (err) {
        debugAdapterError('claude', 'getActiveSubAgents readdir project', err, projPath);
        return [];
      }

      const sessionResults = await Promise.all(sessionDirs.map(async (sessionDir: Dirent) => {
        const subagentsDir = path.join(projPath, sessionDir.name, 'subagents');
        if (!fs.existsSync(subagentsDir)) return [];

        let agentFiles: string[] = [];
        try {
          agentFiles = (await fs.promises.readdir(subagentsDir))
            .filter((f: string) => f.startsWith('agent-') && f.endsWith('.jsonl'));
        } catch (err) {
          debugAdapterError('claude', 'getActiveSubAgents readdir subagents', err, subagentsDir);
          return [];
        }

        const agentResults = await Promise.all(agentFiles.map(async (agentFile: string) => {
          const filePath = path.join(subagentsDir, agentFile);
          let stat;
          try {
            stat = await fs.promises.stat(filePath);
          } catch (err) {
            debugAdapterError('claude', 'getActiveSubAgents stat', err, filePath);
            return null;
          }

          if (now - stat.mtimeMs > activeThresholdMs) return null;

          const agentId = agentFile.replace('agent-', '').replace('.jsonl', '');
          const detail = await getSubAgentDetail(filePath);
          const decodedProject = resolveProjectDisplayPath(projectPathMap, projDir.name);

          return {
            sessionId: `subagent-${agentId}`,
            provider: 'claude',
            agentId,
            agentType: 'sub-agent' as const,
            model: detail.model || 'unknown',
            status: 'active' as const,
            lastActivity: stat.mtimeMs,
            project: decodedProject,
            lastMessage: detail.lastMessage,
            lastTool: detail.lastTool,
            lastToolInput: detail.lastToolInput,
            parentSessionId: sessionDir.name,
          };
        }));

        return agentResults.filter((r) => r !== null);
      }));

      return sessionResults.flat();
    }));

    return projectResults.flat().filter(Boolean);
  }

  async _getOrphanSessions(activeThresholdMs: number, projectPathMap: Map<string, string> = new Map(), knownIds: Set<string> = new Set()) {
    const projectsDir = path.join(CLAUDE_DIR, 'projects');
    if (!fs.existsSync(projectsDir)) return [];

    const now = Date.now();

    let projDirs: Dirent[] = [];
    try {
      projDirs = (await fs.promises.readdir(projectsDir, { withFileTypes: true }))
        .filter((d: Dirent) => d.isDirectory());
    } catch (err) {
      debugAdapterError('claude', 'getOrphanSessions readdir projects', err, projectsDir);
      return [];
    }

    const projectResults = await Promise.all(projDirs.map(async (projDir: Dirent) => {
      const projPath = path.join(projectsDir, projDir.name);

      let files: string[] = [];
      try {
        files = (await fs.promises.readdir(projPath))
          .filter((f: string) => f.endsWith('.jsonl') && !f.startsWith('.'));
      } catch (err) {
        debugAdapterError('claude', 'getOrphanSessions readdir project', err, projPath);
        return [];
      }

      const fileResults = await Promise.all(files.map(async (file: string) => {
        const sessionId = file.replace('.jsonl', '');
        if (knownIds.has(sessionId)) return null;

        const filePath = path.join(projPath, file);
        let stat;
        try {
          stat = await fs.promises.stat(filePath);
        } catch (err) {
          debugAdapterError('claude', 'getOrphanSessions stat', err, filePath);
          return null;
        }

        if (now - stat.mtimeMs > activeThresholdMs) return null;

        const detail = await getSubAgentDetail(filePath);
        const decodedProject = resolveProjectDisplayPath(projectPathMap, projDir.name);

        return {
          sessionId,
          provider: 'claude',
          agentId: sessionId,
          agentType: 'team-member' as const,
          model: detail.model || 'unknown',
          status: 'active' as const,
          lastActivity: stat.mtimeMs,
          project: decodedProject,
          lastMessage: detail.lastMessage,
          lastTool: detail.lastTool,
          lastToolInput: detail.lastToolInput,
        };
      }));

      return fileResults.filter((r) => r !== null);
    }));

    return projectResults.flat().filter(Boolean);
  }

  async getSessionDetail(sessionId: string, project: string | null, filePath: string | null = null) {
    const sessionFilePath = filePath || await resolveSessionFilePath(sessionId, project);
    if (!sessionFilePath) return { toolHistory: [], messages: [] };
    const [toolHistory, messages, tokenUsage] = await Promise.all([
      getToolHistory(sessionFilePath),
      getRecentMessages(sessionFilePath),
      getTokenUsage(sessionFilePath),
    ]);
    return {
      toolHistory,
      messages,
      tokenUsage,
      sessionId,
    };
  }

  getWatchPaths(): WatchPath[] {
    const paths: WatchPath[] = [];

    // history.jsonl
    if (fs.existsSync(HISTORY_FILE)) {
      paths.push({ type: 'file', path: HISTORY_FILE });
    }

    // Project directories (recursive to also catch sub-agent files)
    const projectsDir = path.join(CLAUDE_DIR, 'projects');
    if (fs.existsSync(projectsDir)) {
      try {
        const projDirs = fs.readdirSync(projectsDir, { withFileTypes: true })
          .filter((d: Dirent) => d.isDirectory());
        for (const dir of projDirs) {
          paths.push({
            type: 'directory',
            path: path.join(projectsDir, dir.name),
            filter: '.jsonl',
            recursive: true,
          });
        }
      } catch (err) {
        debugAdapterError('claude', 'getWatchPaths', err, projectsDir);
      }
    }

    // Teams directory (detect team creation/changes)
    if (fs.existsSync(TEAMS_DIR)) {
      paths.push({
        type: 'directory',
        path: TEAMS_DIR,
        recursive: true,
        filter: '.json',
      });
    }

    return paths;
  }

  // ─── Teams/tasks (Claude only) ──────────────────────

  async getTeams() {
    try {
      const teamDirs = await fs.promises.readdir(TEAMS_DIR, { withFileTypes: true });
      const teamPromises = teamDirs
        .filter((d: Dirent) => d.isDirectory())
        .map(async (dir: Dirent) => {
          const configPath = path.join(TEAMS_DIR, dir.name, 'config.json');
          try {
            const content = await fs.promises.readFile(configPath, 'utf-8');
            const config = JSON.parse(content);
            return { teamName: dir.name, ...config };
          } catch (err) {
            if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return null;
            debugAdapterError('claude', 'getTeams read/parse config', err, configPath);
            return { teamName: dir.name, error: 'parse failed' };
          }
        });

      const results = await Promise.all(teamPromises);
      return results.filter(Boolean);
    } catch (err) {
      debugAdapterError('claude', 'getTeams readdir', err, TEAMS_DIR);
      return [];
    }
  }

  async getTasks() {
    try {
      const taskDirs = await fs.promises.readdir(TASKS_DIR, { withFileTypes: true });
      const groupPromises = taskDirs
        .filter((dir: Dirent) => dir.isDirectory())
        .map(async (dir: Dirent) => {
          const groupDir = path.join(TASKS_DIR, dir.name);
          try {
            const files = await fs.promises.readdir(groupDir);
            const jsonFiles = files.filter((f: string) => f.endsWith('.json'));

            const taskPromises = jsonFiles.map(async (file: string) => {
              try {
                const content = await fs.promises.readFile(path.join(groupDir, file), 'utf-8');
                return JSON.parse(content);
              } catch (err) {
                debugAdapterError('claude', 'getTasks read/parse task', err, path.join(groupDir, file));
                return null;
              }
            });

            const tasks = (await Promise.all(taskPromises)).filter(Boolean);
            return {
              groupName: dir.name,
              tasks: tasks.sort((a, b) => Number(a.id || 0) - Number(b.id || 0)),
              count: tasks.length,
            };
          } catch (err) {
            debugAdapterError('claude', 'getTasks readdir group', err, groupDir);
            return null;
          }
        });

      const taskGroups = (await Promise.all(groupPromises)).filter(Boolean);
      return taskGroups;
    } catch (err) {
      debugAdapterError('claude', 'getTasks readdir', err, TASKS_DIR);
      return [];
    }
  }
}
