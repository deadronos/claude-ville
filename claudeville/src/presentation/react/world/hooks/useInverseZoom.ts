import { useState } from 'react';
import type { MutableRefObject } from 'react';

import { useFrame } from '@react-three/fiber';

import type { CameraModel } from '../types.js';

export function useInverseZoom(cameraRef: MutableRefObject<CameraModel>) {
  const [inverseZoom, setInverseZoom] = useState(() => 1 / cameraRef.current.zoom);

  useFrame(() => {
    const nextInverseZoom = 1 / cameraRef.current.zoom;
    setInverseZoom((current) => current === nextInverseZoom ? current : nextInverseZoom);
  });

  return inverseZoom;
}
