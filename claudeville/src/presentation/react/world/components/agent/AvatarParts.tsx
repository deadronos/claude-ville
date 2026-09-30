import { useMemo } from 'react';
import * as THREE from 'three';

import { createPolygonGeometry } from '../../utils.js';

export function Hair({ style, color }: { style: string; color: string }) {
  const spikyGeometry = useMemo(() => createPolygonGeometry([[-4, 4], [-2, -2], [0, 3], [2, -2], [4, 4]]), []);

  switch (style) {
    case 'long':
      return (
        <group position={[0, -10, 0.1]}>
          <mesh scale={[5, 5, 1]}>
            <circleGeometry args={[1, 20, Math.PI, Math.PI]} />
            <meshBasicMaterial color={color} toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[-4, 1, 0]}>
            <planeGeometry args={[2, 8]} />
            <meshBasicMaterial color={color} toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[4, 1, 0]}>
            <planeGeometry args={[2, 8]} />
            <meshBasicMaterial color={color} toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
        </group>
      );
    case 'spiky':
      return (
        <mesh position={[0, -12, 0.1]} geometry={spikyGeometry}>
          <meshBasicMaterial color={color} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      );
    case 'mohawk':
      return (
        <mesh position={[0, -13, 0.1]}>
          <planeGeometry args={[2, 6]} />
          <meshBasicMaterial color={color} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      );
    case 'bald':
      return null;
    default:
      return (
        <mesh position={[0, -9, 0.1]} scale={[5, 5, 1]}>
          <circleGeometry args={[1, 20, Math.PI, Math.PI]} />
          <meshBasicMaterial color={color} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      );
  }
}

export function Eyes({ style }: { style: string }) {
  if (style === 'sleepy') {
    return (
      <group position={[0, -6.5, 0.11]}>
        <mesh position={[-2, 0, 0]}>
          <planeGeometry args={[2, 0.7]} />
          <meshBasicMaterial color="#000000" toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[2, 0, 0]}>
          <planeGeometry args={[2, 0.7]} />
          <meshBasicMaterial color="#000000" toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
    );
  }

  const eyeHeight = style === 'determined' ? 1.2 : 2;
  return (
    <group position={[0, -6.5, 0.11]}>
      <mesh position={[-2, 0, 0]}>
        <planeGeometry args={[2, eyeHeight]} />
        <meshBasicMaterial color="#000000" toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[2, 0, 0]}>
        <planeGeometry args={[2, eyeHeight]} />
        <meshBasicMaterial color="#000000" toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

export function Accessory({ type }: { type: string }) {
  const crownGeometry = useMemo(() => createPolygonGeometry([[-4, 3], [-4, 0], [-2, 2], [0, -1], [2, 2], [4, 0], [4, 3]]), []);

  switch (type) {
    case 'crown':
      return (
        <mesh position={[0, -15, 0.12]} geometry={crownGeometry}>
          <meshBasicMaterial color="#ffd700" toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      );
    case 'glasses':
      return (
        <group position={[0, -6.5, 0.12]}>
          <mesh position={[-2.5, 0, 0]}>
            <planeGeometry args={[3, 3]} />
            <meshBasicMaterial color="#333333" wireframe toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[2.5, 0, 0]}>
            <planeGeometry args={[3, 3]} />
            <meshBasicMaterial color="#333333" wireframe toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
        </group>
      );
    case 'headphones':
      return (
        <group position={[0, -7, 0.12]}>
          <mesh scale={[6, 6, 1]}>
            <ringGeometry args={[0.8, 1, 16, 1, Math.PI, Math.PI]} />
            <meshBasicMaterial color="#333333" toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[-6, 0, 0]}>
            <planeGeometry args={[3, 4]} />
            <meshBasicMaterial color="#555555" toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[6, 0, 0]}>
            <planeGeometry args={[3, 4]} />
            <meshBasicMaterial color="#555555" toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
        </group>
      );
    case 'hat':
      return (
        <group position={[0, -14, 0.12]}>
          <mesh position={[0, 2, 0]}>
            <planeGeometry args={[12, 2]} />
            <meshBasicMaterial color="#8b4513" toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, -1, 0]}>
            <planeGeometry args={[6, 4]} />
            <meshBasicMaterial color="#8b4513" toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
        </group>
      );
    default:
      return null;
  }
}
