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

import type { AdapterDetailResult, AdapterSessionDetail, AdapterSessionsResult, AgentAdapter, AgentSessionSummary, WatchPath } from '../../shared/types.js';
import { closeSqlite, hasTableOrNull, isOpenableSqliteDatabase, openReadonlySqlite } from './sqlite-utils.js';
import { toolBlockInfo, normalizeTokenUsage, decodeEventRows, parseSession, getToolHistory, getRecentMessages } from './openclaw-readers.js';
import { debugAdapterError } from './jsonl-utils.js';
import { OPENCLAW_DIR, AGENTS_DIR, AGENT_DB_FILENAME, readAgentDirs, buildSessionId, buildProjectKey, parseSessionId, scanAgentSessionFiles, findAgentDatabase, getDbSessions } from './openclaw-scan.js';
import { extractText } from './text-utils.js';
import { combineDetailSources, combineSources, degradedWarnings, detailFailed, detailOk, sourceDetail, type DetailSource, type SourceListing } from './sources.js';
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
    // No per-agent database failure is ever `ok: false`, and that is deliberate.
    // `AGENTS_DIR` was listed either way, so the provider WAS read: what failed is
    // one agent's store, and that agent's legacy scan still runs. #157 is exactly
    // this case, and calling it a whole-adapter failure would delete the rows it
    // kept. Only the `agents/` root itself can fail the provider.
    const dbSource: SourceListing = databaseCount === 0
      ? { kind: 'absent' }
      : {
        kind: 'rows',
        sessions: dbSessions,
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

  async getSessionDetail(sessionId: string, project: string | null, filePath: string | null = null): Promise<AdapterDetailResult> {
    const parsed = parseSessionId(sessionId);

    // SQLite-backed session (current OpenClaw). An explicit `.sqlite` filePath is
    // the caller naming the store, so there is nothing to fall back to and a
    // store that cannot answer is `ok: false` rather than an empty detail.
    if (filePath && filePath.endsWith('.sqlite')) {
      const answer = this.readDbSessionDetail(filePath, parsed.fileId, sessionId);
      return answer.kind === 'detail'
        ? detailOk(answer.detail, answer.warnings)
        : answer.kind === 'failed'
          ? detailFailed(answer.code, answer.detail)
          : detailOk({ toolHistory: [], messages: [] });
    }

    // Without one, the agent's own database is tried and then the legacy JSONL,
    // so the two are combined rather than cascaded: a database that will not open
    // used to fall through to the legacy scan and out as an empty detail, which is
    // how audit instance 8's corrupt `openclaw-agent.sqlite` read as "this session
    // has no messages".
    const sources: DetailSource[] = [];

    if (!filePath || !filePath.endsWith('.jsonl')) {
      // The `agents/` root is what makes the id-only lookup possible at all, so a
      // root that cannot be listed fails the lookup — the same rule the listing
      // applies to it, and the same code.
      if (fs.existsSync(AGENTS_DIR) && readAgentDirs('getSessionDetail') === null) {
        return detailFailed('root-unreadable', sourceDetail('agents directory could not be listed', OPENCLAW_DIR));
      }
      const database = findAgentDatabase(parsed.agentId);
      if (database) {
        const answer = this.readDbSessionDetail(database.dbPath, parsed.fileId, sessionId);
        if (answer.kind === 'detail' && (answer.detail.toolHistory.length || answer.detail.messages.length)) {
          return detailOk(answer.detail, answer.warnings);
        }
        // Content-less or failed: the legacy scan below is still consulted, so this
        // is carried as a source and decides only whether the legacy scan failing to
        // answer leaves a `warning` or an `ok: false`.
        if (answer.kind === 'failed') sources.push(answer);
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
      sources.push({
        kind: 'detail',
        detail: {
          toolHistory: await getToolHistory(target),
          messages: await getRecentMessages(target),
          sessionId,
        },
        warnings: [],
      });
    }

    return combineDetailSources(sources);
  }

  /**
   * One agent database, for ONE session, classified.
   *
   * It used to answer `{ toolHistory: [], messages: [] }` for a database that would
   * not open AND for one with no `transcript_events` table, which is the collapse
   * this contract removes. `openReadonlySqlite` plus `hasTableOrNull` plus an
   * explicit `close` rather than `withReadonlySqlite`, whose `null` cannot tell
   * "would not open" from "the callback threw".
   *
   * | branch | state |
   * |---|---|
   * | the file is not there | `absent` |
   * | will not open, or `sqlite_master` will not answer | `failed` / `store-unreadable` |
   * | no `transcript_events` table | `failed` / `schema-incompatible` |
   * | the events query raised | `failed` / `unknown` — one session, one store, no other half |
   */
  private readDbSessionDetail(dbPath: string, rawSessionId: string, sessionId: string): DetailSource {
    if (!fs.existsSync(dbPath)) return { kind: 'absent' };

    const db = openReadonlySqlite(dbPath, 'openclaw');
    if (!db) return { kind: 'failed', code: 'store-unreadable', detail: sourceDetail('agent database would not open', OPENCLAW_DIR) };

    try {
      const hasEvents = hasTableOrNull(db, 'transcript_events');
      if (hasEvents === null) {
        return { kind: 'failed', code: 'store-unreadable', detail: sourceDetail('agent database is not a readable database', OPENCLAW_DIR) };
      }
      if (!hasEvents) {
        return { kind: 'failed', code: 'schema-incompatible', detail: sourceDetail('agent database has no transcript_events table', OPENCLAW_DIR) };
      }

      let rows: Array<{ event_json: string | null; event_zstd: Buffer | null }>;
      try {
        rows = db
          .prepare('SELECT event_json, event_zstd FROM transcript_events WHERE session_id = ? ORDER BY seq DESC LIMIT ?')
          .all(rawSessionId, 200) as Array<{ event_json: string | null; event_zstd: Buffer | null }>;
      } catch (err) {
        debugAdapterError('openclaw', 'readDbSessionDetail events', err, dbPath);
        return { kind: 'failed', code: 'unknown', detail: sourceDetail('agent database events read failed', OPENCLAW_DIR) };
      }

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
        kind: 'detail',
        detail: {
          toolHistory: toolHistory.slice(-15),
          messages: messages.slice(-5),
          tokenUsage,
          sessionId,
        },
        warnings: [],
      };
    } finally {
      closeSqlite(db);
    }
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

