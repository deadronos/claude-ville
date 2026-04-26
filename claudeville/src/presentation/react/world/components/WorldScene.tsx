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
  const agents = sprites.map(s => s.agent);
  const { world } = useEcsWorld(agents, buildings);

  const movementSystem = createMovementSystem(world);
  const proximitySystem = createProximitySystem(world, roofAlphaRef);
  const cameraFollowSystem = createCameraFollowSystem(world, cameraRef, viewport);

  return (
    <>
      <ScreenSpaceCamera viewport={viewport} />
      <color attach="background" args={[THEME.bg]} />
      <group>
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