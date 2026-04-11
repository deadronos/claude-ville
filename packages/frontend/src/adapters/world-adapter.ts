// packages/frontend/src/adapters/world-adapter.ts

import type { Session } from '../store';

// Minimal World stub for Phase 2 — real World/Agent/Bulding classes
// migrate from claudeville/ in Phase 3.
// The interface must match what IsometricRenderer expects:
//   World.agents: Map<string, Agent>
//   World.addAgent(agent: Agent): void
//   World.removeAgent(id: string): void
//   World.updateAgent(id: string, data: Partial<Agent>): void

export class World {
  agents = new Map<string, AgentStub>();
  buildings = new Map<string, unknown>();

  addAgent(agent: AgentStub) {
    this.agents.set(agent.id, agent);
  }

  removeAgent(id: string) {
    this.agents.delete(id);
  }

  updateAgent(id: string, data: Partial<AgentStub>) {
    const agent = this.agents.get(id);
    if (agent) {
      Object.assign(agent, data);
    }
  }
}

// AgentStub mirrors the key fields the IsometricRenderer uses
interface AgentStub {
  id: string;
  name: string;
  nameSeed: string;
  nameKind: string;
  nameMode: string;
  nameHint: string | null;
  model: string;
  status: string;
  role: string;
  tokens: { input: number; output: number };
  messages: unknown[];
  teamName: string | undefined;
  projectPath: string | undefined;
  provider: string;
  currentTool: string | null;
  currentToolInput: string | null;
  lastMessage: string | null;
}

function sessionToAgent(session: Session): AgentStub {
  return {
    id: session.sessionId,
    name: session.project || session.provider,
    nameSeed: session.sessionId,
    nameKind: 'session',
    nameMode: 'autodetected',
    nameHint: null,
    model: session.model || 'unknown',
    status: session.status,
    role: session.role || 'general',
    tokens: { input: 0, output: 0 },
    messages: [],
    teamName: session.team,
    projectPath: session.project,
    provider: session.provider,
    currentTool: session.currentTool?.name || null,
    currentToolInput: session.currentTool?.input || null,
    lastMessage: null,
  };
}

export function buildWorld(sessions: Session[]): World {
  const world = new World();
  for (const session of sessions) {
    world.addAgent(sessionToAgent(session));
  }
  return world;
}
