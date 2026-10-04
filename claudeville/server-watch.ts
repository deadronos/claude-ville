import { createFileWatchers } from '../shared/watch-utils.js';
import { getAllWatchPaths } from './adapters/index.js';
import { broadcastUpdate, wsClients } from './server-ws.js';

let watchDebounce: ReturnType<typeof setTimeout> | null = null;
let fileWatcherCleanup: (() => void) | null = null;
let pollingIntervalId: ReturnType<typeof setInterval> | null = null;

// ─── File watching (multi-provider) ────────────────────────

function debouncedBroadcast() {
  if (watchDebounce) clearTimeout(watchDebounce);
  watchDebounce = setTimeout(() => { void broadcastUpdate(); }, 100);
}

export function startFileWatcher() {
  const watcherHandle = createFileWatchers(getAllWatchPaths(), debouncedBroadcast);
  fileWatcherCleanup = watcherHandle.close;
  const { watchCount } = watcherHandle;
  console.log(`[Watch] started watching ${watchCount} paths`);

  // Periodic polling (2s) - prevent missed updates
  pollingIntervalId = setInterval(() => {
    if (wsClients.size > 0) void broadcastUpdate();
  }, 2000);
  console.log('[Watch] polling started at 2s interval');
}

export function stopFileWatcher() {
  if (watchDebounce) {
    clearTimeout(watchDebounce);
    watchDebounce = null;
  }
  fileWatcherCleanup?.();
  fileWatcherCleanup = null;
  if (pollingIntervalId) {
    clearInterval(pollingIntervalId);
    pollingIntervalId = null;
  }
}
