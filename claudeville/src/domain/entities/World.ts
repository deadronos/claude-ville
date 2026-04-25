import { eventBus } from '../events/DomainEvent.js';
import { Agent } from './Agent.js';
import { Building } from './Building.js';

export class World {
    agents: Map<string, Agent>;
    buildings: Map<string, Building>;
    startTime: number;

    constructor() {
        this.agents = new Map();
        this.buildings = new Map();
        this.startTime = Date.now();
    }

    addAgent(agent: Agent) {
        this.agents.set(agent.id, agent);
        eventBus.emit('agent:added', agent);
    }

    removeAgent(id: string) {
        const agent = this.agents.get(id);
        if (agent) {
            this.agents.delete(id);
            eventBus.emit('agent:removed', agent);
        }
    }

    updateAgent(id: string, data: Partial<Agent>) {
        const agent = this.agents.get(id);
        if (agent) {
            agent.update(data);
            eventBus.emit('agent:updated', agent);
        }
    }

    addBuilding(building: Building) {
        this.buildings.set(building.type, building);
    }

    getStats() {
        let working = 0;
        let idle = 0;
        let waiting = 0;

        for (const agent of this.agents.values()) {
            if (agent.status === 'working') working++;
            else if (agent.status === 'idle') idle++;
            else if (agent.status === 'waiting') waiting++;
        }

        return { working, idle, waiting, total: this.agents.size };
    }

    get activeTime() {
        return Math.floor((Date.now() - this.startTime) / 1000);
    }
}
