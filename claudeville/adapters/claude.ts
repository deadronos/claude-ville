/**
 * Claude Code CLI adapter
 * Data source: ~/.claude/
 */
import fs from 'fs';
import path from 'path';

import type { AgentAdapter, WatchPath } from '../../shared/types.js';
import { debugAdapterError, readLines, parseJsonLines } from './jsonl-utils.js';
import { CLAUDE_DIR, resolveProjectDisplayPath, getSessionFileActivity, getSessionDetail, getSubAgentDetail, getToolHistory, getRecentMessages, getTokenUsage, resolveSessionFilePath } from './claude-readers.js';

// Type for directory entries from readdirSync with withFileTypes: true
type Dirent = { name: string; isDirectory(): boolean; isFile(): boolean };

const HISTORY_FILE = path.join(CLAUDE_DIR, 'history.jsonl');
const TEAMS_DIR = path.join(CLAUDE_DIR, 'teams');
const TASKS_DIR = path.join(CLAUDE_DIR, 'tasks');

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
