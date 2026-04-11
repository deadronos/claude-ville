// Stub agent name generation functions
// In production, these would generate realistic agent names

export function generateAgentDisplayName(seed) {
    return seed?.name || seed || 'Agent';
}

export function resolveAgentDisplayName(session, teamContext) {
    return {
        name: session?.displayName || session?.agentName || teamContext?.name || 'Agent',
        nameSeed: session?.sessionId || null,
        nameKind: session?.agentType || 'session',
        nameMode: 'stub',
        nameHint: session?.displayName || null,
    };
}
