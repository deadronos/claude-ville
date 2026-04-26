import { useFrame } from '@react-three/fiber';
import type { ECSWorld } from './world.js';
import type { MutableRefObject } from 'react';
import type { CameraModel } from '../types.js';
import { getCameraFocusPosition, isoToScreen } from '../utils.js';
import { TILE_WIDTH } from '../../../../config/constants.js';
import { BUILDING_STYLES } from '../styles.js';

export function createMovementSystem(world: ECSWorld) {
  return function MovementSystem() {
    useFrame(() => {
      const agents = world.with('Agent').entities;
      for (const entity of agents) {
        const moving = entity.moving as boolean;
        if (!moving) continue;

        const x = entity.x as number;
        const y = entity.y as number;
        const targetX = entity.targetX as number;
        const targetY = entity.targetY as number;

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
          entity.walkFrame = ((entity.walkFrame as number) + 0.15);
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
        const type = building.buildingType as string;
        const style = BUILDING_STYLES[type];
        if (!style) continue;

        const tileX = building.tileX as number;
        const tileY = building.tileY as number;
        const width = building.width as number;

        const center = isoToScreen(tileX + width / 2, tileY + (building.height as number) / 2);
        const halfW = (width * TILE_WIDTH) / 4;

        let agentNear = false;
        const agents = world.with('Agent').entities;
        for (const agent of agents) {
          const dx = (agent.x as number) - center.x;
          const dy = (agent.y as number) - center.y;
          if (Math.abs(dx) < halfW + 15 && dy > -style.wallHeight - 10 && dy < 20) {
            agentNear = true;
            break;
          }
        }

        const current = roofAlphaRef.current.get(type) ?? 1;
        const next = current + ((agentNear ? 0 : 1) - current) * 0.06;
        roofAlphaRef.current.set(type, next);
        building.alpha = next;
      }
    });
  };
}

export function createCameraFollowSystem(
  world: ECSWorld,
  cameraRef: MutableRefObject<CameraModel>,
  viewport: { width: number; height: number }
) {
  return function CameraFollowSystem() {
    useFrame(() => {
      const camera = cameraRef.current;
      if (!camera.followAgentId) return;

      const agents = world.with('Agent').entities;
      const target = agents.find((e: any) => e.id === camera.followAgentId);
      if (!target) return;

      const focus = getCameraFocusPosition(target.x as number, target.y as number, viewport, camera.zoom);
      camera.x += (focus.x - camera.x) * camera.followSmoothing;
      camera.y += (focus.y - camera.y) * camera.followSmoothing;
    });
  };
}