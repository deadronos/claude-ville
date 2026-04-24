export interface BuildingStyle {
    wallColor: string;
    roofColor: string;
    accentColor: string;
    wallHeight: number;
    roundRoof?: boolean;
    hasAntenna?: boolean;
    hasFlag?: boolean;
    windowGlow?: boolean;
    hasChimney?: boolean;
    hasAnvil?: boolean;
    hasMineEntrance?: boolean;
    hasPickaxe?: boolean;
    hasGems?: boolean;
    hasPostits?: boolean;
    hasBubble?: boolean;
}

export const BUILDING_STYLES: Record<string, BuildingStyle> = {
    command: {
        wallColor: '#5a3e2b',
        roofColor: '#8b0000',
        accentColor: '#ffd700',
        wallHeight: 50,
        hasAntenna: true,
        hasFlag: true,
        windowGlow: true,
    },
    forge: {
        wallColor: '#4a3520',
        roofColor: '#555555',
        accentColor: '#ff6b00',
        wallHeight: 40,
        hasChimney: true,
        hasAnvil: true,
    },
    mine: {
        wallColor: '#3e3530',
        roofColor: '#5a4a3a',
        accentColor: '#ffd700',
        wallHeight: 35,
        hasMineEntrance: true,
        hasPickaxe: true,
        hasGems: true,
    },
    taskboard: {
        wallColor: '#4a4035',
        roofColor: '#6b5b4a',
        accentColor: '#4a9eff',
        wallHeight: 30,
        hasPostits: true,
    },
    chathall: {
        wallColor: '#3a4a5a',
        roofColor: '#5a7a9a',
        accentColor: '#51cf66',
        wallHeight: 38,
        roundRoof: true,
        hasBubble: true,
    },
};
