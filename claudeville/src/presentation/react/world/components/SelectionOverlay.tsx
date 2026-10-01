import type { MutableRefObject } from 'react';

import type { AgentSprite } from '../../../character-mode/AgentSprite.js';
import { useSelectedAgentOverlay } from '../hooks/useSelectedAgentOverlay.js';
import type { CameraModel, ViewportSize } from '../types.js';

export function SelectionOverlay({
  active,
  selectedAgentId,
  selectedAgentName,
  spritesRef,
  cameraRef,
  viewportRef,
}: {
  active: boolean;
  selectedAgentId: string | null;
  selectedAgentName: string | null;
  spritesRef: MutableRefObject<Map<string, AgentSprite>>;
  cameraRef: MutableRefObject<CameraModel>;
  viewportRef: MutableRefObject<ViewportSize>;
}) {
  const { markerRef } = useSelectedAgentOverlay({
    active,
    selectedAgentId,
    spritesRef,
    cameraRef,
    viewportRef,
  });

  if (!active || !selectedAgentId) {
    return null;
  }

  return (
    <>
      <div
        ref={markerRef}
        className="world-view__selected-agent-marker"
        aria-hidden="true"
        style={{ visibility: 'hidden' }}
      >
        <div className="world-view__selected-agent-ring" />
        {selectedAgentName ? <div className="world-view__selected-agent-label">{selectedAgentName}</div> : null}
      </div>
      <div className="world-view__focus-badge">Following {selectedAgentName || selectedAgentId}</div>
    </>
  );
}
