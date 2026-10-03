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
 * Copilot and `pi` are the adapters converted so far. `pi` is what forced
 * `fileFor` to return many paths for one child rather than a single file — it
 * nests project dir → session files — and a throwing callback is therefore
 * reported under `<operation> resolve` rather than the stat/build labels. The
 * rest still carry their own envelope and their scan shapes differ from
 * copilot's materially — some scan two or four directory levels, some group or
 * filter by name, and `opencode` separates discovery from filtering (an
 * unbounded recursive walk, then a separate stat pass) — so do not assume a
 * drop-in fit. The per-adapter differences are listed in
 * `docs/architecture/002-provider-adapters.md`.
 */
import fs from 'fs';
import path from 'path';

import { debugAdapterError } from './jsonl-utils.js';

type Dirent = { name: string; isDirectory(): boolean };

export type ScanCandidate = { name: string; filePath: string; mtimeMs: number };

/**
 * What one child directory contributes: nothing, a single record, or one record
 * per path `fileFor` resolved for it. Only `null` and the single-record case
 * existed before `fileFor` could return many paths; the array case is why the
 * per-child callback cannot be typed `Promise<T | null>`.
 */
type PerChild<T> = T | null | (T | null)[];

export async function collectScanByMtime<T>(
  opts: {
    dir: string;
    scope: string;
    operation: string;
    thresholdMs: number;
    /**
     * Given a child dir name, return the file(s) to stat — one path, or many for
     * an adapter that enumerates files inside each child — or null to skip it.
     *
     * CALLED SYNCHRONOUSLY. An adapter that has to list a directory to answer
     * must do so with `fs.readdirSync`; returning a promise would make the
     * resolved value a Promise, not a path. This keeps the helper free of a
     * second async path, and a sync throw is caught identically.
     *
     * A throwing `fileFor` is caught, logged as `<operation> resolve` with the
     * child directory as context, and confined to that one child — so a failing
     * enumeration cannot take down its siblings.
     */
    fileFor: (name: string) => string | string[] | null;
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
    const built = await Promise.all(children.map(async (child): Promise<PerChild<T>> => {
      let filePaths: string[] | null;
      try {
        const resolved = fileFor(child.name);
        filePaths = resolved === null ? null : Array.isArray(resolved) ? resolved : [resolved];
      } catch (err) {
        debugAdapterError(scope, `${operation} resolve`, err, path.join(dir, child.name));
        return null;
      }
      if (!filePaths || filePaths.length === 0) return null;

      // Annotated rather than cast: Promise.all re-applies Awaited<T>, which TS
      // cannot relate back to the unresolved generic T. The annotation is sound
      // for array-shaped T too — `.flat()` below unwraps only the one level this
      // map introduces (null | (T | null)[] per child), leaving a T that is
      // itself an array intact.
      const perFile: (T | null)[] = await Promise.all(filePaths.map(async (filePath): Promise<T | null> => {
        try {
          const stat = await fs.promises.stat(filePath);
          if (now - stat.mtimeMs > thresholdMs) return null;
          return await build({ name: child.name, filePath, mtimeMs: stat.mtimeMs });
        } catch (err) {
          debugAdapterError(scope, `${operation} stat`, err, filePath);
          return null;
        }
      }));
      return perFile;
    }));
    // readdir order is preserved across children; within a child, the order
    // `fileFor` returned is preserved too. Nothing is sorted or reversed.
    results.push(...built.flat().filter((r): r is T => r !== null));
  } catch (err) {
    debugAdapterError(scope, operation, err, dir);
  }
  return results;
}