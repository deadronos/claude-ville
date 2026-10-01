import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';

import type { AgentSprite } from '../../../character-mode/AgentSprite.js';
import { subscribeFrame } from '../frameTicker.js';
import type { CameraModel, ViewportSize } from '../types.js';
import { getCameraFocusPosition } from '../utils.js';

export function useSelectedAgentOverlay({
  active,
  selectedAgentId,
  spritesRef,
  cameraRef,
  viewportRef,
}: {
  active: boolean;
  selectedAgentId: string | null;
  spritesRef: MutableRefObject<Map<string, AgentSprite>>;
  cameraRef: MutableRefObject<CameraModel>;
  viewportRef: MutableRefObject<ViewportSize>;
}) {
  const markerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    cameraRef.current.followAgentId = selectedAgentId;
  }, [selectedAgentId, cameraRef]);

  useEffect(() => {
    if (!active || !selectedAgentId) {
      return;
    }

    const update = () => {
      const marker = markerRef.current;
      if (!marker) {
        return;
      }

      const sprite = spritesRef.current.get(selectedAgentId);
      if (!sprite) {
        marker.style.visibility = 'hidden';
        return;
      }

      const camera = cameraRef.current;
      const focus = getCameraFocusPosition(
        camera.targetX,
        camera.targetZ,
        viewportRef.current,
        camera.zoom,
      );
      marker.style.left = `${sprite.x * camera.zoom + focus.x}px`;
      marker.style.top = `${sprite.y * camera.zoom + focus.y}px`;
      marker.style.visibility = 'visible';
    };

    update();
    return subscribeFrame(update);
  }, [active, selectedAgentId, spritesRef, cameraRef, viewportRef]);

  return { markerRef };
}
