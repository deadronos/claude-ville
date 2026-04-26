import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { TILE_HEIGHT, TILE_WIDTH } from '../../../../config/constants.js';
import { useTerrain } from '../hooks/useTerrain.js';

const vertexShader = /* glsl */ `
  attribute vec3 instanceColor;
  attribute float instanceWater;
  varying vec3 vColor;
  varying float vWater;
  varying vec2 vUv;

  void main() {
    vColor = instanceColor;
    vWater = instanceWater;
    vUv = uv;
    vec3 pos = position;
    #ifdef USE_INSTANCING
      mat4 instanceMat = instanceMatrix;
      vec4 worldPos = instanceMat * vec4(pos, 1.0);
      gl_Position = projectionMatrix * viewMatrix * worldPos;
    #else
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    #endif
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  varying vec3 vColor;
  varying float vWater;
  varying vec2 vUv;

  void main() {
    vec4 color = vec4(vColor, 1.0);
    if (vWater > 0.5) {
      float shimmer = sin(uTime * 2.0 + vUv.x * 10.0 + vUv.y * 8.0) * 0.15 + 0.18;
      color.rgb += shimmer;
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
      vertexShader,
      fragmentShader,
      uniforms: { uTime: { value: 0 } },
      side: THREE.DoubleSide,
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
    if (meshRef.current && meshRef.current.instanceMatrix && typeof meshRef.current.instanceMatrix.fromArray === 'function') {
      meshRef.current.instanceMatrix.fromArray(matrixArray);
      meshRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [matrixArray]);

  useFrame(({ clock }) => {
    if (shaderRef.current) {
      shaderRef.current.uniforms.uTime.value = clock.elapsedTime;
    }
  });

  if (count === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[geometry, shaderMaterial, count]} />
  );
}