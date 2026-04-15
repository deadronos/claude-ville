import { OrthographicCamera } from '@react-three/drei';

import type { ViewportSize } from '../types.js';

export function ScreenSpaceCamera({ viewport }: { viewport: ViewportSize }) {
  return (
    <OrthographicCamera
      makeDefault
      left={0}
      right={viewport.width}
      top={0}
      bottom={viewport.height}
      near={-1000}
      far={1000}
      position={[0, 0, 100]}
      zoom={1}
    />
  );
}
