// The `data-i18n="*"` attributes sprinkled through the TSX are inert markers:
// no runtime code reads them — visible text comes from `i18n.t()`. They exist
// only as hints for a future language-switching feature.
const STRINGS: any = {
    time: 'TIME',
    working: 'WORKING',
    idle: 'IDLE',
    waiting: 'WAITING',
    world: 'WORLD',
    dashboard: 'DASHBOARD',
    settings: 'SETTINGS',

    agents: 'AGENTS',
    unknownProject: 'Unknown Project',

    noActiveAgents: 'NO ACTIVE AGENTS',
    noActiveAgentsSub: 'Start a Claude Code session to see agents here',
    toolHistory: 'TOOL HISTORY',
    noToolUsage: 'No tool usage yet',
    nAgents: (n: number) => `${n} agents`,
    contextUsage: (data: { percent: number }) => `Context ${data.percent}%`,

    model: 'MODEL',
    role: 'ROLE',
    team: 'TEAM',

    // Accessible names. These are announced by screen readers rather than read
    // on screen, so they use sentence case — uppercase here would be spelled
    // out letter by letter. They belong on elements that support naming
    // (landmarks, widgets, interactive roles), or as a .sr-only prefix beside a
    // bare value; never as aria-label on a generic span or div, which either
    // does nothing or replaces the text it was meant to describe.
    agentList: 'Agent list',
    agentCount: 'Agent count',
    totalAgents: 'Total agents',
    agentStats: 'Agent statistics',
    viewMode: 'View mode',
    viewAgentDetails: (data: { name: string }) => `View details for ${data.name}`,
    focusAgent: 'Focus agent',
    close: 'Close',

    statusWorking: 'WORKING',
    statusIdle: 'IDLE',
    statusWaiting: 'WAITING',

    agentJoined: (name: string) => `${name} joined the village`,
    agentLeft: (name: string) => `${name} left the village`,
    serverConnected: 'Server connected',
    serverDisconnected: 'Server disconnected, retrying...',
    modeSwitchWorld: 'Switched to World mode',
    modeSwitchDashboard: 'Switched to Dashboard mode',

    settingsTitle: 'SETTINGS',
    nameMode: 'Name mode',
    autodetectedNames: 'Autodetected',
    pooledRandomNames: 'Pooled random',
    providerNameModeNote: 'Provider overrides from the environment can still force a mode for specific providers.',
    nameModeChanged: (data: { mode: string }) => `Name mode set to ${data.mode}`,
    textSize: 'Text size',
    bubbleSize: 'Speech bubble size',
    bubbleSmall: 'Small',
    bubbleMedium: 'Medium',
    bubbleLarge: 'Large',
    bubbleExtraLarge: 'Extra large',
    settingsSaved: 'Settings saved',
};

export const i18n: any = {
    _lang: 'en',

    get lang() {
        return this._lang;
    },

    t(key: string, data?: any) {
        const val = STRINGS[key] ?? key;
        if (typeof val === 'function') {
            return val(data);
        }
        return val;
    }
};

export default i18n;
