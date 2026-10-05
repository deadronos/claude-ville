import { useFrame } from '@react-three/fiber';
import type { ECSWorld } from './world.js';
import type { MutableRefObject } from 'react';
import type { CameraModel } from '../types.js';
import { worldToIso } from '../utils.js';
import { TILE_WIDTH } from '../../../../config/constants.js';
import { BUILDING_STYLES } from '../../../../config/buildings.js';

export function createMovementSystem(world: ECSWorld) {
  return function MovementSystem() {
    useFrame(() => {
      const agents = world.with('Agent').entities;
      for (const entity of agents) {
        if (!entity.moving) continue;

        const { x, y, targetX, targetY } = entity;
        if (x === undefined || y === undefined || targetX === undefined || targetY === undefined) continue;

        const dx = targetX - x;
        const dy = targetY - y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 2) {
          entity.moving = false;
          entity.walkFrame = 0;
        } else {
          entity.moving = true;
          const speed = 1.5;
          entity.x = x + (dx / dist) * speed;
          entity.y = y + (dy / dist) * speed;
          entity.walkFrame = (entity.walkFrame ?? 0) + 0.15;
          entity.facingLeft = dx < 0;
        }
      }
    });
  };
}

export function createProximitySystem(
  world: ECSWorld,
  roofAlphaRef: MutableRefObject<Map<string, number>>
) {
  return function ProximitySystem() {
    useFrame(() => {
      const buildings = world.with('Building').entities;
      for (const building of buildings) {
        const { buildingType, tileX, tileY, width, height } = building;
        if (!buildingType) continue;
        const style = BUILDING_STYLES[buildingType];
        if (!style) continue;
        if (tileX === undefined || tileY === undefined || width === undefined || height === undefined) continue;

        const center = worldToIso(tileX + width / 2, tileY + height / 2);
        const halfW = (width * TILE_WIDTH) / 4;

        let agentNear = false;
        const agents = world.with('Agent').entities;
        for (const agent of agents) {
          if (agent.x === undefined || agent.y === undefined) continue;
          const dx = agent.x - center.x;
          const dy = agent.y - center.y;
          if (Math.abs(dx) < halfW + 15 && dy > -style.wallHeight - 10 && dy < 20) {
            agentNear = true;
            break;
          }
        }

        const current = roofAlphaRef.current.get(buildingType) ?? 1;
        const next = current + ((agentNear ? 0 : 1) - current) * 0.06;
        roofAlphaRef.current.set(buildingType, next);
        building.alpha = next;
      }
    });
  };
}

export function createCameraFollowSystem(
  world: ECSWorld,
  cameraRef: MutableRefObject<CameraModel>
) {
  return function CameraFollowSystem() {
    useFrame(() => {
      const camera = cameraRef.current;
      if (!camera.followAgentId) return;

      const agents = world.with('Agent').entities;
      const target = agents.find((e) => e.id === camera.followAgentId);
      if (!target) return;
      if (target.x === undefined || target.y === undefined) return;

      // Agent x,y are already in isometric screen coordinates
      // Camera targetX/targetZ are in the same coordinate space
      camera.targetX += (target.x - camera.targetX) * camera.followSmoothing;
      camera.targetZ += (target.y - camera.targetZ) * camera.followSmoothing;
    });
  };
}