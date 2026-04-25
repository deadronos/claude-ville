/**
 * Bubble size and UI text scale configuration.
 * Exposed via the Settings modal so users can adjust without code changes.
 *
 * textScale: a multiplier applied to :root as --text-scale.
 *   0.8 = Small, 1.0 = Medium, 1.25 = Large, 1.5 = Extra large
 * statusFontSize, chatFontSize: drive bubble label font sizes in world mode.
 */

interface BubbleConfig {
    textScale: number;
    statusFontSize: number;
    statusMaxWidth: number;
    statusBubbleH: number;
    statusPaddingH: number;
    chatFontSize: number;
    chatMaxWidth: number;
}

const DEFAULTS: BubbleConfig = {
    textScale: 1.0,
    statusFontSize: 14,
    statusMaxWidth: 260,
    statusBubbleH: 28,
    statusPaddingH: 24,
    chatFontSize: 14,
    chatMaxWidth: 260,
};

function load(): BubbleConfig {
    try {
        const raw = localStorage.getItem('claudeville_bubble');
        if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch { /* ignore */ }
    return { ...DEFAULTS };
}

function save(cfg: BubbleConfig) {
    try {
        localStorage.setItem('claudeville_bubble', JSON.stringify(cfg));
    } catch { /* ignore */ }
}

let _cfg = load();

export function getBubbleConfig(): BubbleConfig {
    return { ..._cfg };
}

export function updateBubbleConfig(patch: Partial<BubbleConfig>) {
    _cfg = { ..._cfg, ...patch };
    save(_cfg);
    applyTextScale(_cfg.textScale);
}

export function resetBubbleConfig() {
    _cfg = { ...DEFAULTS };
    save(_cfg);
    applyTextScale(_cfg.textScale);
}

/** Apply --text-scale to :root so all UI elements scale together. */
export function applyTextScale(scale: number = _cfg.textScale) {
    document.documentElement.style.setProperty('--text-scale', String(scale));
}

/** Call on boot to restore saved scale. */
applyTextScale();