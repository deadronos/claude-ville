import { useLayoutEffect, useMemo, useRef } from 'react';
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
  const restoreCameraRef = useRef(previousCamera);
  const camera = useMemo(() => {
    const nextCamera = new THREE.OrthographicCamera(0, viewport.width, 0, viewport.height, -1000, 1000) as THREE.OrthographicCamera & { manual?: boolean };
    nextCamera.manual = true;
    nextCamera.position.set(0, 0, 100);
    nextCamera.zoom = 1;
    nextCamera.updateProjectionMatrix();
    return nextCamera;
  }, []);

  useLayoutEffect(() => {
    camera.left = 0;
    camera.right = viewport.width;
    camera.top = 0;
    camera.bottom = viewport.height;
    camera.near = -1000;
    camera.far = 1000;
    camera.zoom = 1;
    camera.updateProjectionMatrix();
  }, [camera, viewport.height, viewport.width]);

  useLayoutEffect(() => {
    set({ camera });
    return () => {
      set({ camera: restoreCameraRef.current });
    };
  }, [camera, set]);

  return <primitive object={camera} />;
}
