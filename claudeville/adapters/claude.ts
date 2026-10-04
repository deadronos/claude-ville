/**
 * Claude Code CLI adapter
 * Data source: ~/.claude/
 */
import fs from 'fs';
import path from 'path';

import type { AdapterSessionsResult, AgentAdapter, AgentSessionSummary, WatchPath } from '../../shared/types.js';
import { debugAdapterError, readLines, parseJsonLines } from './jsonl-utils.js';
import { CLAUDE_DIR, resolveProjectDisplayPath, getSessionFileActivity, getSessionDetail, getSubAgentDetail, getToolHistory, getRecentMessages, getTokenUsage, resolveSessionFilePath } from './claude-readers.js';
import type { Dirent } from './scan-utils.js';
import { combineSources, degradedWarnings, sourceDetail, type SourceListing } from './sources.js';

const HISTORY_FILE = path.join(CLAUDE_DIR, 'history.jsonl');
const TEAMS_DIR = path.join(CLAUDE_DIR, 'teams');
const TASKS_DIR = path.join(CLAUDE_DIR, 'tasks');

/**
 * What one `projects/` walk produced, plus the failures it used to fold into an
 * empty array. Shared by the two scans that read the same root.
 */
type ClaudeProjectScan = {
  sessions: AgentSessionSummary[];
  /** `projects/` itself could not be listed: a whole-source failure. */
  projectsUnreadable: boolean;
  /** One project directory (or one `subagents/`) could not be listed. */
  dirsUnreadable: number;
  /** One session file could not be stat-ed. */
  filesUnstattable: number;
};

// ─── Adapter class ──────────────────────────────────────

export class ClaudeAdapter implements AgentAdapter {
  get name() { return 'Claude Code'; }
  get provider() { return 'claude'; }
  get homeDir() { return CLAUDE_DIR; }

  isAvailable() {
    return fs.existsSync(CLAUDE_DIR);
  }

  async getActiveSessions(activeThresholdMs: number): Promise<AdapterSessionsResult> {
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
      ...subAgents.sessions.map(s => s.sessionId.replace('subagent-', '')),
    ]);
    const orphans = await this._getOrphanSessions(activeThresholdMs, projectPathMap, knownIds);

    // Claude has three independent sources, and the two that live under
    // `projects/` share one root, so the classification is the shared rule with
    // one extra wrinkle: `projects/` being unreadable fails BOTH of them at once,
    // and that is still only a warning while `history.jsonl` answered. An install
    // whose history file is absent AND whose `projects/` cannot be listed has
    // nothing readable at all, which is the `ok: false` case.
    const projectsFailed: SourceListing = {
      kind: 'failed',
      code: 'root-unreadable',
      detail: sourceDetail('projects directory could not be listed', CLAUDE_DIR),
    };
    const projectsWarnings = [
      ...degradedWarnings(subAgents.dirsUnreadable + orphans.dirsUnreadable, 'root-unreadable', 'project directory(ies)'),
      ...degradedWarnings(subAgents.filesUnstattable + orphans.filesUnstattable, 'root-unreadable', 'session file(s)'),
    ];

    const projectsAnswered = subAgents.projectsUnreadable || orphans.projectsUnreadable;
    const projects: SourceListing = projectsAnswered
      ? projectsFailed
      : { kind: 'rows', sessions: [...subAgents.sessions, ...orphans.sessions], warnings: projectsWarnings };

    return combineSources([
      fs.existsSync(HISTORY_FILE) ? { kind: 'rows', sessions: mainSessions, warnings: [] } : { kind: 'absent' },
      projects,
    ]);
  }

  /**
   * Sub-agent rows, plus the failures that used to answer `[]`.
   *
   * Three levels, three catches, one shape: `projects/` unreadable, ONE project
   * directory unreadable, and ONE `subagents/` unreadable all produced an empty
   * array, reported only through `debugAdapterError` (a no-op unless `DEBUG` is
   * set). The first is a whole-source failure; the other two are per-ITEM losses
   * whose siblings were listed and are still here.
   *
   * These WANT directories, so every level filters on `isDirectory()` — a
   * regular file named like a project would be walked as one.
   */
  async _getActiveSubAgents(activeThresholdMs: number, projectPathMap: Map<string, string> = new Map()): Promise<ClaudeProjectScan> {
    const projectsDir = path.join(CLAUDE_DIR, 'projects');
    if (!fs.existsSync(projectsDir)) return { sessions: [], projectsUnreadable: false, dirsUnreadable: 0, filesUnstattable: 0 };

    const now = Date.now();

    let projDirs: Dirent[] = [];
    try {
      projDirs = (await fs.promises.readdir(projectsDir, { withFileTypes: true }))
        .filter((d: Dirent) => d.isDirectory());
    } catch (err) {
      debugAdapterError('claude', 'getActiveSubAgents readdir projects', err, projectsDir);
      return { sessions: [], projectsUnreadable: true, dirsUnreadable: 0, filesUnstattable: 0 };
    }

    let dirsUnreadable = 0;
    let filesUnstattable = 0;
    const projectResults = await Promise.all(projDirs.map(async (projDir: Dirent) => {
      const projPath = path.join(projectsDir, projDir.name);

      let sessionDirs: Dirent[] = [];
      try {
        sessionDirs = (await fs.promises.readdir(projPath, { withFileTypes: true }))
          .filter((d: Dirent) => d.isDirectory());
      } catch (err) {
        debugAdapterError('claude', 'getActiveSubAgents readdir project', err, projPath);
        dirsUnreadable += 1;
        return [];
      }

      const sessionResults = await Promise.all(sessionDirs.map(async (sessionDir: Dirent) => {
        const subagentsDir = path.join(projPath, sessionDir.name, 'subagents');
        if (!fs.existsSync(subagentsDir)) return [];

        let agentFiles: Dirent[] = [];
        try {
          agentFiles = (await fs.promises.readdir(subagentsDir, { withFileTypes: true }))
            .filter((d: Dirent) => d.isFile() && d.name.startsWith('agent-') && d.name.endsWith('.jsonl'));
        } catch (err) {
          debugAdapterError('claude', 'getActiveSubAgents readdir subagents', err, subagentsDir);
          dirsUnreadable += 1;
          return [];
        }

        const agentResults = await Promise.all(agentFiles.map(async (agentFile: Dirent) => {
          const filePath = path.join(subagentsDir, agentFile.name);
          let stat;
          try {
            stat = await fs.promises.stat(filePath);
          } catch (err) {
            debugAdapterError('claude', 'getActiveSubAgents stat', err, filePath);
            filesUnstattable += 1;
            return null;
          }

          if (now - stat.mtimeMs > activeThresholdMs) return null;

          const agentId = agentFile.name.replace('agent-', '').replace('.jsonl', '');
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

    return { sessions: projectResults.flat().filter(Boolean), projectsUnreadable: false, dirsUnreadable, filesUnstattable };
  }

  /**
   * Orphan rows, plus the failures that used to answer `[]` — the same three
   * levels and the same split as {@link _getActiveSubAgents}, over the SAME
   * `projects/` root. Both scans therefore fail together when that root cannot be
   * listed, which is why the classification joins them into one source.
   */
  async _getOrphanSessions(activeThresholdMs: number, projectPathMap: Map<string, string> = new Map(), knownIds: Set<string> = new Set()): Promise<ClaudeProjectScan> {
    const projectsDir = path.join(CLAUDE_DIR, 'projects');
    if (!fs.existsSync(projectsDir)) return { sessions: [], projectsUnreadable: false, dirsUnreadable: 0, filesUnstattable: 0 };

    const now = Date.now();

    let projDirs: Dirent[] = [];
    try {
      projDirs = (await fs.promises.readdir(projectsDir, { withFileTypes: true }))
        .filter((d: Dirent) => d.isDirectory());
    } catch (err) {
      debugAdapterError('claude', 'getOrphanSessions readdir projects', err, projectsDir);
      return { sessions: [], projectsUnreadable: true, dirsUnreadable: 0, filesUnstattable: 0 };
    }

    let dirsUnreadable = 0;
    let filesUnstattable = 0;
    const projectResults = await Promise.all(projDirs.map(async (projDir: Dirent) => {
      const projPath = path.join(projectsDir, projDir.name);

      let files: Dirent[] = [];
      try {
        files = (await fs.promises.readdir(projPath, { withFileTypes: true }))
          .filter((d: Dirent) => d.isFile() && d.name.endsWith('.jsonl') && !d.name.startsWith('.'));
      } catch (err) {
        debugAdapterError('claude', 'getOrphanSessions readdir project', err, projPath);
        dirsUnreadable += 1;
        return [];
      }

      const fileResults = await Promise.all(files.map(async (file: Dirent) => {
        const sessionId = file.name.replace('.jsonl', '');
        if (knownIds.has(sessionId)) return null;

        const filePath = path.join(projPath, file.name);
        let stat;
        try {
          stat = await fs.promises.stat(filePath);
        } catch (err) {
          debugAdapterError('claude', 'getOrphanSessions stat', err, filePath);
          filesUnstattable += 1;
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

    return { sessions: projectResults.flat().filter(Boolean), projectsUnreadable: false, dirsUnreadable, filesUnstattable };
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
            const files = await fs.promises.readdir(groupDir, { withFileTypes: true });
            const jsonFiles = files.filter((f: Dirent) => f.isFile() && f.name.endsWith('.json'));

            const taskPromises = jsonFiles.map(async (file: Dirent) => {
              try {
                const content = await fs.promises.readFile(path.join(groupDir, file.name), 'utf-8');
                return JSON.parse(content);
              } catch (err) {
                debugAdapterError('claude', 'getTasks read/parse task', err, path.join(groupDir, file.name));
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
