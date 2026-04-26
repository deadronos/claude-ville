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