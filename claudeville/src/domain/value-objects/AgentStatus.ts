export const AgentStatus = {
    WORKING: 'working',
    IDLE: 'idle',
    WAITING: 'waiting',
    COMPLETED: 'completed',
} as const;

export type AgentStatusType = typeof AgentStatus[keyof typeof AgentStatus];
