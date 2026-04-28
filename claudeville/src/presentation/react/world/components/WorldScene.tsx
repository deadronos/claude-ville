import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { THEME } from '../../../../config/theme.js';
import { useEcsWorld } from '../ecs/useEcsWorld.js';
import { createMovementSystem, createProximitySystem, createCameraFollowSystem } from '../ecs/systems.js';
import { getCameraFocusPosition } from '../utils.js';
import { InstancedTerrain } from './InstancedTerrain.js';
import { Vegetation } from './Vegetation.js';
import { AgentActor } from './AgentActor.js';
import { BuildingActor } from './BuildingActor.js';
import { ScreenSpaceCamera } from './ScreenSpaceCamera.js';
import { useTerrain } from '../hooks/useTerrain.js';
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
}: WorldSceneProps) {
  const rootRef = useRef<THREE.Group | null>(null);
  const agents = sprites.map(s => s.agent);
  const { world } = useEcsWorld(agents, buildings);
  const { waterTiles } = useTerrain(buildings);

  const movementSystem = createMovementSystem(world);
  const proximitySystem = createProximitySystem(world, roofAlphaRef);
  const cameraFollowSystem = createCameraFollowSystem(world, cameraRef);

  // Scene transform: offset content so camera target is at screen center
  // We need to flip the Y axis because isometric Y increases up but Three.js Y increases down
  useFrame(() => {
    if (rootRef.current) {
      const scale = cameraRef.current.zoom;
      const offset = getCameraFocusPosition(
        cameraRef.current.targetX,
        cameraRef.current.targetZ,
        viewport,
        scale,
      );
      rootRef.current.position.set(offset.x, offset.y, 0);
      rootRef.current.scale.set(scale, scale, 1);
    }
  });

  return (
    <>
      <ScreenSpaceCamera viewport={viewport} cameraRef={cameraRef} />
      <color attach="background" args={[THEME.bg]} />
      <group ref={rootRef}>
        <InstancedTerrain buildings={buildings} />
        <Vegetation waterTiles={waterTiles} />
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