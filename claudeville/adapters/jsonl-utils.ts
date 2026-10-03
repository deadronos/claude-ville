/**
 * Shared JSONL file utilities.
 * `readLines` + `parseJsonLines` were duplicated across the adapters and were
 * extracted here (1d80b24); all eight JSONL-reading adapters now import both
 * from this module, `opencode` excepted. See `readJsonlEntries` below.
 */
import fs from 'fs';

type ReadLinesOptions = {
  from?: 'start' | 'end';
  count?: number;
  scope?: string;
};

export function debugAdapterError(scope: string, operation: string, err: unknown, context = '') {
  if (!process.env.DEBUG) return;

  const message = err instanceof Error ? err.message : String(err);
  const suffix = context ? ` ${context}` : '';
  console.debug(`[${scope}] ${operation}${suffix}: ${message}`);
}

/**
 * Read the last N (or first N) lines of a file as strings.
 * Uses reverse seek for tail reads to avoid loading the entire file into memory.
 */
export async function readLines(filePath: string, { from = 'end', count = 50, scope = 'jsonl-utils' }: ReadLinesOptions = {}) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const stat = await fs.promises.stat(filePath);
    if (stat.size === 0) return [];

    if (from === 'start') {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      return lines.slice(0, count);
    }

    // Tail read: use reverse seek to avoid loading entire file
    const fd = await fs.promises.open(filePath, 'r');
    try {
      const bufs: Buffer[] = [];
      const READ_SIZE = 8192;
      let position = stat.size;

      while (bufs.reduce((acc, b) => acc + b.length, 0) < stat.size && (position > 0 || bufs.length === 0)) {
        const chunkSize = Math.min(READ_SIZE, position);
        position -= chunkSize;
        const buf = Buffer.alloc(chunkSize);
        await fd.read(buf, 0, chunkSize, position);
        bufs.unshift(buf);
      }

      const content = Buffer.concat(bufs).toString('utf-8');
      const lines = content.trim().split('\n');
      return lines.slice(-count);
    } finally {
      await fd.close();
    }
  } catch (err) {
    debugAdapterError(scope, `readLines(${from})`, err, filePath);
    return [];
  }
}

/**
 * Parse an array of JSONL strings into objects, skipping bad lines.
 */
export function parseJsonLines(lines: string[], scope = 'jsonl-utils') {
  const results: any[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { results.push(JSON.parse(line)); } catch (err) {
      debugAdapterError(scope, 'parseJsonLines', err, line.substring(0, 120));
    }
  }
  return results;
}

/**
 * Read + parse in one step. Eight of the nine adapters call this pair back to
 * back — `claude`, `codex`, `copilot`, `gemini`, `hermes`, `openclaw`, `pi`,
 * `vscode` — and this is where that pairing is expressed once. `opencode` is
 * the exception and never calls either: it stores whole `.json` documents, so
 * it reads them with its own `readJson` (`opencode.ts:58`) and takes its index
 * from SQLite rather than from a JSONL stream.
 */
export async function readJsonlEntries(
  filePath: string,
  { from = 'end', count = 50, scope = 'jsonl-utils' }: { from?: 'start' | 'end'; count?: number; scope?: string } = {},
) {
  return parseJsonLines(await readLines(filePath, { from, count, scope }), scope);
}

/**
 * Read a JSONL file, fold each entry through `onEntry`, and keep the last
 * `maxItems`. Swallows and debug-logs read/parse/fold errors, returning
 * whatever was accumulated — the contract every adapter's getToolHistory /
 * getRecentMessages already had.
 *
 * `maxItems` is applied as a real limit: `0` or a negative value returns an
 * empty array rather than the whole file. Omit it (or pass `undefined`) to keep
 * every entry.
 */
export async function collectJsonl<T>(
  filePath: string,
  {
    scope,
    operation,
    from = 'end',
    count = 50,
    maxItems,
    onEntry,
  }: {
    scope: string;
    operation: string;
    from?: 'start' | 'end';
    count?: number;
    maxItems?: number;
    onEntry: (entry: any, out: T[]) => void;
  },
): Promise<T[]> {
  const out: T[] = [];
  try {
    for (const entry of await readJsonlEntries(filePath, { from, count, scope })) {
      onEntry(entry, out);
    }
  } catch (err) {
    debugAdapterError(scope, operation, err, filePath);
  }
  if (typeof maxItems !== 'number') return out;
  return maxItems <= 0 ? [] : out.slice(-maxItems);
}
