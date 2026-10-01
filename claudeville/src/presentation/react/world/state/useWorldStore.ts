import { useSyncExternalStore } from 'react';

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

export interface WorldStoreState {
  agents: WorldAgent[];
  buildings: WorldBuilding[];
  selectedAgentId: string | null;
  setAgents: (agents: WorldAgent[]) => void;
  setBuildings: (buildings: WorldBuilding[]) => void;
  setSelectedAgentId: (id: string | null) => void;
}

type WorldStoreListener = () => void;
type WorldStorePatch = Partial<WorldStoreState> | ((state: WorldStoreState) => Partial<WorldStoreState>);
type WorldStoreHook = {
  <T>(selector: (state: WorldStoreState) => T): T;
  getState: () => WorldStoreState;
  subscribe: (listener: WorldStoreListener) => () => void;
};

const listeners = new Set<WorldStoreListener>();

let state: WorldStoreState = createState();

function createState(): WorldStoreState {
  return {
    agents: [],
    buildings: [],
    selectedAgentId: null,

    setAgents: (agents) => setState({ agents }),
    setBuildings: (buildings) => setState({ buildings }),
    setSelectedAgentId: (id) => setState({ selectedAgentId: id }),
  };
}

function subscribe(listener: WorldStoreListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getState() {
  return state;
}

function setState(patch: WorldStorePatch) {
  const partial = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...partial };
  listeners.forEach((listener) => listener());
}

export const useWorldStore: WorldStoreHook = Object.assign(
  function useWorldStore<T>(selector: (state: WorldStoreState) => T) {
    return useSyncExternalStore(
      subscribe,
      () => selector(state),
      () => selector(state),
    );
  },
  {
    getState,
    subscribe,
  },
);
