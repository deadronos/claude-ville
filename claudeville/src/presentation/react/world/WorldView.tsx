import { useRef, useState } from 'react';

import { Canvas } from '@react-three/fiber';

import type { AgentSprite } from '../../character-mode/AgentSprite.js';
import { MinimapOverlay } from './components/MinimapOverlay.js';
import { SelectionOverlay } from './components/SelectionOverlay.js';
import { WorldScene } from './components/WorldScene.js';
import { BubbleDebugOverlay } from './components/BubbleDebugOverlay.js';
import { useWorldInteraction } from './hooks/useWorldInteraction.js';
import { useWorldSprites } from './hooks/useWorldSprites.js';
import { useWorldViewport } from './hooks/useWorldViewport.js';
import { useWorldStore } from './state/useWorldStore.js';
import type { CameraModel, InteractionModel, WorldViewProps } from './types.js';
import { createCenteredCamera, worldToIso } from './utils.js';

export function WorldView({
  active,
  bubbleConfig,
  onSelectAgent,
  onClearSelection,
}: WorldViewProps) {
  const agents = useWorldStore((s) => s.agents);
  const buildings = useWorldStore((s) => s.buildings);
  const selectedAgentId = useWorldStore((s) => s.selectedAgentId);
  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const selectedAgentName = selectedAgent?.name ?? null;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<CameraModel>(createCenteredCamera(1, 1));
  const roofAlphaRef = useRef(new Map<string, number>());
  const spritesRef = useRef<Map<string, AgentSprite>>(new Map());
  const interactionRef = useRef<InteractionModel>({
    dragging: false,
    moved: false,
    startX: 0,
    startY: 0,
    camStartX: 0,
    camStartZ: 0,
  });
  const [hoveredBuildingId, setHoveredBuildingId] = useState<string | null>(null);

  const { viewport, viewportRef } = useWorldViewport({ containerRef, cameraRef });
  const { dragging, handlers } = useWorldInteraction({
    active,
    containerRef,
    cameraRef,
    viewportRef,
    interactionRef,
  });
  const sprites = useWorldSprites(agents, spritesRef);

  const navigateToTile = (tileX: number, tileZ: number) => {
    const iso = worldToIso(tileX, tileZ);
    cameraRef.current.targetX = iso.x;
    cameraRef.current.targetZ = iso.y;
    cameraRef.current.followAgentId = null;
  };

  return (
    <div
      ref={containerRef}
      className={`content__character world-view ${active ? 'world-view--active' : 'world-view--inactive'} ${dragging ? 'world-view--dragging' : ''}`}
      {...handlers}
    >
      <Canvas
        orthographic
        dpr={[1, 2]}
        frameloop="always"
        gl={{ antialias: false, alpha: true, powerPreference: 'high-performance' }}
        className="content__canvas world-view__canvas"
        onPointerMissed={() => {
          if (!interactionRef.current.moved) {
            onClearSelection();
          }
          interactionRef.current.moved = false;
        }}
      >
        <WorldScene
          viewport={viewport}
          sprites={sprites}
          cameraRef={cameraRef}
          roofAlphaRef={roofAlphaRef}
          bubbleConfig={bubbleConfig}
          buildings={buildings}
          selectedAgentId={selectedAgentId}
          hoveredBuildingId={hoveredBuildingId}
          onSelectAgent={onSelectAgent}
          onHoverBuilding={setHoveredBuildingId}
          interactionRef={interactionRef}
        />
      </Canvas>
      <SelectionOverlay
        active={active}
        selectedAgentId={selectedAgentId}
        selectedAgentName={selectedAgentName}
        spritesRef={spritesRef}
        cameraRef={cameraRef}
        viewportRef={viewportRef}
      />
      <MinimapOverlay
        active={active}
        buildings={buildings}
        spritesRef={spritesRef}
        cameraRef={cameraRef}
        viewport={viewport}
        onNavigate={navigateToTile}
      />
      <BubbleDebugOverlay
        spritesRef={spritesRef}
        selectedAgentId={selectedAgentId}
        cameraRef={cameraRef}
      />
    </div>
  );
}
