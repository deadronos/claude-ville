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
  const world = createWorld();

  // Sync agents → ECS entities
  for (const agent of agents) {
    let entity = world.entities.find((e: any) => e.id === agent.id);
    if (!entity) {
      entity = world.createEntity();
      world.addEntity(entity);
    }
    entity.id = agent.id;
    entity.name = agent.name;
    entity.status = agent.status;
    entity.bubbleText = agent.bubbleText;
    entity.appearance = agent.appearance;
    entity.Agent = true;
  }

  // Remove stale entities
  for (const entity of [...world.entities]) {
    if (entity.isAgent && !agents.some((a: any) => a.id === entity.id)) {
      world.removeEntity(entity);
    }
  }

  // Sync buildings → ECS entities
  for (const building of buildings) {
    let entity = world.entities.find((e: any) => e.buildingType === building.type);
    if (!entity) {
      entity = world.createEntity();
      world.addEntity(entity);
    }
    entity.buildingType = building.type;
    entity.width = building.width;
    entity.height = building.height;
    entity.tileX = building.position.tileX;
    entity.tileY = building.position.tileY;
    entity.alpha = 1;
    entity.isBuilding = true;
  }

  return { world };
}