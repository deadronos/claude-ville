import { useLayoutEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

import type { CameraModel, ViewportSize } from '../types.js';

export function ScreenSpaceCamera({
  viewport,
  cameraRef,
}: {
  viewport: ViewportSize;
  cameraRef?: { current: CameraModel };
}) {
  void cameraRef;
  const set = useThree((state) => state.set);
  const previousCamera = useThree((state) => state.camera);
  const camera = useMemo(() => {
    const nextCamera = new THREE.OrthographicCamera(0, viewport.width, 0, viewport.height, -1000, 1000);
    nextCamera.position.set(0, 0, 100);
    nextCamera.zoom = 1;
    nextCamera.updateProjectionMatrix();
    return nextCamera;
  }, [viewport.height, viewport.width]);

  useLayoutEffect(() => {
    set({ camera });
    return () => {
      set({ camera: previousCamera });
    };
  }, [camera, previousCamera, set]);

  return <primitive object={camera} />;
}
