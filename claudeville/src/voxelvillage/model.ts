import {
  buildVillageSnapshot,
  type HubSession,
  type VillageAgent,
  type VillageBuilding,
  type VillageSnapshot,
  type VillageStatus,
} from '../pixivillage/model.js';

export interface VoxelPosition {
  x: number;
  y: number;
  z: number;
}

export interface VoxelVillageAgent extends VillageAgent {
  voxelPosition: VoxelPosition;
  pathTarget: VoxelPosition;
  color: string;
}

export interface VoxelVillageBuilding extends VillageBuilding {
  voxelPosition: VoxelPosition;
  footprint: { width: number; depth: number; height: number };
  colorHex: string;
  roofHex: string;
}

export interface VoxelVillageSnapshot extends Omit<VillageSnapshot, 'agents' | 'buildings'> {
  agents: VoxelVillageAgent[];
  buildings: VoxelVillageBuilding[];
  roads: Array<{ x: number; z: number }>;
}

const statusColors: Record<VillageStatus, string> = {
  running: '#45d483',
  waiting: '#f2b84b',
  idle: '#8ca0ba',
  error: '#ff5f6d',
  offline: '#667085',
};

export function buildVoxelVillageSnapshot(sessions: HubSession[], now = Date.now()): VoxelVillageSnapshot {
  const base = buildVillageSnapshot(sessions, now);
  return buildVoxelVillageSnapshotFromVillage(base);
}

export function buildVoxelVillageSnapshotFromVillage(base: VillageSnapshot): VoxelVillageSnapshot {
  const buildings = base.buildings.map(toVoxelBuilding);
  const buildingById = new Map(buildings.map((building) => [building.id, building]));
  const agentIndexesByBuilding = new Map<string, number>();
  const agents = base.agents.map((agent) => {
    const index = agentIndexesByBuilding.get(agent.buildingId) ?? 0;
    agentIndexesByBuilding.set(agent.buildingId, index + 1);
    const building = buildingById.get(agent.buildingId) ?? buildings[0];
    return toVoxelAgent(agent, building, index);
  });

  return {
    ...base,
    agents,
    buildings,
    roads: buildRoadGrid(),
  };
}

function toVoxelBuilding(building: VillageBuilding): VoxelVillageBuilding {
  return {
    ...building,
    voxelPosition: {
      x: (building.x - 7) * 2,
      y: Math.max(0.75, building.height / 48),
      z: (building.y - 5) * 2,
    },
    footprint: {
      width: building.width * 1.45,
      depth: building.depth * 1.45,
      height: Math.max(1.25, building.height / 34),
    },
    colorHex: toHex(building.color),
    roofHex: toHex(building.roofColor),
  };
}

function toVoxelAgent(agent: VillageAgent, building: VoxelVillageBuilding, index: number): VoxelVillageAgent {
  const ring = Math.floor(index / 6);
  const slot = index % 6;
  const angle = (slot / 6) * Math.PI * 2;
  const radius = 1.55 + ring * 0.45;
  const offsetX = Number((Math.cos(angle) * radius).toFixed(2));
  const offsetZ = Number((Math.sin(angle) * radius).toFixed(2));

  return {
    ...agent,
    voxelPosition: {
      x: Number((building.voxelPosition.x + offsetX).toFixed(2)),
      y: 0,
      z: Number((building.voxelPosition.z + offsetZ).toFixed(2)),
    },
    pathTarget: {
      x: Number((building.voxelPosition.x + offsetZ * 0.35).toFixed(2)),
      y: 0,
      z: Number((building.voxelPosition.z - offsetX * 0.35).toFixed(2)),
    },
    color: statusColors[agent.status],
  };
}

function buildRoadGrid() {
  const roads: Array<{ x: number; z: number }> = [];
  for (let coord = -10; coord <= 10; coord += 1) {
    roads.push({ x: coord, z: 0 });
    roads.push({ x: 0, z: coord });
  }
  for (let coord = -8; coord <= 8; coord += 1) {
    roads.push({ x: coord, z: -6 });
    roads.push({ x: coord, z: 6 });
    roads.push({ x: -8, z: coord });
    roads.push({ x: 8, z: coord });
  }
  return dedupeRoads(roads);
}

function dedupeRoads(roads: Array<{ x: number; z: number }>) {
  const seen = new Set<string>();
  return roads.filter((road) => {
    const key = `${road.x}:${road.z}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toHex(value: number) {
  return `#${value.toString(16).padStart(6, '0')}`;
}
