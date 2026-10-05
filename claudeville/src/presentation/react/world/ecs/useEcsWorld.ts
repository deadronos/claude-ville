import { useRef } from 'react';
import { createWorld, ECSWorld, type Entity } from './world.js';
import { isoToScreen } from '../utils.js';

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
    return isoToScreen(agent.position.tileX, agent.position.tileY);
  }
  return { x: 0, y: 0 };
}

export function useEcsWorld(agents: Agent[], buildings: Building[]) {
  const worldRef = useRef<ECSWorld | null>(null);
  // `Entity`, not `any`: these maps hand out the objects the systems read, so
  // typing them is what makes the writes below (`entity.moving = true` and the
  // rest) checked against the component fields rather than waved through.
  const agentMapRef = useRef<Map<string, Entity>>(new Map());
  const buildingMapRef = useRef<Map<string, Entity>>(new Map());

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
    
    // Initialize position on first creation
    if (entity.x === undefined) {
      entity.x = screen.x;
      entity.y = screen.y;
      entity.targetX = screen.x;
      entity.targetY = screen.y;
    }

    // Update target for movement system instead of snapping
    if (entity.targetX !== screen.x || entity.targetY !== screen.y) {
      entity.targetX = screen.x;
      entity.targetY = screen.y;
      entity.moving = true;
    }
  }

  // Remove stale agents
  for (const entity of [...world.entities]) {
    if (entity.Agent && !agents.some((a) => a.id === entity.id)) {
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
    if (entity.isBuilding && !buildings.some((b) => b.type === entity.buildingType)) {
      world.removeEntity(entity);
    }
  }

  return { world };
}