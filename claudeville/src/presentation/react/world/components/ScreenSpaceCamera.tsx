import { OrthographicCamera } from '@react-three/drei';

import type { CameraModel, ViewportSize } from '../types.js';

export function ScreenSpaceCamera({
  viewport,
  cameraRef,
}: {
  viewport: ViewportSize;
  cameraRef?: { current: CameraModel };
}) {
  const x = cameraRef?.current?.x ?? 0;
  const y = cameraRef?.current?.y ?? 0;
  const zoom = cameraRef?.current?.zoom ?? 1;

  return (
    <OrthographicCamera
      makeDefault
      manual
      left={0}
      right={viewport.width}
      top={0}
      bottom={viewport.height}
      near={-1000}
      far={1000}
      position={[x, y, 100]}
      zoom={zoom}
    />
  );
}
