import { DEFAULT_AGENT_NAME_POOL, DEFAULT_SESSION_NAME_POOL, toList } from '../../../shared/name-pools.js';
import { Appearance } from '../domain/value-objects/Appearance.js';
import { getRuntimeConfig } from './runtime.js';

const DEFAULT_AGENT_NAME_POOLS: { agent: string[]; session: string[] } = {
    agent: DEFAULT_AGENT_NAME_POOL,
    session: DEFAULT_SESSION_NAME_POOL,
};

function normalizeNamePools(rawPools: Record<string, unknown> = {}) {
    const agent = toList((rawPools.agent || rawPools.en || rawPools.agentNames || rawPools.agentNamePool) as string | string[]);
    const session = toList((rawPools.session || rawPools.sessions || rawPools.sessionNamePool) as string | string[]);
    return {
        agent: agent.length > 0 ? agent : DEFAULT_AGENT_NAME_POOLS.agent,
        session: session.length > 0 ? session : DEFAULT_AGENT_NAME_POOLS.session,
    };
}

function getNamePools() {
    const runtime = getRuntimeConfig();
    const namePools = (runtime.namePools as Record<string, unknown>) || {};
    return normalizeNamePools({
        agent: runtime.agentNamePool || runtime.agentNames || namePools.agent || DEFAULT_AGENT_NAME_POOLS.agent,
        session: runtime.sessionNamePool || namePools.session || DEFAULT_AGENT_NAME_POOLS.session,
    });
}

function isRawIdentifier(value: unknown): boolean {
    if (!value) return false;
    const text = String(value).trim();
    if (text.length < 16) return false;
    if (/\s/.test(text)) return false;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return true;
    if (/^[0-9a-f]{12,}$/i.test(text)) return true;
    if (/^([a-z0-9]{8,}[-_:]){1,}[a-z0-9]{4,}$/i.test(text)) return true;
    return text.length >= 24;
}

export function generateAgentDisplayName(seed: string | undefined, kind: string = 'agent') {
    const pools = getNamePools();
    const hash = Appearance.hashCode(String(seed || 'agent'));
    const pool = (pools as any)[kind] || pools.agent;
    return pool[Math.abs(hash) % pool.length];
}

function getStoredNameMode(): string | null {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem('claudeville-name-mode');
}

export function getNameMode(provider: string | null = null): string {
    const runtime = getRuntimeConfig();
    const providerModes = runtime.providerNameModes as Record<string, string> | undefined;
    const providerMode = provider && providerModes ? providerModes[provider] : null;
    if (providerMode) return providerMode;
    return getStoredNameMode() || (runtime.nameMode as string) || 'autodetected';
}

export function setNameMode(mode: string) {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const nextMode = mode === 'pooled' ? 'pooled' : 'autodetected';
    window.localStorage.setItem('claudeville-name-mode', nextMode);
}

function abbreviateIdentifier(value: string) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (text.length <= 12) return text;
    return `${text.slice(0, 8)}…${text.slice(-3)}`;
}

interface TeamInfo {
    name?: string;
}

function getNameKind(session: { agentId?: string; agentType?: string }, teamInfo: TeamInfo | null) {
    if (teamInfo?.name) return 'agent';
    if (session.agentId) return 'agent';
    if (session.agentType && session.agentType !== 'main') return 'agent';
    return 'session';
}

export function resolveAgentDisplayName(session: { provider?: string; agentId?: string; sessionId?: string; displayName?: string; agentName?: string }, teamInfo: TeamInfo | null = null) {
    const provider = session.provider || 'unknown';
    const candidate: string | null = teamInfo?.name || session.displayName || session.agentName || null;
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