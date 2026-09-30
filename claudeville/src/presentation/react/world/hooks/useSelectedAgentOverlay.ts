import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

import type { AgentSprite } from '../../../character-mode/AgentSprite.js';
import type { CameraModel, ViewportSize } from '../types.js';
import { getCameraFocusPosition } from '../utils.js';

export function useSelectedAgentOverlay({
  selectedAgentId,
  spritesRef,
  cameraRef,
  viewportRef,
}: {
  selectedAgentId: string | null;
  spritesRef: MutableRefObject<Map<string, AgentSprite>>;
  cameraRef: MutableRefObject<CameraModel>;
  viewportRef: MutableRefObject<ViewportSize>;
}) {
  const selectedMarkerRef = useRef<HTMLDivElement | null>(null);
  const [selectedAgentScreen, setSelectedAgentScreen] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    cameraRef.current.followAgentId = selectedAgentId;
  }, [selectedAgentId, cameraRef]);

  useEffect(() => {
    if (!selectedAgentId) {
      setSelectedAgentScreen(null);
      return;
    }

    let frameId = 0;
    const update = () => {
      const sprite = spritesRef.current.get(selectedAgentId);
      if (!sprite) {
        setSelectedAgentScreen(null);
      } else {
        const camera = cameraRef.current;
        const focus = getCameraFocusPosition(
          camera.targetX,
          camera.targetZ,
          viewportRef.current,
          camera.zoom,
        );
        setSelectedAgentScreen({
          x: sprite.x * camera.zoom + focus.x,
          y: sprite.y * camera.zoom + focus.y,
        });
      }
      frameId = window.requestAnimationFrame(update);
    };

    frameId = window.requestAnimationFrame(update);
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [selectedAgentId, spritesRef, cameraRef, viewportRef]);

  useEffect(() => {
    if (!selectedMarkerRef.current) {
      return;
    }
    if (!selectedAgentScreen) {
      selectedMarkerRef.current.style.left = '-9999px';
      selectedMarkerRef.current.style.top = '-9999px';
      return;
    }
    selectedMarkerRef.current.style.left = `${selectedAgentScreen.x}px`;
    selectedMarkerRef.current.style.top = `${selectedAgentScreen.y}px`;
  }, [selectedAgentScreen]);

  return { selectedMarkerRef, selectedAgentScreen };
}
