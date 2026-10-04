/**
 * OpenAI Codex CLI adapter
 * Data source: ~/.codex/
 *
 * Session rollout format (JSONL):
 *   {"type":"session_meta","payload":{"id":"...","cwd":"/path","cli_version":"..."}}
 *   {"type":"response_item","payload":{"type":"function_call","name":"shell","arguments":"ls"}}
 *   {"type":"response_item","payload":{"type":"message","role":"assistant","content":[...]}}
 *   {"type":"event_msg","payload":{"type":"turn_complete","usage":{...}}}
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

import type { AdapterDetailResult, AdapterSessionsResult, AgentAdapter, WatchPath } from '../../shared/types.js';
import { debugAdapterError, readLines, parseJsonLines, collectJsonl, foldJsonl } from './jsonl-utils.js';
import { extractText } from './text-utils.js';
import { combineSources, degradedWarnings, detailFailed, detailOk, emptyDetail, sourceDetail } from './sources.js';
import type { Dirent } from './scan-utils.js';

const CODEX_DIR = path.join(os.homedir(), '.codex');
const SESSIONS_DIR = path.join(CODEX_DIR, 'sessions');

// ─── Utility ─────────────────────────────────────────────

// ─── Rollout parsing ──────────────────────────────────────

/**
 * Extract session meta/tools/messages from Codex rollout JSONL
 * Actual format: all data is inside entry.payload
 */
async function parseRollout(filePath: string) {
  const detail: {
    model: string | null;
    project: string | null;
    lastTool: string | null;
    lastToolInput: string | null;
    lastMessage: string | null;
  } = {
    model: null,
    project: null,
    lastTool: null,
    lastToolInput: null,
    lastMessage: null,
  };

  // session_meta is on the first line of the file → read first
  const firstLines = await readLines(filePath, { from: 'start', count: 5, scope: 'codex' });
  const firstEntries = parseJsonLines(firstLines, 'codex');
  for (const entry of firstEntries) {
    if (entry.type === 'session_meta' && entry.payload) {
      detail.model = entry.payload.model || null;
      detail.project = entry.payload.cwd || null;
      break;
    }
  }

  // Recent tools/messages are read from end of file
  const lastLines = await readLines(filePath, { from: 'end', count: 50, scope: 'codex' });
  const entries = parseJsonLines(lastLines, 'codex');

  for (const entry of entries) {
    const payload = entry.payload;
    if (!payload) continue;

    // response_item
    if (entry.type === 'response_item') {
      // Tool usage (function_call)
      if (!detail.lastTool && (payload.type === 'function_call' || payload.type === 'command_execution')) {
        detail.lastTool = payload.name || payload.type;
        if (payload.arguments) {
          detail.lastToolInput = (typeof payload.arguments === 'string'
            ? payload.arguments : JSON.stringify(payload.arguments)
          ).substring(0, 60);
        } else if (payload.command) {
          detail.lastToolInput = payload.command.substring(0, 60);
        }
      }

      // Text message (assistant)
      if (!detail.lastMessage && payload.type === 'message' && payload.role === 'assistant') {
        const text = extractText(payload.content);
        if (text) {
          detail.lastMessage = text.substring(0, 80);
        }
      }
    }

    // If model is missing, try to extract from turn_context or event_msg
    if (!detail.model && entry.type === 'turn_context' && payload.model) {
      detail.model = payload.model;
    }
    if (!detail.model && entry.type === 'event_msg' && payload.model) {
      detail.model = payload.model;
    }
  }

  return detail;
}

type ToolEvent = { tool: string; detail: string; ts: number };

/**
 * Extract tool history from Codex rollout
 */
async function getToolHistory(filePath: string, maxItems = 15) {
  // Forward walk over the same tail window, then the same `slice(-maxItems)`: the
  // oldest entries in the window are still the ones dropped, order intact.
  return collectJsonl<ToolEvent>(filePath, {
    scope: 'codex',
    operation: 'getToolHistory',
    count: 100,
    maxItems,
    onEntry: (entry, out) => {
      if (entry.type !== 'response_item' || !entry.payload) return;
      const payload = entry.payload;
      if (payload.type !== 'function_call' && payload.type !== 'command_execution') return;

      let detail = '';
      if (payload.arguments) {
        detail = (typeof payload.arguments === 'string'
          ? payload.arguments : JSON.stringify(payload.arguments)
        ).substring(0, 80);
      } else if (payload.command) {
        detail = payload.command.substring(0, 80);
      }
      out.push({
        tool: payload.name || payload.type,
        detail,
        ts: entry.timestamp ? new Date(entry.timestamp).getTime() : 0,
      });
    },
  });
}

type ChatMessage = { role: string; text: string; ts: number };

/**
 * Extract recent messages from Codex rollout
 */
async function getRecentMessages(filePath: string, maxItems = 5) {
  return collectJsonl<ChatMessage>(filePath, {
    scope: 'codex',
    operation: 'getRecentMessages',
    count: 60,
    maxItems,
    onEntry: (entry, out) => {
      if (entry.type !== 'response_item' || !entry.payload) return;
      const payload = entry.payload;
      if (payload.type !== 'message') return;

      const role = payload.role || 'assistant';
      let text = '';
      if (typeof payload.content === 'string') {
        text = payload.content;
      } else if (Array.isArray(payload.content)) {
        for (const block of payload.content) {
          if ((block.type === 'output_text' || block.type === 'text') && block.text) {
            text = block.text;
            break;
          }
          if (block.type === 'input_text' && block.text && !block.text.startsWith('<environment_context>')) {
            text = block.text;
            break;
          }
        }
      }
      if (text.trim().length > 0) {
        out.push({
          role,
          text: text.trim().substring(0, 200),
          ts: entry.timestamp ? new Date(entry.timestamp).getTime() : 0,
        });
      }
    },
  });
}

/**
 * Scan rollout files from recent date directories
 */
type ScanResult = { filePath: string; mtime: number; fileName: string };

type ScanOutcome = {
  records: ScanResult[];
  /** `sessions/` itself could not be listed: a whole-adapter failure. */
  rootUnreadable: boolean;
  /** A year / month / day directory could not be listed: one per-ITEM loss. */
  levelsUnreadable: number;
  /** A rollout file could not be stat-ed: one per-ITEM loss. */
  filesUnstattable: number;
};

/**
 * The walk down `sessions/YYYY/MM/DD/`, plus the three failure scopes.
 *
 * Codex nests three levels and each level has its own `readdir` catch, so the
 * audit's collapse applied three times over: a `sessions/` that cannot be listed,
 * a year that cannot be listed and a day that cannot be listed all produced the
 * same partial-or-empty array, each reported only through `debugAdapterError`
 * (a no-op unless `DEBUG` is set).
 *
 * The split is the contract's, not a guess. The ROOT is the provider's session
 * directory, so failing it means the provider could not be read at all and is
 * `ok: false`. Anything below it is one bucket of a deep tree whose siblings were
 * listed and are still here, so it is a per-ITEM `warning` — reporting it as a
 * whole-adapter failure is the regression this design exists to prevent.
 */
async function scanRecentRollouts(activeThresholdMs: number): Promise<ScanOutcome> {
  const results: ScanResult[] = [];
  const failure = { rootUnreadable: false, levelsUnreadable: 0, filesUnstattable: 0 };
  if (!fs.existsSync(SESSIONS_DIR)) return { records: results, ...failure };

  const now = Date.now();

  try {
    // Iterate YYYY directories
    const years = (await fs.promises.readdir(SESSIONS_DIR, { withFileTypes: true }))
      .filter((d: Dirent) => d.isDirectory())
      .map((d: Dirent) => d.name)
      .sort()
      .reverse()
      .slice(0, 3); // Last 3 years — mtime filter handles cutoff

    const yearResults = await Promise.all(years.map(async (year: string) => {
      const yearDir = path.join(SESSIONS_DIR, year);
      try {
        const months = (await fs.promises.readdir(yearDir, { withFileTypes: true }))
          .filter((d: Dirent) => d.isDirectory())
          .map((d: Dirent) => d.name)
          .sort()
          .reverse()
          .slice(0, 6); // Last 6 months — mtime filter handles cutoff

        const monthResults = await Promise.all(months.map(async (month: string) => {
          const monthDir = path.join(yearDir, month);
          try {
            const days = (await fs.promises.readdir(monthDir, { withFileTypes: true }))
              .filter((d: Dirent) => d.isDirectory())
              .map((d: Dirent) => d.name)
              .sort()
              .reverse()
              .slice(0, 14); // Last 14 days — mtime filter handles cutoff

            const dayResults = await Promise.all(days.map(async (day: string) => {
              const dayDir = path.join(monthDir, day);
              try {
                const rolloutFiles = (await fs.promises.readdir(dayDir, { withFileTypes: true }))
                  .filter((d: Dirent) => d.isFile() && d.name.startsWith('rollout-') && d.name.endsWith('.jsonl'));
                const fileResults = await Promise.all(rolloutFiles.map(async (file: Dirent): Promise<ScanResult | null> => {
                  const filePath = path.join(dayDir, file.name);
                  try {
                    const stat = await fs.promises.stat(filePath);
                    if (now - stat.mtimeMs > activeThresholdMs) return null;
                    return { filePath, mtime: stat.mtimeMs, fileName: file.name };
                  } catch (err) {
                    debugAdapterError('codex', 'scanRecentRollouts stat', err, filePath);
                    failure.filesUnstattable += 1;
                    return null;
                  }
                }));
                return fileResults.filter((result): result is ScanResult => result !== null);
              } catch (err) {
                debugAdapterError('codex', 'scanRecentRollouts readdir day', err, dayDir);
                failure.levelsUnreadable += 1;
                return [];
              }
            }));

            return dayResults.flat() as ScanResult[];
          } catch (err) {
            debugAdapterError('codex', 'scanRecentRollouts readdir month', err, monthDir);
            failure.levelsUnreadable += 1;
            return [];
          }
        }));

        return monthResults.flat() as ScanResult[];
      } catch (err) {
        debugAdapterError('codex', 'scanRecentRollouts readdir year', err, yearDir);
        failure.levelsUnreadable += 1;
        return [];
      }
    }));

    for (const group of yearResults) {
      results.push(...group);
    }
  } catch (err) {
    debugAdapterError('codex', 'scanRecentRollouts', err, SESSIONS_DIR);
    failure.rootUnreadable = true;
  }

  return { records: results, ...failure };
}

type TokenReading = { input: number; output: number };
type TokenFold = { thread: TokenReading | null; fallback: TokenReading | null };

/**
 * Extract cumulative token usage from a rollout.
 * Newer rollouts carry `payload.thread_token_usage` (exact session total);
 * older ones only have `event_msg`/`token_count` → `payload.info.total_token_usage`.
 *
 * The walk is NEWEST-FIRST (`reverse: true`) and always has been, so the first
 * `thread_token_usage` met is the LAST one in the file. `from` keeps its `'end'`
 * default, which is the window this read before. Do NOT copy this direction into
 * `parseRollout`: that walk is forward, and reversing it would report tool_19 /
 * msg 8 instead of tool_00 / msg 1 on every session row.
 */
async function getTokenUsage(filePath: string) {
  const fold = await foldJsonl<TokenFold>(filePath, {
    scope: 'codex',
    operation: 'getTokenUsage',
    count: 300,
    reverse: true,
    init: { thread: null, fallback: null },
    onEntry: (acc, entry) => {
      const payload = entry?.payload;
      if (!payload) return;

      const thread = payload.thread_token_usage;
      if (thread && typeof thread.input_tokens === 'number') {
        // `until` below stands in for the return the old loop did from in here;
        // returning from `onEntry` keeps this entry's total check from running.
        acc.thread = {
          input: Number(thread.input_tokens || 0),
          output: Number(thread.output_tokens || 0),
        };
        return;
      }

      // `until` is consulted after `onEntry`, never before, so this line can
      // remember a total met on the way and still stop at an older thread reading.
      const total = payload.info?.total_token_usage;
      if (!acc.fallback && total && typeof total.input_tokens === 'number') {
        acc.fallback = {
          input: Number(total.input_tokens || 0),
          output: Number(total.output_tokens || 0),
        };
      }
    },
    until: (acc) => acc.thread !== null,
  });
  return fold.thread ?? fold.fallback;
}

// ─── Adapter class ────────────────────────────────────

export class CodexAdapter implements AgentAdapter {
  get name() { return 'Codex CLI'; }
  get provider() { return 'codex'; }
  get homeDir() { return CODEX_DIR; }

  isAvailable() {
    return fs.existsSync(CODEX_DIR);
  }

  async getActiveSessions(activeThresholdMs: number): Promise<AdapterSessionsResult> {
    const { records, rootUnreadable, levelsUnreadable, filesUnstattable } = await scanRecentRollouts(activeThresholdMs);
    const sessions = await Promise.all(records.map(async ({ filePath, mtime, fileName }) => {
      const detail = await parseRollout(filePath);
      // Extract session ID from filename: rollout-2025-01-22T10-30-00-abc123.jsonl
      const sessionId = fileName.replace('rollout-', '').replace('.jsonl', '');

      return {
        sessionId: `codex-${sessionId}`,
        provider: 'codex',
        agentId: null,
        agentType: 'main',
        model: detail.model || 'codex',
        status: 'active',
        lastActivity: mtime,
        project: detail.project || null,
        lastMessage: detail.lastMessage,
        lastTool: detail.lastTool,
        lastToolInput: detail.lastToolInput,
        parentSessionId: null,
        filePath,
      };
    }));

    return combineSources([
      rootUnreadable
        ? { kind: 'failed', code: 'root-unreadable', detail: sourceDetail('sessions directory could not be listed', CODEX_DIR) }
        : {
          kind: 'rows',
          sessions: sessions.sort((a, b) => b.lastActivity - a.lastActivity),
          warnings: [
            ...degradedWarnings(levelsUnreadable, 'root-unreadable', 'date directory(ies)'),
            ...degradedWarnings(filesUnstattable, 'root-unreadable', 'rollout file(s)'),
          ],
        },
    ]);
  }

  async getSessionDetail(sessionId: string, project: string | null, filePath: string | null = null): Promise<AdapterDetailResult> {
    if (filePath) {
      const [toolHistory, messages, tokenUsage] = await Promise.all([
        getToolHistory(filePath),
        getRecentMessages(filePath),
        getTokenUsage(filePath),
      ]);
      return detailOk({ toolHistory, messages, tokenUsage, sessionId });
    }

    // Find file from sessionId
    const cleanId = sessionId.replace('codex-', '');
    const { records, rootUnreadable, levelsUnreadable, filesUnstattable } = await scanRecentRollouts(30 * 60 * 1000); // Expand to 30 min range

    // A `sessions/` that could not be listed is not a session that does not exist.
    // Before the union both arrived as the empty detail, so an unreadable rollout
    // store and a session with no rollout file were one answer.
    if (rootUnreadable) {
      return detailFailed('root-unreadable', sourceDetail('sessions directory could not be listed', CODEX_DIR));
    }
    // A date directory or rollout file the scan could not read leaves the search
    // incomplete without making it worthless: the siblings were searched, so this is
    // a warning and whatever the search found stands.
    const incomplete = degradedWarnings(levelsUnreadable, 'root-unreadable', 'date directory(ies)')
      .concat(degradedWarnings(filesUnstattable, 'root-unreadable', 'rollout file(s)'));

    for (const { filePath, fileName } of records) {
      const fileId = fileName.replace('rollout-', '').replace('.jsonl', '');
      if (fileId === cleanId) {
        const [toolHistory, messages, tokenUsage] = await Promise.all([
          getToolHistory(filePath),
          getRecentMessages(filePath),
          getTokenUsage(filePath),
        ]);
        return detailOk({ toolHistory, messages, tokenUsage, sessionId }, incomplete);
      }
    }

    return detailOk(emptyDetail(), incomplete);
  }

  getWatchPaths(): WatchPath[] {
    const paths: WatchPath[] = [];
    if (fs.existsSync(SESSIONS_DIR)) {
      paths.push({ type: 'directory', path: SESSIONS_DIR, recursive: true, filter: '.jsonl' });
    }
    return paths;
  }
}
