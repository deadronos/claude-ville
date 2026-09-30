export type BuildingStyle = {
    wallColor: string;
    roofColor: string;
    accentColor: string;
    wallHeight: number;
    roundRoof?: boolean;
};

export const BUILDING_STYLES: Record<string, BuildingStyle> = {
    command: {
        wallColor: '#7c5e42',
        roofColor: '#b22222',
        accentColor: '#ffcc33',
        wallHeight: 50,
    },
    forge: {
        wallColor: '#5c4033',
        roofColor: '#424242',
        accentColor: '#ff8c00',
        wallHeight: 40,
    },
    mine: {
        wallColor: '#4a4a4a',
        roofColor: '#6e5c4b',
        accentColor: '#ffd700',
        wallHeight: 35,
    },
    taskboard: {
        wallColor: '#5d544b',
        roofColor: '#8b7355',
        accentColor: '#64b5f6',
        wallHeight: 30,
    },
    chathall: {
        wallColor: '#455a64',
        roofColor: '#78909c',
        accentColor: '#81c784',
        wallHeight: 38,
        roundRoof: true,
    },
};

export const BUILDING_DEFS = [
    { type: 'command', x: 18, y: 18, width: 5, height: 4, label: 'COMMAND CENTER', icon: '⚡', description: 'Team status' },
    { type: 'forge', x: 28, y: 15, width: 4, height: 3, label: 'CODE FORGE', icon: '🔨', description: 'Code work' },
    { type: 'mine', x: 12, y: 24, width: 4, height: 3, label: 'TOKEN MINE', icon: '⛏️', description: 'Token usage' },
    { type: 'taskboard', x: 25, y: 25, width: 3, height: 3, label: 'TASK BOARD', icon: '📋', description: 'Task status' },
    { type: 'chathall', x: 15, y: 14, width: 4, height: 3, label: 'CHAT HALL', icon: '💬', description: 'Messages' },
];
