import { useRef } from 'react';
import { createWorld, ECSWorld } from './world.js';
import { TILE_HEIGHT, TILE_WIDTH } from '../../../../config/constants.js';

export interface Agent {
  id: string;
  name: string;
  status: string;
  bubbleText: string | null;
  appearance: any;
  position?: { tileX: number; tileY: number };
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

function agentToScreen(agent: Agent): { x: number; y: number } {
  if (agent.position) {
    return {
      x: (agent.position.tileX - agent.position.tileY) * TILE_WIDTH / 2,
      y: (agent.position.tileX + agent.position.tileY) * TILE_HEIGHT / 2,
    };
  }
  return { x: 0, y: 0 };
}

export function useEcsWorld(agents: Agent[], buildings: Building[]) {
  const worldRef = useRef<ECSWorld | null>(null);
  const agentMapRef = useRef<Map<string, any>>(new Map());
  const buildingMapRef = useRef<Map<string, any>>(new Map());

  if (!worldRef.current) {
    worldRef.current = createWorld();
  }
  const world = worldRef.current;
  const agentMap = agentMapRef.current;
  const buildingMap = buildingMapRef.current;

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
    const screen = agentToScreen(agent);
    entity.x = screen.x;
    entity.y = screen.y;
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
    entity.Building = true;
  }

  // Remove stale buildings
  for (const entity of [...world.entities]) {
    if (entity.isBuilding && !buildings.some((b: any) => b.type === entity.buildingType)) {
      world.removeEntity(entity);
    }
  }

  return { world };
}