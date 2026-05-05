import { Billboard, OrbitControls, Text } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type { Group } from 'three';

import type { VoxelVillageAgent, VoxelVillageBuilding, VoxelVillageSnapshot } from '../model.js';

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
            onSelect={() => onSelectBuilding(building.id)}
          />
        ))}
        {snapshot.agents.map((agent) => (
          <VoxelAgent
            key={agent.id}
            agent={agent}
            selected={selectedAgentId === agent.id}
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

function VoxelGround({ roads }: { roads: VoxelVillageSnapshot['roads'] }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[28, 24]} />
        <meshStandardMaterial color="#5ea95f" roughness={0.9} />
      </mesh>
      {roads.map((road) => (
        <mesh key={`${road.x}:${road.z}`} position={[road.x, 0.015, road.z]}>
          <boxGeometry args={[0.96, 0.03, 0.96]} />
          <meshStandardMaterial color="#b18b62" roughness={0.95} />
        </mesh>
      ))}
      {Array.from({ length: 36 }, (_, index) => {
        const x = ((index * 7) % 25) - 12;
        const z = ((index * 11) % 21) - 10;
        if (Math.abs(x) < 1.3 || Math.abs(z) < 1.3) return null;
        return <VoxelTree key={index} x={x} z={z} />;
      })}
    </group>
  );
}

function VoxelTree({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.35, 0]}>
        <boxGeometry args={[0.28, 0.7, 0.28]} />
        <meshStandardMaterial color="#72512c" />
      </mesh>
      <mesh position={[0, 1.0, 0]}>
        <boxGeometry args={[0.95, 0.95, 0.95]} />
        <meshStandardMaterial color="#2f7d42" roughness={0.8} />
      </mesh>
    </group>
  );
}

function VoxelBuilding({ building, selected, onSelect }: { building: VoxelVillageBuilding; selected: boolean; onSelect: () => void }) {
  const { voxelPosition, footprint } = building;
  const roofHeight = 0.45;
  return (
    <group position={[voxelPosition.x, 0, voxelPosition.z]} onClick={(event) => {
      event.stopPropagation();
      onSelect();
    }}>
      <mesh position={[0, footprint.height / 2, 0]}>
        <boxGeometry args={[footprint.width, footprint.height, footprint.depth]} />
        <meshStandardMaterial color={building.colorHex} roughness={0.82} />
      </mesh>
      <mesh position={[0, footprint.height + roofHeight / 2, 0]}>
        <boxGeometry args={[footprint.width + 0.35, roofHeight, footprint.depth + 0.35]} />
        <meshStandardMaterial color={selected ? '#ffe16f' : building.roofHex} roughness={0.74} />
      </mesh>
      <mesh position={[0, 0.04, footprint.depth / 2 + 0.08]}>
        <boxGeometry args={[0.58, 0.08, 0.18]} />
        <meshStandardMaterial color="#f4d09b" />
      </mesh>
      <Billboard position={[0, footprint.height + 1.05, 0]}>
        <Text
          fontSize={0.32}
          maxWidth={3.4}
          anchorX="center"
          anchorY="middle"
          color="#11233a"
          outlineWidth={0.025}
          outlineColor="#ffffff"
        >
          {building.name}
        </Text>
      </Billboard>
    </group>
  );
}

function VoxelAgent({ agent, selected, onSelect }: { agent: VoxelVillageAgent; selected: boolean; onSelect: () => void }) {
  const groupRef = useRef<Group>(null);
  const phase = useMemo(() => hashAgent(agent.id) * Math.PI * 2, [agent.id]);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;
    const t = clock.elapsedTime * 0.55 + phase;
    const walk = (Math.sin(t) + 1) / 2;
    group.position.x = agent.voxelPosition.x + (agent.pathTarget.x - agent.voxelPosition.x) * walk;
    group.position.z = agent.voxelPosition.z + (agent.pathTarget.z - agent.voxelPosition.z) * walk;
    group.position.y = Math.abs(Math.sin(t * 2)) * 0.06;
    group.rotation.y = Math.atan2(agent.pathTarget.x - agent.voxelPosition.x, agent.pathTarget.z - agent.voxelPosition.z);
  });

  return (
    <group
      ref={groupRef}
      position={[agent.voxelPosition.x, agent.voxelPosition.y, agent.voxelPosition.z]}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <mesh position={[0, 0.48, 0]}>
        <boxGeometry args={[0.46, 0.74, 0.34]} />
        <meshStandardMaterial color={selected ? '#fff176' : agent.color} roughness={0.65} />
      </mesh>
      <mesh position={[0, 1.0, 0]}>
        <boxGeometry args={[0.42, 0.38, 0.42]} />
        <meshStandardMaterial color="#f0c49a" roughness={0.6} />
      </mesh>
      <mesh position={[0, 1.28, 0]}>
        <boxGeometry args={[0.48, 0.18, 0.48]} />
        <meshStandardMaterial color="#273244" roughness={0.7} />
      </mesh>
      <Billboard position={[0, 1.95, 0]}>
        <group>
          <mesh position={[0, 0, -0.025]}>
            <planeGeometry args={[3.2, 0.92]} />
            <meshBasicMaterial color="#fffaf0" transparent opacity={0.93} />
          </mesh>
          <Text
            position={[0, 0.16, 0]}
            fontSize={0.18}
            maxWidth={2.82}
            anchorX="center"
            anchorY="middle"
            color="#152033"
          >
            {agent.name}
          </Text>
          <Text
            position={[0, -0.15, 0]}
            fontSize={0.14}
            maxWidth={2.76}
            anchorX="center"
            anchorY="middle"
            color="#41516c"
          >
            {agent.currentTask}
          </Text>
        </group>
      </Billboard>
    </group>
  );
}

function hashAgent(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return (hash % 1000) / 1000;
}
