import fs from 'fs';

export interface WatchPath {
  path: string;
  type: 'file' | 'directory';
  filter?: string;
  recursive?: boolean;
}

export interface FileWatchersResult {
  watchCount: number;
  watchers: fs.FSWatcher[];
  close: () => void;
}

/**
 * Watch an array of watch-path objects and call onChange whenever any of them change.
 * Handles both file and directory watch paths. Directories support recursive watching
 * and optional filename filtering (e.g. only .jsonl files).
 */
export function createFileWatchers(
  watchPaths: WatchPath[],
  onChange: () => void,
  debounceMs = 200,
): FileWatchersResult {
  let watchCount = 0;
  let timer: NodeJS.Timeout | null = null;
  let closed = false;
  const watchers: fs.FSWatcher[] = [];

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
