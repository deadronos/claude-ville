import type { Session, SessionDetail } from '../../store';

export interface WatchPath {
  path: string;
  recursive: boolean;
}

export interface ProviderAdapterPlugin {
  /** Provider identifier */
  provider: 'claude' | 'codex' | 'gemini' | 'openclaw' | 'copilot' | 'vscode';
  /** Paths to watch for file system events */
  watchPaths(): WatchPath[];
  /** Get all active sessions older than activeThresholdMs */
  getSessions(activeThresholdMs: number): Promise<Session[]>;
  /** Get detailed activity for a specific session */
  getSessionDetail(sessionId: string, projectPath?: string): Promise<SessionDetail>;
}
