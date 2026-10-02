/**
 * Shared JSONL file utilities.
 * readLines + parseJsonLines are duplicated verbatim in openclaw, copilot, codex, vscode.
 * Extract once; adapters import from here.
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
 * Read + parse in one step. All nine adapters use this pair back to back;
 * this is where that pairing is expressed once.
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
  return typeof maxItems === 'number' ? out.slice(-maxItems) : out;
}
