import { beforeEach, describe, it, expect, vi } from 'vitest';
import { useWorldStore } from './useWorldStore';

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
    const agents = [{ id: '1', name: 'Alice' }];
    useWorldStore.getState().setAgents(agents);
    expect(useWorldStore.getState().agents).toEqual(agents);
  });

  it('should set buildings', () => {
    const buildings = [{ type: 'hub', width: 4, height: 4 }];
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
    const state = useWorldStore.getState() as Record<string, unknown>;
    expect(state.updateAgent).toBeUndefined();
    expect(state.removeAgent).toBeUndefined();
    expect(state.setState).toBeUndefined();
  });
});
