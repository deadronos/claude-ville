import { eventBus } from '../domain/events/DomainEvent.js';

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

    model: 'MODEL',
    role: 'ROLE',
    team: 'TEAM',

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

    set lang(value: string) {
        if (value === this._lang) return;
        this._lang = value;
        localStorage.setItem('claudeville-lang', value);
        eventBus.emit('i18n:language-changed', value);
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
