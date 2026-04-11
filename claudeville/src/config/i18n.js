const STRINGS = {
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
    nAgents: (n) => `${n} agents`,

    model: 'MODEL',
    role: 'ROLE',
    team: 'TEAM',

    statusWorking: 'WORKING',
    statusIdle: 'IDLE',
    statusWaiting: 'WAITING',

    agentJoined: (name) => `${name} joined the village`,
    agentLeft: (name) => `${name} left the village`,
    serverConnected: 'Server connected',
    serverDisconnected: 'Server disconnected, retrying...',
    modeSwitchWorld: 'Switched to World mode',
    modeSwitchDashboard: 'Switched to Dashboard mode',

    settingsTitle: 'SETTINGS',
    nameMode: 'Name mode',
    autodetectedNames: 'Autodetected',
    pooledRandomNames: 'Pooled random',
    providerNameModeNote: 'Provider overrides from the environment can still force a mode for specific providers.',
    nameModeChanged: (label) => `Name mode set to ${label}`,
    bubbleSize: 'Speech bubble size',
    bubbleSmall: 'Small',
    bubbleMedium: 'Medium',
    bubbleLarge: 'Large',
    bubbleExtraLarge: 'Extra large',
    chatSize: 'Chat bubble size',
    chatSmall: 'Small',
    chatMedium: 'Medium',
    chatLarge: 'Large',
    chatExtraLarge: 'Extra large',
    settingsSaved: 'Settings saved',
};

class I18n {
    constructor() {
        this._lang = 'en';
    }

    get lang() {
        return 'en';
    }

    set lang(val) {
        this._lang = 'en';
    }

    t(key) {
        return STRINGS[key] ?? key;
    }
}

export const i18n = new I18n();
