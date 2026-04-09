import { Appearance } from '../domain/value-objects/Appearance.js';
import { getRuntimeConfig } from './runtime.js';

const DEFAULT_AGENT_NAME_POOLS = {
    en: [
        'Atlas', 'Nova', 'Cipher', 'Pixel', 'Spark',
        'Bolt', 'Echo', 'Flux', 'Helix', 'Onyx',
        'Prism', 'Qubit', 'Rune', 'Sage', 'Vex',
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
    const en = toList(rawPools.en || rawPools.agentNames || rawPools.agentNamePool);
    return {
        en: en.length > 0 ? en : DEFAULT_AGENT_NAME_POOLS.en,
    };
}

function getNamePools() {
    const runtime = getRuntimeConfig();
    return normalizeNamePools(runtime.agentNamePool || runtime.agentNames || runtime.namePools || DEFAULT_AGENT_NAME_POOLS);
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

export function generateAgentDisplayName(seed) {
    const pools = getNamePools();
    const hash = Appearance.hashCode(String(seed || 'agent'));
    return pools.en[Math.abs(hash) % pools.en.length];
}

export function resolveAgentDisplayName(session, teamInfo = null) {
    const candidate = teamInfo?.name || session.displayName || session.agentName || null;

    if (candidate && !isRawIdentifier(candidate)) {
        return {
            name: candidate,
            nameIsCustom: true,
            nameSeed: session.agentId || session.sessionId || candidate,
        };
    }

    const nameSeed = session.agentId || session.sessionId || candidate || 'agent';
    return {
        name: generateAgentDisplayName(nameSeed),
        nameIsCustom: false,
        nameSeed,
    };
}
