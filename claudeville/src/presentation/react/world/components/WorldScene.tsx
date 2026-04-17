import { useRef } from 'react';

import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { TILE_WIDTH } from '../../../../config/constants.js';
import { THEME } from '../../../../config/theme.js';
import { BUILDING_STYLES } from '../styles.js';
import type { WorldSceneProps } from '../types.js';
import { getCameraFocusPosition, isoToScreen } from '../utils.js';
import { AgentActor } from './AgentActor.js';
import { BuildingActor } from './BuildingActor.js';
import { ScreenSpaceCamera } from './ScreenSpaceCamera.js';
import { TerrainLayer } from './TerrainLayer.js';

export function WorldScene({
  viewport,
  sprites,
  cameraRef,
  roofAlphaRef,
  bubbleConfig,
  buildings,
  selectedAgentId,
  hoveredBuildingId,
  onSelectAgent,
  onHoverBuilding,
  interactionRef,
}: WorldSceneProps) {
  const rootRef = useRef<THREE.Group | null>(null);

  useFrame(() => {
    const camera = cameraRef.current;
    if (camera.followAgentId) {
      const target = sprites.find((sprite) => sprite.agent.id === camera.followAgentId);
      if (target) {
        const focus = getCameraFocusPosition(target.x, target.y, viewport, camera.zoom);
        camera.x += (focus.x - camera.x) * camera.followSmoothing;
        camera.y += (focus.y - camera.y) * camera.followSmoothing;
      }
    }

    for (const sprite of sprites) {
      sprite.chatPartner = sprite.chatPartner && sprites.includes(sprite.chatPartner) ? sprite.chatPartner : sprite.chatPartner;
      sprite.selected = sprite.agent.id === selectedAgentId;
      sprite.update(null);
    }

    for (const building of buildings) {
      const style = BUILDING_STYLES[building.type];
      const center = isoToScreen(building.position.tileX + building.width / 2, building.position.tileY + building.height / 2);
      const halfW = building.width * TILE_WIDTH / 4;
      let agentNear = false;
      for (const sprite of sprites) {
        const dx = sprite.x - center.x;
        const dy = sprite.y - center.y;
        if (Math.abs(dx) < halfW + 15 && dy > -style.wallHeight - 10 && dy < 20) {
          agentNear = true;
          break;
        }
      }
      const current = roofAlphaRef.current.get(building.type) ?? 1;
      const next = current + ((agentNear ? 0 : 1) - current) * 0.06;
      roofAlphaRef.current.set(building.type, next);
    }

    if (rootRef.current) {
      rootRef.current.position.set(Math.round(camera.x * camera.zoom), Math.round(camera.y * camera.zoom), 0);
      rootRef.current.scale.set(camera.zoom, camera.zoom, 1);
    }
  });

  return (
    <>
      <ScreenSpaceCamera viewport={viewport} />
      <color attach="background" args={[THEME.bg]} />
      <group ref={rootRef}>
        <TerrainLayer buildings={buildings} />
        {buildings.map((building) => (
          <group
            key={building.type}
            onPointerOver={(event) => {
              event.stopPropagation();
              onHoverBuilding(building.type);
            }}
            onPointerOut={(event) => {
              event.stopPropagation();
              onHoverBuilding(null);
            }}
          >
            <BuildingActor building={building} roofAlphaRef={roofAlphaRef} hovered={hoveredBuildingId === building.type} />
          </group>
        ))}
        {sprites.map((sprite) => (
          <AgentActor
            key={sprite.agent.id}
            sprite={sprite}
            selected={selectedAgentId === sprite.agent.id}
            showUi={!selectedAgentId || selectedAgentId === sprite.agent.id}
            cameraRef={cameraRef}
            bubbleConfig={bubbleConfig}
            onSelect={onSelectAgent}
            interactionRef={interactionRef}
          />
        ))}
      </group>
    </>
  );
}
