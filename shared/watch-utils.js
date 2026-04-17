const fs = require('fs');

/**
 * Watch an array of watch-path objects and call onChange whenever any of them change.
 * Handles both file and directory watch paths. Directories support recursive watching
 * and optional filename filtering (e.g. only .jsonl files).
 *
 * @param {Array<{path: string, type: 'file'|'directory', filter?: string, recursive?: boolean}>} watchPaths
 * @param {Function} onChange  - Called with no arguments when a watched path changes
 * @param {number} [debounceMs=200]  - Debounce delay
 * @returns {{ watchCount: number }}
 */
function createFileWatchers(watchPaths, onChange, debounceMs = 200) {
  let watchCount = 0;
  let timer = null;

  for (const wp of watchPaths) {
    try {
      if (wp.type === 'file') {
        if (!fs.existsSync(wp.path)) continue;
        fs.watch(wp.path, (eventType) => {
          if (eventType === 'change') {
            if (timer) clearTimeout(timer);
            timer = setTimeout(onChange, debounceMs);
          }
        });
        watchCount++;
      } else if (wp.type === 'directory') {
        if (!fs.existsSync(wp.path)) continue;
        fs.watch(wp.path, { recursive: wp.recursive || false }, (_eventType, filename) => {
          if (wp.filter && filename && !filename.endsWith(wp.filter)) return;
          if (timer) clearTimeout(timer);
          timer = setTimeout(onChange, debounceMs);
        });
        watchCount++;
      }
    } catch {
      // ignore individual watch failures
    }
  }

  return { watchCount };
}

module.exports = { createFileWatchers };