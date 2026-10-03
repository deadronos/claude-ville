/**
 * Shared provider-directory scanning.
 *
 * The JSONL-family adapters share a shape: read the provider's session
 * directory, stat each candidate file, drop anything older than an activity
 * threshold, and build a record. `collectScanByMtime` expresses that
 * readdir → stat → mtime-filter → debugAdapterError envelope once; `build`
 * supplies only the format-specific part (which filename to look for, what to
 * put in the record).
 *
 * Copilot is the only adapter converted so far. The rest still carry their own
 * envelope and their scan shapes differ from copilot's materially — some scan
 * two or four directory levels, some group or filter by name, and `opencode`
 * separates discovery from filtering (an unbounded recursive walk, then a
 * separate stat pass) — so do not assume a drop-in fit. The per-adapter
 * differences are listed in `docs/architecture/002-provider-adapters.md`.
 */
import fs from 'fs';

import { debugAdapterError } from './jsonl-utils.js';

type Dirent = { name: string; isDirectory(): boolean };

export type ScanCandidate = { name: string; filePath: string; mtimeMs: number };

export async function collectScanByMtime<T>(
  opts: {
    dir: string;
    scope: string;
    operation: string;
    thresholdMs: number;
    /** Given a child dir name, return the file to stat, or null to skip it. */
    fileFor: (name: string) => string | null;
    /** Build the record for a candidate that passed the mtime filter. */
    build: (candidate: ScanCandidate) => Promise<T | null> | T | null;
  },
): Promise<T[]> {
  const { dir, scope, operation, thresholdMs, fileFor, build } = opts;
  const results: T[] = [];
  if (!fs.existsSync(dir)) return results;

  const now = Date.now();
  try {
    const children = (await fs.promises.readdir(dir, { withFileTypes: true }))
      .filter((d: Dirent) => d.isDirectory());
    const built = await Promise.all(children.map(async (child) => {
      const filePath = fileFor(child.name);
      if (!filePath) return null;
      try {
        const stat = await fs.promises.stat(filePath);
        if (now - stat.mtimeMs > thresholdMs) return null;
        return await build({ name: child.name, filePath, mtimeMs: stat.mtimeMs });
      } catch (err) {
        debugAdapterError(scope, `${operation} stat`, err, filePath);
        return null;
      }
    // Promise.all's mapped type re-applies Awaited<T>, which TS cannot relate
    // back to the unresolved generic T. Every call site passes a plain record
    // type, for which the two are identical.
    })) as (T | null)[];
    results.push(...built.filter((r): r is T => r !== null));
  } catch (err) {
    debugAdapterError(scope, operation, err, dir);
  }
  return results;
}