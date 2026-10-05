import { beforeEach, describe, it, expect, vi } from 'vitest';
import { useWorldStore } from './useWorldStore';
import type { WorldAgent, WorldBuilding } from './useWorldStore';

describe('useWorldStore', () => {
  beforeEach(() => {
    useWorldStore.getState().setAgents([]);
    useWorldStore.getState().setBuildings([]);
    useWorldStore.getState().setSelectedAgentId(null);
  });

  it('should initialize with empty projection state', () => {
    expect(useWorldStore.getState().agents).toEqual([]);
    expect(useWorldStore.getState().buildings).toEqual([]);
    expect(useWorldStore.getState().selectedAgentId).toBeNull();
  });

  it('should set agents', () => {
    // `WorldAgent` declares status, bubbleText and appearance as required. The
    // store does not read them, but a projection element that could not have
    // come out of the controller is not what this case is about.
    const agents: WorldAgent[] = [{ id: '1', name: 'Alice', status: 'idle', bubbleText: null, appearance: {} }];
    useWorldStore.getState().setAgents(agents);
    expect(useWorldStore.getState().agents).toEqual(agents);
  });

  it('should set buildings', () => {
    // `WorldBuilding` declares `position` as required; same reasoning as above.
    const buildings: WorldBuilding[] = [{ type: 'hub', width: 4, height: 4, position: { tileX: 2, tileY: 3 } }];
    useWorldStore.getState().setBuildings(buildings);
    expect(useWorldStore.getState().buildings).toEqual(buildings);
  });

  it('should set selectedAgentId', () => {
    useWorldStore.getState().setSelectedAgentId('1');
    expect(useWorldStore.getState().selectedAgentId).toBe('1');
  });

  it('should notify subscribers when the projection changes', () => {
    const listener = vi.fn();
    const unsubscribe = useWorldStore.subscribe(listener);

    useWorldStore.getState().setSelectedAgentId('agent-9');

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('should not expose the retired mutation helpers', () => {
    // `WorldStoreState` declares no index signature, so the retired helpers were
    // previously reached through a `Record<string, unknown>` cast that TypeScript
    // rejected. `in` asks the same question — is the key there at all — without
    // the cast, and `false` covers both "absent" and "present but undefined".
    const state = useWorldStore.getState();
    expect('updateAgent' in state).toBe(false);
    expect('removeAgent' in state).toBe(false);
    expect('setState' in state).toBe(false);
  });
});
