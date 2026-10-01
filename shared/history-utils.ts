export interface HistoryMessage {
  role?: string;
  text?: string;
  ts?: number;
}

export interface HistorySource {
  provider: string;
  sessionId: string;
  project?: string | null;
  messages?: HistoryMessage[] | null;
}

export interface HistoryEntry {
  provider: string;
  sessionId: string;
  project: string | null;
  role: string;
  text: string;
  ts: number;
}

export function flattenHistoryEntries(
  sources: Iterable<HistorySource>,
  limit = 100,
): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  for (const source of sources) {
    for (const message of source.messages || []) {
      if (!message || !message.text) continue;
      entries.push({
        provider: source.provider,
        sessionId: source.sessionId,
        project: source.project ?? null,
        role: message.role || 'assistant',
        text: message.text,
        ts: message.ts || 0,
      });
    }
  }
  entries.sort((a, b) => a.ts - b.ts);
  return entries.slice(-limit);
}
