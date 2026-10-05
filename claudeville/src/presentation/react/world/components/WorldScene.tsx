import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { THEME } from '../../../../config/theme.js';
import { useEcsWorld } from '../ecs/useEcsWorld.js';
import { isAgentEntity, type Entity } from '../ecs/world.js';
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
  interactionRef,
}: WorldSceneProps) {
  void onHoverBuilding;
  const rootRef = useRef<THREE.Group | null>(null);
  const agents = sprites.map(s => s.agent);
  const { world } = useEcsWorld(agents, buildings);
  const { tiles, waterTiles } = useTerrain(buildings);
  const buildingByType = useMemo(
    () => new Map(buildings.map((building) => [building.type, building])),
    [buildings],
  );

  // Memoize systems to avoid recreating them on every render
  const movementSystem = useMemo(() => createMovementSystem(world), [world]);
  const proximitySystem = useMemo(() => createProximitySystem(world, roofAlphaRef), [world, roofAlphaRef]);
  const cameraFollowSystem = useMemo(() => createCameraFollowSystem(world, cameraRef), [world, cameraRef]);

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
        <InstancedTerrain tiles={tiles} />
        <Vegetation waterTiles={waterTiles} />
        {world.with('Building').entities.map((entity: Entity) => {
          if (typeof entity.buildingType !== 'string') {
            return null;
          }
          const building = buildingByType.get(entity.buildingType);
          if (!building) {
            return null;
          }
          return (
            <BuildingActor
              key={entity.buildingType}
              building={building}
              roofAlphaRef={roofAlphaRef}
              hovered={hoveredBuildingId === entity.buildingType}
            />
          );
        })}
        {world.with('Agent').entities.map((entity: Entity) => {
          if (!isAgentEntity(entity)) {
            return null;
          }
          return (
          <AgentActor
            key={entity.id}
            entity={entity}
            selected={selectedAgentId === entity.id}
            showUi={!selectedAgentId || selectedAgentId === entity.id}
            cameraRef={cameraRef}
            bubbleConfig={bubbleConfig}
            onSelect={onSelectAgent}
            interactionRef={interactionRef}
          />
          );
        })}
      </group>
      {movementSystem()}
      {proximitySystem()}
      {cameraFollowSystem()}
    </>
  );
}
