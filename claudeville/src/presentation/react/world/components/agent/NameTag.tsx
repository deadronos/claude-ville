import { useMemo } from 'react';
import * as THREE from 'three';

import { createRoundedRectGeometry } from '../../utils.js';
import { WorldText } from '../WorldText.js';

export function NameTag({ name, inverseZoom }: { name: string; inverseZoom: number }) {
  const width = Math.max(name.length * 6 + 14, 48);
  const geometry = useMemo(() => createRoundedRectGeometry(width, 16, 4), [width]);

  return (
    <group position={[0, 24, 10]} scale={[inverseZoom, inverseZoom, 1]}>
      <mesh geometry={geometry}>
        <meshBasicMaterial color="#e8d44d" toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <WorldText position={[0, 1, 0.1]} fontSize={10} color="#1a1a2e" anchorX="center" anchorY="middle" outlineWidth={0.8} outlineColor="#f6e98d">
        {name}
      </WorldText>
    </group>
  );
}
