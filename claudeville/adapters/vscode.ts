/**
 * VS Code / VS Code Insiders Copilot Chat adapter
 * Data source:
 *   ~/Library/Application Support/Code/User/workspaceStorage/<workspaceId>/GitHub.copilot-chat/debug-logs/<sessionId>/main.jsonl
 *   ~/Library/Application Support/Code - Insiders/User/workspaceStorage/<workspaceId>/GitHub.copilot-chat/debug-logs/<sessionId>/main.jsonl
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

import type { AdapterDetailResult, AdapterSessionsResult, AgentAdapter, WatchPath } from '../../shared/types.js';
import { debugAdapterError } from './jsonl-utils.js';
import { parseSession, hasRealActivity, getToolHistory, getRecentMessages, getTokenUsage } from './vscode-readers.js';
import type { Dirent } from './scan-utils.js';
import { combineSources, degradedWarnings, detailFailed, detailOk, emptyDetail, sourceDetail, type SourceListing } from './sources.js';

const VSCODE_USER_DIR = process.env.VSCODE_USER_DATA_DIR
  || path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User');
const VSCODE_INSIDERS_USER_DIR = process.env.VSCODE_INSIDERS_USER_DATA_DIR
  || path.join(os.homedir(), 'Library', 'Application Support', 'Code - Insiders', 'User');
const VSCODE_CURSOR_DIR = process.env.VSCODE_CURSOR_USER_DATA_DIR
  || path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User');
const VSCODE_OFFSET_DIR = process.env.VSCODE_OFFSET_USER_DATA_DIR
  || path.join(os.homedir(), 'Library', 'Application Support', 'Offset', 'User');

const STORAGE_ROOTS = [
  { channel: 'vscode', workspaceStorageDir: path.join(VSCODE_USER_DIR, 'workspaceStorage') },
  { channel: 'vscode-insiders', workspaceStorageDir: path.join(VSCODE_INSIDERS_USER_DIR, 'workspaceStorage') },
  { channel: 'cursor', workspaceStorageDir: path.join(VSCODE_CURSOR_DIR, 'workspaceStorage') },
  { channel: 'offset', workspaceStorageDir: path.join(VSCODE_OFFSET_DIR, 'workspaceStorage') },
].filter(root => root.workspaceStorageDir);


const DEFAULT_MIN_ACTIVE_WINDOW_MS = 30 * 60 * 1000;
const MIN_ACTIVE_WINDOW_MS = Math.max(
  60 * 1000,
  Number(process.env.VSCODE_ACTIVE_WINDOW_MS || DEFAULT_MIN_ACTIVE_WINDOW_MS)
);

const SOURCE_PRIORITY = {
  debug: 3,
  transcript: 2,
  resource: 1,
};

type ResourceSessionCandidate = {
  channel: string;
  workspaceId: string;
  rawSessionId: string;
  sourceType: 'debug' | 'transcript' | 'resource';
  filePath: string;
  project: string;
  mtime: number;
  tokens: { input: number; output: number } | null;
};

function shouldReplaceCandidate(existing: { sourceType: string; mtime: number } | null | undefined, incoming: { sourceType: string; mtime: number } | null | undefined): boolean {
  if (!existing) return true;
  if (!incoming) return false;
  const existingPriority = SOURCE_PRIORITY[existing.sourceType as keyof typeof SOURCE_PRIORITY] || 0;
  const incomingPriority = SOURCE_PRIORITY[incoming.sourceType as keyof typeof SOURCE_PRIORITY] || 0;

  if (incomingPriority > existingPriority) return true;
  if (incomingPriority < existingPriority) return false;

  return incoming.mtime > existing.mtime;
}

async function readWorkspacePath(workspaceDir: string): Promise<string | null> {
  const workspaceFile = path.join(workspaceDir, 'workspace.json');
  if (!fs.existsSync(workspaceFile)) return null;

  try {
    const raw = await fs.promises.readFile(workspaceFile, 'utf-8');
    const json = JSON.parse(raw);

    const uri = json.folder || json.workspace || null;
    if (typeof uri === 'string' && uri.startsWith('file://')) {
      return decodeURIComponent(uri.replace('file://', ''));
    }
  } catch (err) {
    debugAdapterError('vscode', 'readWorkspacePath', err, workspaceFile);
  }

  return null;
}

function buildSessionId(channel: string, workspaceId: string, debugLogId: string) {
  return `vscode:${channel}:${workspaceId}:${debugLogId}`;
}

function parseSessionId(sessionId: string): { channel: string; workspaceId: string; debugLogId: string } | null {
  if (!sessionId.startsWith('vscode:')) return null;
  const parts = sessionId.split(':');
  if (parts.length < 4) return null;
  return {
    channel: parts[1],
    workspaceId: parts[2],
    debugLogId: parts.slice(3).join(':'),
  };
}

/**
 * One storage root's read outcome. `workspaceStorage` is VS Code's own state, not
 * a ClaudeVille store, and it is routinely missing on a machine that has never
 * opened a folder in that editor — so "this root has no `workspaceStorage`" is
 * ABSENCE (a fact about the install), and only a root that EXISTS and cannot be
 * listed is a failure.
 */
type RootRead = { channel: string; workspaceStorageDir: string; unreadable: boolean };

/**
 * The scan, plus the two failure scopes.
 *
 * VS Code fans out over up to four storage roots and three directories under each
 * (`debug-logs`, `transcripts`, `chat-session-resources`), and every one of those
 * `readdir` catches answered `[]` — reported only through `debugAdapterError`,
 * which is a no-op unless `DEBUG` is set. That made a locked workspace directory
 * indistinguishable from a workspace with no chat sessions in it (audit instance
 * 19's mechanism, at directory scale).
 *
 * The split follows the tree. A STORAGE ROOT that cannot be listed is a
 * whole-adapter failure for that channel — nothing under it was looked at — and
 * since `isAvailable()` accepts a provider when ANY root is present, the provider
 * itself fails only when every present root failed. A directory one or two levels
 * below is a per-ITEM loss whose siblings were listed and survive, so it is a
 * `warning`.
 */
async function scanAllSessions(activeThresholdMs: number): Promise<{ records: ResourceSessionCandidate[]; roots: RootRead[]; dirsUnreadable: number }> {
  const now = Date.now();
  const effectiveThresholdMs = Math.max(Number(activeThresholdMs || 0), MIN_ACTIVE_WINDOW_MS);
  const results: ResourceSessionCandidate[] = [];
  let dirsUnreadable = 0;

  const roots: RootRead[] = STORAGE_ROOTS.map((root) => ({
    channel: root.channel,
    workspaceStorageDir: root.workspaceStorageDir,
    unreadable: false,
  }));

  for (const root of roots) {
    if (!fs.existsSync(root.workspaceStorageDir)) continue;

    let workspaceDirs: Dirent[] = [];
    try {
      workspaceDirs = await fs.promises.readdir(root.workspaceStorageDir, { withFileTypes: true });
    } catch (err) {
      debugAdapterError('vscode', 'scanAllSessions readdir workspaceStorage', err, root.workspaceStorageDir);
      root.unreadable = true;
      continue;
    }

    const entries = await Promise.all(workspaceDirs
      .filter((d: Dirent) => d.isDirectory())
      .map(async (workspaceDir: Dirent): Promise<ResourceSessionCandidate[]> => {
        const workspaceId = workspaceDir.name;
        const workspacePath = path.join(root.workspaceStorageDir, workspaceId);
        const copilotChatDir = path.join(workspacePath, 'GitHub.copilot-chat');
        if (!fs.existsSync(copilotChatDir)) return [];

        const workspaceProject = await readWorkspacePath(workspacePath);
        const candidates: ResourceSessionCandidate[] = [];

        // legacy/new debug logs
        const debugLogsDir = path.join(copilotChatDir, 'debug-logs');
        if (fs.existsSync(debugLogsDir)) {
          let debugLogDirs: Dirent[] = [];
          try {
            debugLogDirs = await fs.promises.readdir(debugLogsDir, { withFileTypes: true });
          } catch (err) {
            debugAdapterError('vscode', 'scanAllSessions readdir debug-logs', err, debugLogsDir);
            dirsUnreadable += 1;
            debugLogDirs = [];
          }

          const debugEntries = await Promise.all(debugLogDirs
            .filter((d: Dirent) => d.isDirectory())
            .map(async (logDir: Dirent): Promise<ResourceSessionCandidate | null> => {
              const mainLogFile = path.join(debugLogsDir, logDir.name, 'main.jsonl');
              if (!fs.existsSync(mainLogFile)) return null;

              try {
                const stat = await fs.promises.stat(mainLogFile);
                if (now - stat.mtimeMs > effectiveThresholdMs) return null;
                // Filter out blank new-chat tabs (opened but never used)
                if (!(await hasRealActivity(mainLogFile))) return null;
                return {
                  channel: root.channel,
                  workspaceId,
                  rawSessionId: logDir.name,
                  sourceType: 'debug',
                  filePath: mainLogFile,
                  project: workspaceProject || `vscode:${root.channel}:${workspaceId}`,
                  mtime: stat.mtimeMs,
                  tokens: (await parseSession(mainLogFile)).tokens,
                };
              } catch (err) {
                debugAdapterError('vscode', 'scanAllSessions stat debug log', err, mainLogFile);
                return null;
              }
            }));

          candidates.push(...debugEntries.filter((item): item is ResourceSessionCandidate => item !== null));
        }

        // transcript jsonl
        const transcriptsDir = path.join(copilotChatDir, 'transcripts');
        if (fs.existsSync(transcriptsDir)) {
          let transcriptFiles: Dirent[] = [];
          try {
            transcriptFiles = await fs.promises.readdir(transcriptsDir, { withFileTypes: true });
          } catch (err) {
            debugAdapterError('vscode', 'scanAllSessions readdir transcripts', err, transcriptsDir);
            dirsUnreadable += 1;
            transcriptFiles = [];
          }

          const transcriptEntries = await Promise.all(transcriptFiles
            .filter((d: Dirent) => d.isFile() && d.name.endsWith('.jsonl'))
            .map(async (file: Dirent): Promise<ResourceSessionCandidate | null> => {
              const transcriptPath = path.join(transcriptsDir, file.name);
              try {
                const stat = await fs.promises.stat(transcriptPath);
                if (now - stat.mtimeMs > effectiveThresholdMs) return null;
                if (!(await hasRealActivity(transcriptPath))) return null;

                return {
                  channel: root.channel,
                  workspaceId,
                  rawSessionId: file.name.replace('.jsonl', ''),
                  sourceType: 'transcript',
                  filePath: transcriptPath,
                  project: workspaceProject || `vscode:${root.channel}:${workspaceId}`,
                  mtime: stat.mtimeMs,
                  tokens: (await parseSession(transcriptPath)).tokens,
                };
              } catch (err) {
                debugAdapterError('vscode', 'scanAllSessions stat transcript', err, transcriptPath);
                return null;
              }
            }));

          candidates.push(...transcriptEntries.filter((item): item is ResourceSessionCandidate => item !== null));
        }

        // live chat resources (often newest while a turn is running)
        const resourcesDir = path.join(copilotChatDir, 'chat-session-resources');
        if (fs.existsSync(resourcesDir)) {
          let sessionDirs: Dirent[] = [];
          try {
            sessionDirs = await fs.promises.readdir(resourcesDir, { withFileTypes: true });
          } catch (err) {
            debugAdapterError('vscode', 'scanAllSessions readdir resources', err, resourcesDir);
            dirsUnreadable += 1;
            sessionDirs = [];
          }

          const resourceEntries = await Promise.all(sessionDirs
            .filter((d: Dirent) => d.isDirectory())
            .map(async (sessionDir: Dirent): Promise<ResourceSessionCandidate | null> => {
              const sessionRoot = path.join(resourcesDir, sessionDir.name);
              let toolDirs: Dirent[] = [];
              try {
                toolDirs = await fs.promises.readdir(sessionRoot, { withFileTypes: true });
              } catch (err) {
                debugAdapterError('vscode', 'scanAllSessions readdir resource session', err, sessionRoot);
                dirsUnreadable += 1;
                return null;
              }

              const statPromises = toolDirs.map(async (td: Dirent) => {
                if (!td.isDirectory()) return null;
                const contentFile = path.join(sessionRoot, td.name, 'content.txt');
                if (!fs.existsSync(contentFile)) return null;
                try {
                  const stat = await fs.promises.stat(contentFile);
                  return { filePath: contentFile, mtime: stat.mtimeMs };
                } catch (err) {
                  debugAdapterError('vscode', 'scanAllSessions stat content', err, contentFile);
                  return null;
                }
              });

              const stats = await Promise.all(statPromises);
              let newest: { filePath: string; mtime: number } | null = null;
              for (const stat of stats) {
                if (stat && (!newest || stat.mtime > newest.mtime)) {
                  newest = stat;
                }
              }

              if (!newest) return null;
              if (now - newest.mtime > effectiveThresholdMs) return null;
              // Filter out blank sessions
              if (!(await hasRealActivity(newest.filePath))) return null;

              return {
                channel: root.channel,
                workspaceId,
                rawSessionId: sessionDir.name,
                sourceType: 'resource',
                filePath: newest.filePath,
                project: workspaceProject || `vscode:${root.channel}:${workspaceId}`,
                mtime: newest.mtime,
                tokens: (await parseSession(newest.filePath)).tokens,
              };
            }));

          candidates.push(...resourceEntries.filter((item): item is ResourceSessionCandidate => item !== null));
        }
        // dedupe by raw session key, keep newest source
        const bySession = new Map<string, ResourceSessionCandidate>();
        for (const item of candidates) {
          const candidate = item;
          if (!candidate) continue;
          const key = `${candidate.channel}:${candidate.workspaceId}:${candidate.rawSessionId}`;
          const existing = bySession.get(key);
          if (shouldReplaceCandidate(existing, candidate ?? null)) {
            bySession.set(key, candidate);
          }
        }

        return Array.from(bySession.values());
      }));

    for (const group of entries) {
      results.push(...group);
    }
  }

  return { records: results, roots, dirsUnreadable };
}

export class VSCodeAdapter implements AgentAdapter {
  get name() { return 'VS Code Copilot Chat'; }
  get provider() { return 'vscode'; }
  // Primary VS Code user dir; the Insiders dir is also scanned (see STORAGE_ROOTS)
  // but homeDir stays a single path for display/consumers.
  get homeDir() { return VSCODE_USER_DIR; }

  isAvailable() {
    return STORAGE_ROOTS.some(root => fs.existsSync(root.workspaceStorageDir));
  }

  async getActiveSessions(activeThresholdMs: number): Promise<AdapterSessionsResult> {
    const { records, roots, dirsUnreadable } = await scanAllSessions(activeThresholdMs);
    const sessions = await Promise.all(records.map(async ({ channel, workspaceId, rawSessionId, filePath, project, mtime }) => {
      const detail = await parseSession(filePath);
      return {
        sessionId: buildSessionId(channel, workspaceId, rawSessionId),
        provider: 'vscode',
        agentId: null,
        agentType: 'main',
        model: detail.model || channel,
        status: 'active',
        lastActivity: mtime,
        project,
        lastMessage: detail.lastMessage,
        lastTool: detail.lastTool,
        lastToolInput: detail.lastToolInput,
        parentSessionId: null,
        filePath,
        tokens: detail.tokens || { input: 0, output: 0 },
      };
    }));

    // One source per PRESENT storage root. A root with no `workspaceStorage` was
    // never installed and is not a failure, so it is not a source at all; a root
    // that exists and cannot be listed is `failed`. When at least one root
    // answered, `combineSources` turns each failed root into a `warning` and keeps
    // the sessions the other roots produced — which is the whole point of the rule,
    // because one locked channel must not blank the other three. With no present
    // root at all the list is empty, which the rule reads as `ok: true` and zero
    // rows: this provider is simply not installed.
    const present = roots.filter((root) => fs.existsSync(root.workspaceStorageDir));
    const failedRoots = present.filter((root) => root.unreadable);
    const sources: SourceListing[] = [];

    if (failedRoots.length < present.length) {
      sources.push({
        kind: 'rows',
        sessions: sessions.sort((a, b) => b.lastActivity - a.lastActivity),
        warnings: degradedWarnings(dirsUnreadable, 'root-unreadable', 'chat director(y/ies)'),
      });
    }
    sources.push(...failedRoots.map((root): SourceListing => ({
      kind: 'failed',
      code: 'root-unreadable',
      detail: sourceDetail(`workspaceStorage could not be listed (${root.channel})`, root.workspaceStorageDir),
    })));

    return combineSources(sources);
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

    const parsed = parseSessionId(sessionId);
    if (!parsed) return detailOk(emptyDetail());

    const { records, roots, dirsUnreadable } = await scanAllSessions(30 * 60 * 1000);

    // The listing's rule, unchanged: a root with no `workspaceStorage` was never
    // installed and is not a source; a root that EXISTS and cannot be listed
    // failed. One locked channel must not blank the other three, so it is only
    // `ok: false` when EVERY present root failed — otherwise the search that did
    // run is reported, with the locked channels as warnings.
    const present = roots.filter((root) => fs.existsSync(root.workspaceStorageDir));
    const failedRoots = present.filter((root) => root.unreadable);
    if (present.length > 0 && failedRoots.length === present.length) {
      return detailFailed('root-unreadable', sourceDetail(`workspaceStorage could not be listed (${failedRoots[0].channel})`, failedRoots[0].workspaceStorageDir));
    }
    const warnings = [
      ...failedRoots.map((root) => ({ code: 'root-unreadable' as const, detail: `workspaceStorage could not be listed (${root.channel})` })),
      ...degradedWarnings(dirsUnreadable, 'root-unreadable', 'chat director(y/ies)'),
    ];

    const found = records.find((s) => (
      s.channel === parsed.channel
      && s.workspaceId === parsed.workspaceId
      && s.rawSessionId === parsed.debugLogId
    ));

    if (!found) return detailOk(emptyDetail(), warnings);

    return detailOk({
      toolHistory: await getToolHistory(found.filePath),
      messages: await getRecentMessages(found.filePath),
      tokenUsage: found.tokens ?? null,
      sessionId,
    }, warnings);
  }

  getWatchPaths(): WatchPath[] {
    const paths: WatchPath[] = [];
    for (const root of STORAGE_ROOTS) {
      if (!fs.existsSync(root.workspaceStorageDir)) continue;
      paths.push({
        type: 'directory',
        path: root.workspaceStorageDir,
        recursive: true,
        filter: '.jsonl',
      });
      paths.push({
        type: 'directory',
        path: root.workspaceStorageDir,
        recursive: true,
        filter: 'content.txt',
      });
    }
    return paths;
  }
}
