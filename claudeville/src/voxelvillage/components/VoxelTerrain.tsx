import type { VoxelVillageSnapshot } from '../model.js';

export function VoxelGround({ roads }: { roads: VoxelVillageSnapshot['roads'] }) {
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
