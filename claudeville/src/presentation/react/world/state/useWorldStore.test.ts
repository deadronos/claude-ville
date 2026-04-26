import { describe, it, expect } from 'vitest';
import { useWorldStore } from './useWorldStore';

describe('useWorldStore', () => {
  it('should initialize with empty agents', () => {
    expect(useWorldStore.getState().agents).toEqual([]);
  });

  it('should set agents', () => {
    const agents = [{ id: '1', name: 'Alice' }];
    useWorldStore.getState().setAgents(agents);
    expect(useWorldStore.getState().agents).toEqual(agents);
  });

  it('should update a single agent', () => {
    useWorldStore.getState().setAgents([{ id: '1', name: 'Alice', status: 'idle' }]);
    useWorldStore.getState().updateAgent('1', { status: 'working' });
    expect(useWorldStore.getState().agents[0].status).toBe('working');
  });

  it('should remove an agent', () => {
    useWorldStore.getState().setAgents([{ id: '1', name: 'Alice' }, { id: '2', name: 'Bob' }]);
    useWorldStore.getState().removeAgent('1');
    const remaining = useWorldStore.getState().agents;
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe('2');
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
});