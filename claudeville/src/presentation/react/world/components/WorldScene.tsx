import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { THEME } from '../../../../config/theme.js';
import { useEcsWorld } from '../ecs/useEcsWorld.js';
import { createMovementSystem, createProximitySystem, createCameraFollowSystem } from '../ecs/systems.js';
import { InstancedTerrain } from './InstancedTerrain.js';
import { AgentActor } from './AgentActor.js';
import { BuildingActor } from './BuildingActor.js';
import { ScreenSpaceCamera } from './ScreenSpaceCamera.js';
import type { WorldSceneProps } from '../types.js';

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
  const agents = sprites.map(s => s.agent);
  const { world } = useEcsWorld(agents, buildings);

  const movementSystem = createMovementSystem(world);
  const proximitySystem = createProximitySystem(world, roofAlphaRef);
  const cameraFollowSystem = createCameraFollowSystem(world, cameraRef, viewport);

  useFrame(() => {
    if (rootRef.current) {
      rootRef.current.position.set(Math.round(cameraRef.current.x * cameraRef.current.zoom), Math.round(cameraRef.current.y * cameraRef.current.zoom), 0);
      rootRef.current.scale.set(cameraRef.current.zoom, cameraRef.current.zoom, 1);
    }
  });

  return (
    <>
      <ScreenSpaceCamera viewport={viewport} cameraRef={cameraRef} />
      <color attach="background" args={[THEME.bg]} />
      <group ref={rootRef}>
        <InstancedTerrain buildings={buildings} />
        {world.with('Building').entities.map((entity: any) => (
          <BuildingActor
            key={entity.buildingType}
            building={buildings.find(b => b.type === entity.buildingType)}
            roofAlphaRef={roofAlphaRef}
            hovered={hoveredBuildingId === entity.buildingType}
          />
        ))}
        {world.with('Agent').entities.map((entity: any) => (
          <AgentActor
            key={entity.id}
            entity={entity}
            selected={selectedAgentId === entity.id}
            showUi={!selectedAgentId || selectedAgentId === entity.id}
            cameraRef={cameraRef}
            bubbleConfig={bubbleConfig}
            onSelect={onSelectAgent}
          />
        ))}
      </group>
      {movementSystem()}
      {proximitySystem()}
      {cameraFollowSystem()}
    </>
  );
}