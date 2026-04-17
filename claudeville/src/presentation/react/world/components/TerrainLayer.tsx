import { useMemo, useRef } from 'react';

import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { TILE_HEIGHT, TILE_WIDTH } from '../../../../config/constants.js';
import { useTerrain } from '../hooks/useTerrain.js';
import type { TerrainTileModel } from '../types.js';
import { createPolygonGeometry } from '../utils.js';

function TerrainTile({ tile, geometry }: { tile: TerrainTileModel; geometry: THREE.ShapeGeometry }) {
  const shimmerMaterial = useRef<THREE.MeshBasicMaterial | null>(null);

  useFrame(({ clock }) => {
    if (!tile.water || !shimmerMaterial.current) {
      return;
    }
    shimmerMaterial.current.opacity = Math.sin(clock.elapsedTime * 2 + tile.x * 0.015 + tile.y * 0.02) * 0.15 + 0.18;
  });

  return (
    <group position={[tile.x, tile.y, 0]}>
      <mesh geometry={geometry} position={[0, 0, 0]}>
        <meshBasicMaterial color={tile.color} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      {tile.water ? (
        <mesh geometry={geometry} position={[0, 0, 0.01]}>
          <meshBasicMaterial ref={shimmerMaterial} color="#ffffff" transparent opacity={0.12} toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ) : null}
    </group>
  );
}

export function TerrainLayer({ buildings }: { buildings: any[] }) {
  const { tiles } = useTerrain(buildings);
  const diamondGeometry = useMemo(() => createPolygonGeometry([
    [0, -TILE_HEIGHT / 2],
    [TILE_WIDTH / 2, 0],
    [0, TILE_HEIGHT / 2],
    [-TILE_WIDTH / 2, 0],
  ]), []);

  return (
    <group>
      {tiles.map((tile) => (
        <TerrainTile key={tile.key} tile={tile} geometry={diamondGeometry} />
      ))}
    </group>
  );
}
