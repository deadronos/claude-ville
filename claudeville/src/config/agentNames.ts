import { Appearance } from '../domain/value-objects/Appearance.js';
import { getRuntimeConfig } from './runtime.js';

const DEFAULT_AGENT_NAME_POOLS = {
    agent: [
        'Atlas', 'Nova', 'Cipher', 'Pixel', 'Spark',
        'Bolt', 'Echo', 'Flux', 'Helix', 'Onyx',
        'Prism', 'Qubit', 'Rune', 'Sage', 'Vex',
    ],
    session: [
        'Orbit', 'Beacon', 'Relay', 'Pulse', 'Signal',
        'Vector', 'Comet', 'Drift', 'Trace', 'Kernel',
        'Node', 'Echo', 'Wisp', 'Shard', 'Tide',
    ],
};

function toList(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item).trim()).filter(Boolean);
    }

    if (typeof value !== 'string') {
        return [];
    }

    return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function normalizeNamePools(rawPools = {}) {
    const agent = toList(rawPools.agent || rawPools.en || rawPools.agentNames || rawPools.agentNamePool);
    const session = toList(rawPools.session || rawPools.sessions || rawPools.sessionNamePool);
    return {
        agent: agent.length > 0 ? agent : DEFAULT_AGENT_NAME_POOLS.agent,
        session: session.length > 0 ? session : DEFAULT_AGENT_NAME_POOLS.session,
    };
}

function getNamePools() {
    const runtime = getRuntimeConfig();
    return normalizeNamePools({
        agent: runtime.agentNamePool || runtime.agentNames || runtime.namePools?.agent || DEFAULT_AGENT_NAME_POOLS.agent,
        session: runtime.sessionNamePool || runtime.namePools?.session || DEFAULT_AGENT_NAME_POOLS.session,
    });
}

function isRawIdentifier(value) {
    if (!value) return false;
    const text = String(value).trim();
    if (text.length < 16) return false;
    if (/\s/.test(text)) return false;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return true;
    if (/^[0-9a-f]{12,}$/i.test(text)) return true;
    if (/^([a-z0-9]{8,}[-_:]){1,}[a-z0-9]{4,}$/i.test(text)) return true;
    return text.length >= 24;
}

export function generateAgentDisplayName(seed, kind = 'agent') {
    const pools = getNamePools();
    const hash = Appearance.hashCode(String(seed || 'agent'));
    const pool = pools[kind] || pools.agent;
    return pool[Math.abs(hash) % pool.length];
}

function getStoredNameMode() {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem('claudeville-name-mode');
}

export function getNameMode(provider = null) {
    const runtime = getRuntimeConfig();
    const providerMode = provider && runtime.providerNameModes ? runtime.providerNameModes[provider] : null;
    if (providerMode) return providerMode;
    return getStoredNameMode() || runtime.nameMode || 'autodetected';
}

export function setNameMode(mode) {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const nextMode = mode === 'pooled' ? 'pooled' : 'autodetected';
    window.localStorage.setItem('claudeville-name-mode', nextMode);
}

function abbreviateIdentifier(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text.length <= 12) return text;
    return `${text.slice(0, 8)}…${text.slice(-3)}`;
}

function getNameKind(session, teamInfo) {
    if (teamInfo?.name) return 'agent';
    if (session.agentId) return 'agent';
    if (session.agentType && session.agentType !== 'main') return 'agent';
    return 'session';
}

export function resolveAgentDisplayName(session, teamInfo = null) {
    const provider = session.provider || 'unknown';
    const candidate = teamInfo?.name || session.displayName || session.agentName || null;
    const nameKind = getNameKind(session, teamInfo);
    const nameSeed = session.agentId || session.sessionId || candidate || 'agent';
    const mode = getNameMode(provider);

    if (mode === 'pooled') {
        return {
            name: generateAgentDisplayName(nameSeed, nameKind),
            nameSeed,
            nameKind,
            nameMode: mode,
            nameHint: candidate,
        };
    }

    if (candidate && !isRawIdentifier(candidate)) {
        return {
            name: candidate,
            nameSeed,
            nameKind,
            nameMode: mode,
            nameHint: candidate,
        };
    }

    return {
        name: abbreviateIdentifier(nameSeed),
        nameSeed,
        nameKind,
        nameMode: mode,
        nameHint: candidate,
    };
}
