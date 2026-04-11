/**
 * Speech/chat bubble size configuration.
 * Exposed via the Settings modal so users can adjust without code changes.
 */

const DEFAULTS = {
  statusFontSize: 11,
  statusMaxWidth: 200,
  statusBubbleH: 24,
  statusPaddingH: 20,
  chatFontSize: 11,
  chatMaxWidth: 200,
};

function load() {
  try {
    const raw = localStorage.getItem('claudeville_bubble');
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

function save(cfg) {
  try {
    localStorage.setItem('claudeville_bubble', JSON.stringify(cfg));
  } catch { /* ignore */ }
}

let _cfg = load();

export function getBubbleConfig() {
  return { ..._cfg };
}

export function updateBubbleConfig(patch) {
  _cfg = { ..._cfg, ...patch };
  save(_cfg);
}

export function resetBubbleConfig() {
  _cfg = { ...DEFAULTS };
  save(_cfg);
}
