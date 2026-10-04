/**
 * OpenClaw adapter
 *
 * Current OpenClaw (>= 2026) stores live sessions per agent in SQLite:
 *   ~/.openclaw/agents/{agentId}/agent/openclaw-agent.sqlite
 *     - session_windows    : one row per session window (id, session_key, model, timestamps)
 *     - transcript_events  : ordered event log (event_json OR zstd-compressed event_zstd)
 *     - conversations      : channel/conversation metadata
 *
 * Older installs wrote JSONL transcripts to
 *   ~/.openclaw/agents/{agentId}/sessions/*.jsonl
 * which are now only used for archived/deleted sessions
 * (`*.jsonl.deleted.*.zst`). We keep the JSONL reader as a fallback.
 *
 * Legacy JSONL session format:
 *   {"type":"session","version":3,"id":"...","timestamp":"...","cwd":"..."}
 *   {"type":"model_change","provider":"github-copilot","modelId":"gpt-5-mini",...}
 *   {"type":"message","message":{"role":"assistant","content":[...],"model":"...","usage":{...}},...}
 */
import fs from 'fs';
import path from 'path';

import type { AdapterSessionDetail, AdapterSessionsResult, AgentAdapter, AgentSessionSummary, WatchPath } from '../../shared/types.js';
import { hasTable, isOpenableSqliteDatabase, queryAll, withReadonlySqlite } from './sqlite-utils.js';
import { toolBlockInfo, normalizeTokenUsage, decodeEventRows, parseSession, getToolHistory, getRecentMessages } from './openclaw-readers.js';
import { OPENCLAW_DIR, AGENTS_DIR, AGENT_DB_FILENAME, readAgentDirs, buildSessionId, buildProjectKey, parseSessionId, scanAgentSessionFiles, findAgentDatabase, getDbSessions } from './openclaw-scan.js';
import { extractText } from './text-utils.js';
import { combineSources, degradedWarnings, sourceDetail, type SourceListing } from './sources.js';
import type { Dirent } from './scan-utils.js';

// ─── Adapter class ────────────────────────────────────────

export class OpenClawAdapter implements AgentAdapter {
  get name() { return 'OpenClaw'; }
  get provider() { return 'openclaw'; }
  get homeDir() { return OPENCLAW_DIR; }

  isAvailable() {
    return fs.existsSync(AGENTS_DIR);
  }

  async getActiveSessions(activeThresholdMs: number): Promise<AdapterSessionsResult> {
    // SQLite-backed sessions (current OpenClaw)
    const { sessions: dbSessions, databaseCount, dbBackedAgents, failures: dbFailures } = await getDbSessions(activeThresholdMs);

    // Legacy JSONL sessions, for every agent the database did NOT answer for.
    const legacySessions: AgentSessionSummary[] = [];
    let dirsUnreadable = 0;
    let agentsUnreadable: string[] = [];
    if (fs.existsSync(AGENTS_DIR)) {
      // null and [] are the same walk — nothing enumerable — but only one of them
      // is silent, and `readAgentDirs` has already said which case this is.
      const agentDirs = readAgentDirs('getActiveSessions');

      if (agentDirs === null) {
        // The provider's own agent root could not be listed, so NOTHING under it
        // was looked at — no database and no legacy half. The loss is unavoidable
        // (a directory that cannot be read cannot be walked) but it is no longer
        // silent, which is what #157 asked for and what this contract finishes.
        agentsUnreadable = ['agents'];
      }

      for (const dir of agentDirs ?? []) {
        if (dbBackedAgents.has(dir.name)) continue;
        const sessionsDir = path.join(AGENTS_DIR, dir.name, 'sessions');
        const fileSessions = await scanAgentSessionFiles(dir.name, sessionsDir, activeThresholdMs);
        dirsUnreadable += fileSessions.dirsUnreadable;
        for (const { filePath, mtime, fileName, agentId } of fileSessions.sessions) {
          const detail = await parseSession(filePath);
          legacySessions.push({
            sessionId: buildSessionId(agentId, fileName),
            provider: 'openclaw',
            agentId,
            displayName: agentId || null,
            agentType: 'main',
            model: detail.model || 'unknown',
            status: 'active',
            lastActivity: mtime,
            project: buildProjectKey(agentId, detail.project),
            lastMessage: detail.lastMessage,
            lastTool: detail.lastTool,
            lastToolInput: detail.lastToolInput,
            parentSessionId: null,
            filePath,
          });
        }
      }
    }

    // Two sources, and the classification is the shared rule. The agents root is
    // one of them: when it could not be listed, neither the database nor any
    // legacy file was read, so the provider failed with `root-unreadable` rather
    // than reporting an empty listing that reads as "no openclaw agents
    // installed" — which is what #157's `console.error` alone could not fix.
    //
    // The per-agent database failures are NOT that. Each one still has its legacy
    // JSONL scan below, so the listing stands and each becomes a `warning`
    // (audit instance 8, and #157's whole point).
    const dbSource: SourceListing = databaseCount === 0
      ? { kind: 'absent' }
      : dbFailures.length > 0 && !dbBackedAgents.size
        ? {
          kind: 'failed',
          code: dbFailures[0].code,
          detail: sourceDetail(`${dbFailures.length} agent database(s) could not be read`, OPENCLAW_DIR),
        }
        : {
          kind: 'rows',
          sessions: dbSessions,
          // Each unreadable database is a WARNING while any other agent answered or
          // has a legacy scan below: that agent keeps its rows, so the listing
          // stands. Reporting it as a failure is the #157 regression.
          warnings: dbFailures.map((failure) => ({
            code: failure.code,
            detail: `1 agent database (${failure.agentId})`,
          })),
        };

    const legacySource: SourceListing = agentsUnreadable.length > 0
      ? { kind: 'failed', code: 'root-unreadable', detail: sourceDetail('agents directory could not be listed', OPENCLAW_DIR) }
      : fs.existsSync(AGENTS_DIR)
        ? {
          kind: 'rows',
          sessions: legacySessions,
          warnings: degradedWarnings(dirsUnreadable, 'root-unreadable', 'agent sessions directory(ies)'),
        }
        : { kind: 'absent' };

    const combined = combineSources([dbSource, legacySource]);
    if (!combined.ok) return combined;
    return {
      ok: true,
      // `?? 0` because `AgentSessionSummary.lastActivity` is optional, exactly as
      // in `collectFromAdapters`. Every openclaw row sets it to a number, so this
      // only decides what an absent value sorts as, and the order is unchanged.
      sessions: combined.sessions.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0)),
      warnings: combined.warnings,
    };
  }

  async getSessionDetail(sessionId: string, project: string | null, filePath: string | null = null): Promise<AdapterSessionDetail> {
    const parsed = parseSessionId(sessionId);

    // SQLite-backed session (current OpenClaw)
    if (filePath && filePath.endsWith('.sqlite')) {
      return this.readDbSessionDetail(filePath, parsed.fileId, sessionId);
    }

    if (!filePath || !filePath.endsWith('.jsonl')) {
      const database = findAgentDatabase(parsed.agentId);
      if (database) {
        const detail = this.readDbSessionDetail(database.dbPath, parsed.fileId, sessionId);
        if (detail.toolHistory.length || detail.messages.length) return detail;
      }
    }

    // Legacy JSONL
    let target = filePath;
    if (!target && fs.existsSync(AGENTS_DIR)) {
      const agents = fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
        .filter((d: Dirent) => d.isDirectory());
      for (const dir of agents) {
        if (parsed.agentId && dir.name !== parsed.agentId) continue;
        const sessionsDir = path.join(AGENTS_DIR, dir.name, 'sessions');
        const candidate = path.join(sessionsDir, `${parsed.fileId}.jsonl`);
        if (fs.existsSync(candidate)) { target = candidate; break; }
      }
    }

    if (target && fs.existsSync(target)) {
      return {
        toolHistory: await getToolHistory(target),
        messages: await getRecentMessages(target),
        sessionId,
      };
    }

    return { toolHistory: [], messages: [] };
  }

  private readDbSessionDetail(dbPath: string, rawSessionId: string, sessionId: string): AdapterSessionDetail {
    const detail = withReadonlySqlite(dbPath, 'openclaw', (db) => {
      if (!hasTable(db, 'transcript_events')) return null;
      const rows = queryAll<{ event_json: string | null; event_zstd: Buffer | null }>(
        db,
        'SELECT event_json, event_zstd FROM transcript_events WHERE session_id = ? ORDER BY seq DESC LIMIT ?',
        [rawSessionId, 200],
      );
      // rows are newest-first; reverse to chronological so `slice(-N)` keeps the latest
      const entries = decodeEventRows(rows).reverse();
      const toolHistory: Array<{ tool: string; detail: string; ts: number }> = [];
      const messages: Array<{ role: string; text: string; ts: number }> = [];
      let tokenUsage: AdapterSessionDetail['tokenUsage'] = null;

      for (const entry of entries) {
        if (!entry || typeof entry !== 'object' || entry.type !== 'message' || !entry.message) continue;
        const msg = entry.message;
        const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
        const role = msg.role || 'assistant';
        const usage = normalizeTokenUsage(msg.usage);
        if (usage) tokenUsage = usage;
        if (!Array.isArray(msg.content)) continue;

        if (role === 'tool' || role === 'toolResult') {
          continue;
        }

        for (const block of msg.content) {
          const info = toolBlockInfo(block);
          if (!info) continue;
          let toolDetail = '';
          if (info.input !== undefined) {
            toolDetail = (typeof info.input === 'string'
              ? info.input : JSON.stringify(info.input)
            ).substring(0, 80);
          }
          toolHistory.push({ tool: info.name, detail: toolDetail, ts });
        }

        const text = extractText(msg.content);
        if (text) messages.push({ role, text: text.substring(0, 200), ts });
      }

      return {
        toolHistory: toolHistory.slice(-15),
        messages: messages.slice(-5),
        tokenUsage,
        sessionId,
      };
    });

    return detail || { toolHistory: [], messages: [] };
  }

  getWatchPaths(): WatchPath[] {
    const paths: WatchPath[] = [];
    if (!fs.existsSync(AGENTS_DIR)) return paths;

    const agentDirs = readAgentDirs('getWatchPaths');
    if (agentDirs === null) return paths;

    for (const dir of agentDirs) {
      const dbPath = path.join(AGENTS_DIR, dir.name, 'agent', AGENT_DB_FILENAME);
      // `isOpenableSqliteDatabase`, not `isSqliteFile`: a `type: 'file'` watch
      // entry is a promise that this path yields data, and a regular file that
      // is not a database can never do that. `getWatchPaths` runs once, at
      // watcher setup, so the extra open costs nothing per scan.
      if (isOpenableSqliteDatabase(dbPath, 'openclaw')) {
        paths.push({ type: 'file', path: dbPath });
      }

      const sessionsDir = path.join(AGENTS_DIR, dir.name, 'sessions');
      if (fs.existsSync(sessionsDir)) {
        paths.push({ type: 'directory', path: sessionsDir, filter: '.jsonl' });
      }
    }

    return paths;
  }
}

