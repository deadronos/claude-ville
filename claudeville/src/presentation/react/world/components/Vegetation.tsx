import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { MAP_SIZE } from '../../../../config/constants.js';

const VERTEX_SHADER = /* glsl */ `
  attribute vec3 instancePosition;
  varying vec2 vUv;
  uniform float uTime;

  void main() {
    vUv = uv;
    vec3 pos = position;
    
    // Wind effect: sway the top vertices (slower frequency)
    if (pos.y < 0.0) {
      float sway = sin(uTime * 1.2 + instancePosition.x * 0.1 + instancePosition.y * 0.1) * 1.5;
      pos.x += sway * (pos.y * -0.5);
    }

    // Pass depth through
    vec4 worldPos = vec4(instancePosition.x + pos.x, instancePosition.y + pos.y, instancePosition.z + pos.z, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * worldPos;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    // Darker grass blade gradient for contrast
    vec3 color = mix(vec3(0.15, 0.4, 0.15), vec3(0.25, 0.5, 0.2), vUv.y);
    gl_FragColor = vec4(color, 1.0);
  }
`;

export function Vegetation({ waterTiles }: { waterTiles: Set<string> }) {
  const meshRef = useRef<THREE.InstancedMesh | null>(null);

  const { positions, count } = useMemo(() => {
    const pos = [];
    const seed = 12345;
    const rng = (i: number) => fract(Math.sin(i * 0.1) * 43758.5453);
    const fract = (x: number) => x - Math.floor(x);

    for (let i = 0; i < 2000; i++) {
      const x = rng(seed + i) * MAP_SIZE;
      const y = rng(seed + i + 1000) * MAP_SIZE;
      const tileKey = `${Math.floor(x)},${Math.floor(y)}`;
      
      if (!waterTiles.has(tileKey)) {
        // Correct isometric projection for tile centers
        // isoX = (tileX - tileY) * TILE_WIDTH/2
        // isoY = (tileX + tileY) * TILE_HEIGHT/2
        const screenX = (x - y) * 32; // TILE_WIDTH/2
        const screenY = (x + y) * 16; // TILE_HEIGHT/2
        // Dynamic depth: terrain is at 0, agents/buildings start at ~10-20. 
        // We set grass at a depth that matches its Y position to participate in sorting.
        const depth = 5 + (y * 0.001) + (x * 0.00001); 
        pos.push(screenX, screenY, depth);
      }
    }
    return { positions: new Float32Array(pos), count: pos.length / 3 };
  }, [waterTiles]);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(4, 6);
    // Offset geometry so base is at 0,0
    geo.translate(0, -3, 0); 
    geo.setAttribute('instancePosition', new THREE.InstancedBufferAttribute(positions, 3));
    return geo;
  }, [positions]);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: { uTime: { value: 0 } },
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: true,
      depthTest: true,
    });
  }, []);

  useFrame((state) => {
    if (meshRef.current) {
      const mat = meshRef.current.material as THREE.ShaderMaterial | undefined;
      if (mat?.uniforms?.uTime) {
        mat.uniforms.uTime.value = state?.clock?.elapsedTime ?? 0;
      }
    }
  });

  if (count === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[geometry, material, count]} frustumCulled={false} />
  );
}
