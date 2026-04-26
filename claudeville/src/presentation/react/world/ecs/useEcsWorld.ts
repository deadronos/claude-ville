import { useRef } from 'react';
import { createWorld, ECSWorld } from './world.js';

export interface Agent {
  id: string;
  name: string;
  status: string;
  bubbleText: string | null;
  appearance: any;
}

export interface Building {
  type: string;
  width: number;
  height: number;
  position: {
    tileX: number;
    tileY: number;
  };
}

export function useEcsWorld(agents: Agent[], buildings: Building[]) {
  const worldRef = useRef<ECSWorld | null>(null);
  if (!worldRef.current) {
    worldRef.current = createWorld();
  }
  const world = worldRef.current;

  const agentMap = new Map<string, any>();
  const buildingMap = new Map<string, any>();

  // Sync agents → ECS entities
  for (const agent of agents) {
    let entity = agentMap.get(agent.id);
    if (!entity) {
      entity = world.createEntity();
      world.addEntity(entity);
      agentMap.set(agent.id, entity);
    }
    entity.id = agent.id;
    entity.name = agent.name;
    entity.status = agent.status;
    entity.bubbleText = agent.bubbleText;
    entity.appearance = agent.appearance;
    entity.Agent = true;
  }

  // Remove stale agents
  for (const entity of [...world.entities]) {
    if (entity.Agent && !agents.some((a: any) => a.id === entity.id)) {
      world.removeEntity(entity);
    }
  }

  // Sync buildings → ECS entities
  for (const building of buildings) {
    let entity = buildingMap.get(building.type);
    if (!entity) {
      entity = world.createEntity();
      world.addEntity(entity);
      buildingMap.set(building.type, entity);
    }
    entity.buildingType = building.type;
    entity.width = building.width;
    entity.height = building.height;
    entity.tileX = building.position.tileX;
    entity.tileY = building.position.tileY;
    entity.alpha = 1;
    entity.isBuilding = true;
  }

  // Remove stale buildings
  for (const entity of [...world.entities]) {
    if (entity.isBuilding && !buildings.some((b: any) => b.type === entity.buildingType)) {
      world.removeEntity(entity);
    }
  }

  return { world };
}