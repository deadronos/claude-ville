import fs from 'fs';

/**
 * Watch an array of watch-path objects and call onChange whenever any of them change.
 * Handles both file and directory watch paths. Directories support recursive watching
 * and optional filename filtering (e.g. only .jsonl files).
 *
 * @param {Array<{path: string, type: 'file'|'directory', filter?: string, recursive?: boolean}>} watchPaths
 * @param {Function} onChange  - Called with no arguments when a watched path changes
 * @param {number} [debounceMs=200]  - Debounce delay
 * @returns {{ watchCount: number, watchers: fs.FSWatcher[], close: () => void }}
 */
export function createFileWatchers(watchPaths, onChange, debounceMs = 200) {
  let watchCount = 0;
  let timer = null;
  let closed = false;
  const watchers = [];

  function scheduleChange() {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!closed) onChange();
    }, debounceMs);
  }

  for (const wp of watchPaths) {
    try {
      if (wp.type === 'file') {
        if (!fs.existsSync(wp.path)) continue;
        const watcher = fs.watch(wp.path, (eventType) => {
          if (eventType === 'change') {
            scheduleChange();
          }
        });
        watchers.push(watcher);
        watchCount++;
      } else if (wp.type === 'directory') {
        if (!fs.existsSync(wp.path)) continue;
        const watcher = fs.watch(wp.path, { recursive: wp.recursive || false }, (_eventType, filename) => {
          if (wp.filter && filename && !filename.endsWith(wp.filter)) return;
          scheduleChange();
        });
        watchers.push(watcher);
        watchCount++;
      }
    } catch (err) {
      console.warn(`[watch-utils] failed to watch ${wp.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    watchCount,
    watchers,
    close() {
      if (closed) return;
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      for (const watcher of watchers) {
        watcher.close();
      }
    },
  };
}
