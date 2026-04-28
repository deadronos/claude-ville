import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { TILE_HEIGHT, TILE_WIDTH } from '../../../../config/constants.js';
import { useTerrain } from '../hooks/useTerrain.js';

export const INSTANCED_TERRAIN_VERTEX_SHADER = /* glsl */ `
  attribute vec3 instanceColor;
  attribute float instanceWater;
  varying vec3 vColor;
  varying float vWater;
  varying vec2 vUv;
  varying vec3 vWorldPos;

  void main() {
    vColor = instanceColor;
    vWater = instanceWater;
    vUv = uv;
    vec4 transformed = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      transformed = instanceMatrix * transformed;
    #endif
    vWorldPos = transformed.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * transformed;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  varying vec3 vColor;
  varying float vWater;
  varying vec2 vUv;
  varying vec3 vWorldPos;

  // Simple noise for cloud shadows
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  void main() {
    vec4 color = vec4(vColor, 1.0);
    
    // Cloud shadows
    float cloud = noise(vWorldPos.xy * 0.005 + uTime * 0.05) * 0.15;
    color.rgb -= cloud;

    if (vWater > 0.5) {
      // Fluid water effect using scrolling noise
      float shimmer = noise(vWorldPos.xy * 0.05 + vec2(uTime * 0.1, uTime * 0.08)) * 0.15;
      float highlight = noise(vWorldPos.xy * 0.1 - vec2(uTime * 0.2, uTime * 0.15)) * 0.2;
      
      color.rgb += shimmer + highlight;
      color.a = 0.85; // Slight transparency
      
      // Soft edge foam based on UV
      float edge = (1.0 - length(vUv - 0.5) * 2.0);
      edge = smoothstep(0.0, 0.5, edge) * 0.2;
      color.rgb += edge;
    } else {
      // Subtle depth tint based on Y position
      color.rgb *= (1.0 - vWorldPos.y * 0.0001);
    }
    
    gl_FragColor = color;
  }
`;

export function InstancedTerrain({ buildings }: { buildings: any[] }) {
  const { tiles } = useTerrain(buildings);
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const shaderRef = useRef<THREE.ShaderMaterial | null>(null);

  const count = tiles.length;

  const { colorArray, waterArray, matrixArray } = useMemo(() => {
    const colorArray = new Float32Array(count * 3);
    const waterArray = new Float32Array(count);
    const matrixArray = new Float32Array(count * 16);
    const tempColor = new THREE.Color();
    const tempMatrix = new THREE.Matrix4();

    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      tempMatrix.makeTranslation(tile.x, tile.y, 0);
      tempMatrix.toArray(matrixArray, i * 16);

      tempColor.set(tile.color);
      colorArray[i * 3] = tempColor.r;
      colorArray[i * 3 + 1] = tempColor.g;
      colorArray[i * 3 + 2] = tempColor.b;
      waterArray[i] = tile.water ? 1.0 : 0.0;
    }

    return { colorArray, waterArray, matrixArray };
  }, [tiles, count]);

  const shaderMaterial = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: INSTANCED_TERRAIN_VERTEX_SHADER,
      fragmentShader,
      uniforms: { uTime: { value: 0 } },
      side: THREE.DoubleSide,
      transparent: true,
    });
    shaderRef.current = mat;
    return mat;
  }, []);

  const geometry = useMemo(() => {
    const diamond = new THREE.Shape();
    diamond.moveTo(0, -TILE_HEIGHT / 2);
    diamond.lineTo(TILE_WIDTH / 2, 0);
    diamond.lineTo(0, TILE_HEIGHT / 2);
    diamond.lineTo(-TILE_WIDTH / 2, 0);
    diamond.closePath();
    const geo = new THREE.ShapeGeometry(diamond);
    geo.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colorArray, 3));
    geo.setAttribute('instanceWater', new THREE.InstancedBufferAttribute(waterArray, 1));
    return geo;
  }, [colorArray, waterArray]);

  useEffect(() => {
    const instanceMatrix = meshRef.current?.instanceMatrix;
    if (instanceMatrix) {
      instanceMatrix.copyArray(matrixArray);
      instanceMatrix.needsUpdate = true;
    }
  }, [matrixArray]);

  useFrame(({ clock }) => {
    if (shaderRef.current) {
      shaderRef.current.uniforms.uTime.value = clock.elapsedTime;
    }
  });

  if (count === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[geometry, shaderMaterial, count]} frustumCulled={false} />
  );
}