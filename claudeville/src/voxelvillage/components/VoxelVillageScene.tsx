import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useRef } from 'react';
import { Vector3 } from 'three';

import type { VoxelVillageSnapshot } from '../model.js';
import { VoxelAgent } from './VoxelAgent.js';
import { VoxelBuilding } from './VoxelBuilding.js';
import { VoxelGround } from './VoxelTerrain.js';

interface VoxelVillageSceneProps {
  snapshot: VoxelVillageSnapshot;
  selectedAgentId: string | null;
  selectedBuildingId: string | null;
  onSelectAgent: (agentId: string | null) => void;
  onSelectBuilding: (buildingId: string | null) => void;
}

export function VoxelVillageScene({
  snapshot,
  selectedAgentId,
  selectedBuildingId,
  onSelectAgent,
  onSelectBuilding,
}: VoxelVillageSceneProps) {
  const animatedAgentPositionsRef = useRef(new Map<string, Vector3>());
  const occlusionTargets = snapshot.agents;

  return (
    <section className="voxel-village__stage" aria-label="3D voxel village scene">
      <Canvas camera={{ position: [11, 10, 13], fov: 46, near: 0.1, far: 160 }} dpr={[1, 2]}>
        <color attach="background" args={['#b7d8eb']} />
        <fog attach="fog" args={['#b7d8eb', 26, 58]} />
        <ambientLight intensity={0.7} />
        <directionalLight
          position={[8, 14, 6]}
          intensity={1.5}
        />
        <VoxelGround roads={snapshot.roads} />
        {snapshot.buildings.map((building) => (
          <VoxelBuilding
            key={building.id}
            building={building}
            selected={selectedBuildingId === building.id}
            occlusionTargets={occlusionTargets}
            animatedAgentPositionsRef={animatedAgentPositionsRef}
            onSelect={() => onSelectBuilding(building.id)}
          />
        ))}
        {snapshot.agents.map((agent) => (
          <VoxelAgent
            key={agent.id}
            agent={agent}
            selected={selectedAgentId === agent.id}
            animatedAgentPositionsRef={animatedAgentPositionsRef}
            onSelect={() => onSelectAgent(agent.id)}
          />
        ))}
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          minDistance={8}
          maxDistance={28}
          maxPolarAngle={Math.PI / 2.25}
          target={[0, 0.8, 0]}
        />
      </Canvas>
    </section>
  );
}
