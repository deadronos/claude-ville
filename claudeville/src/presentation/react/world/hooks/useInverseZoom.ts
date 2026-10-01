import { useState } from 'react';
import type { MutableRefObject } from 'react';

import { useFrame } from '@react-three/fiber';

import type { CameraModel } from '../types.js';

export function useInverseZoom(cameraRef: MutableRefObject<CameraModel>) {
  const [inverseZoom, setInverseZoom] = useState(() => 1 / cameraRef.current.zoom);

  // One setter call per agent per frame while the world is visible. This is a
  // deliberate exception to the "no idle render work" rule: React bails out when
  // the value is unchanged, and zoom only moves on user input. While the world
  // is hidden the parent Canvas switches to frameloop="demand", so this frame
  // callback is not called at all.
  useFrame(() => {
    const nextInverseZoom = 1 / cameraRef.current.zoom;
    setInverseZoom((current) => current === nextInverseZoom ? current : nextInverseZoom);
  });

  return inverseZoom;
}
