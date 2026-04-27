import { create } from 'zustand';

export interface WorldAgent {
  id: string;
  name: string;
  status: string;
  bubbleText: string | null;
  appearance: Record<string, any>;
  position?: { tileX: number; tileY: number };
}

export interface WorldBuilding {
  type: string;
  width: number;
  height: number;
  position: { tileX: number; tileY: number };
}

export const useWorldStore = create<{
  agents: WorldAgent[];
  buildings: WorldBuilding[];
  selectedAgentId: string | null;
  setAgents: (agents: WorldAgent[]) => void;
  setBuildings: (buildings: WorldBuilding[]) => void;
  setSelectedAgentId: (id: string | null) => void;
  updateAgent: (id: string, data: Partial<WorldAgent>) => void;
  removeAgent: (id: string) => void;
}>((set) => ({
  agents: [],
  buildings: [],
  selectedAgentId: null,

  setAgents: (agents) => set({ agents }),
  setBuildings: (buildings) => set({ buildings }),
  setSelectedAgentId: (id) => set({ selectedAgentId: id }),

  updateAgent: (id, data) =>
    set((state) => ({
      agents: state.agents.map((a) => (a.id === id ? { ...a, ...data } : a)),
    })),

  removeAgent: (id) =>
    set((state) => ({
      agents: state.agents.filter((a) => a.id !== id),
    })),
}));