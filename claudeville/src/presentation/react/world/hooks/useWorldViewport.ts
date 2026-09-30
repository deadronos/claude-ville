import { useLayoutEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

import type { CameraModel, ViewportSize } from '../types.js';
import { createCenteredCamera } from '../utils.js';

export function useWorldViewport({
  containerRef,
  cameraRef,
}: {
  containerRef: MutableRefObject<HTMLDivElement | null>;
  cameraRef: MutableRefObject<CameraModel>;
}) {
  const viewportRef = useRef<ViewportSize>({ width: 1, height: 1 });
  const [viewport, setViewport] = useState<ViewportSize>({ width: 1, height: 1 });

  useLayoutEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const resize = () => {
      if (!containerRef.current) {
        return;
      }
      const width = Math.max(1, containerRef.current.clientWidth);
      const height = Math.max(1, containerRef.current.clientHeight);
      const previousViewport = viewportRef.current;
      const previousCamera = cameraRef.current;

      viewportRef.current = { width, height };
      setViewport(viewportRef.current);

      if (previousViewport.width <= 1 || previousViewport.height <= 1) {
        cameraRef.current = {
          ...createCenteredCamera(width, height, previousCamera.zoom),
          followAgentId: previousCamera.followAgentId,
        };
        return;
      }

      // Keep the same world point centered after resize
      // The targetX/targetZ are already in isometric world coordinates
      // Just keep them as is, zoom stays the same
    };

    const observer = new ResizeObserver(() => resize());
    observer.observe(containerRef.current);
    resize();

    return () => {
      observer.disconnect();
    };
  }, [containerRef, cameraRef]);

  return { viewport, viewportRef };
}
