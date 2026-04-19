import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Canvas } from '@react-three/fiber';

import type { AgentSprite } from '../../character-mode/AgentSprite.js';
import { FocusReticle } from './components/FocusReticle.js';
import { MinimapOverlay } from './components/MinimapOverlay.js';
import { WorldScene } from './components/WorldScene.js';
import { useWorldSprites } from './hooks/useWorldSprites.js';
import type { CameraModel, InteractionModel, ViewportSize, WorldViewProps } from './types.js';
import { createCenteredCamera, getCameraFocusPosition, isoToScreen, screenToWorld } from './utils.js';

export function WorldView({
  active,
  agents,
  buildings,
  selectedAgentId,
  selectedAgentName,
  bubbleConfig,
  onSelectAgent,
  onClearSelection,
}: WorldViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<CameraModel>(createCenteredCamera(1, 1));
  const roofAlphaRef = useRef(new Map<string, number>());
  const spritesRef = useRef<Map<string, AgentSprite>>(new Map());
  const selectedMarkerRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<InteractionModel>({
    dragging: false,
    moved: false,
    startX: 0,
    startY: 0,
    camStartX: 0,
    camStartY: 0,
  });
  const viewportRef = useRef<ViewportSize>({ width: 1, height: 1 });
  const touchStateRef = useRef({
    initialDistance: 0,
    initialZoom: 0,
    centerWorldX: 0,
    centerWorldY: 0,
  });
  const [viewport, setViewport] = useState<ViewportSize>({ width: 1, height: 1 });
  const [dragging, setDragging] = useState(false);
  const [hoveredBuildingId, setHoveredBuildingId] = useState<string | null>(null);
  const [selectedAgentScreen, setSelectedAgentScreen] = useState<{ x: number; y: number } | null>(null);

  const sprites = useWorldSprites(agents, spritesRef);

  useEffect(() => {
    cameraRef.current.followAgentId = selectedAgentId;
  }, [selectedAgentId]);

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
        setSelectedAgentScreen({
          x: (sprite.x + cameraRef.current.x) * cameraRef.current.zoom,
          y: (sprite.y + cameraRef.current.y) * cameraRef.current.zoom,
        });
      }
      frameId = window.requestAnimationFrame(update);
    };

    frameId = window.requestAnimationFrame(update);
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [selectedAgentId]);

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

      if (previousCamera.followAgentId) {
        const sprite = spritesRef.current.get(previousCamera.followAgentId);
        if (sprite) {
          const focus = getCameraFocusPosition(sprite.x, sprite.y, { width, height }, previousCamera.zoom);
          cameraRef.current = {
            ...previousCamera,
            x: focus.x,
            y: focus.y,
          };
          return;
        }
      }

      const currentCenter = screenToWorld(previousViewport.width / 2, previousViewport.height / 2, previousCamera);
      cameraRef.current = {
        ...previousCamera,
        x: width / (2 * previousCamera.zoom) - currentCenter.x,
        y: height / (2 * previousCamera.zoom) - currentCenter.y,
      };
    };

    const observer = new ResizeObserver(() => resize());
    observer.observe(containerRef.current);
    resize();

    return () => {
      observer.disconnect();
    };
  }, []);

  const navigateToTile = (tileX: number, tileY: number) => {
    const screen = isoToScreen(tileX, tileY);
    const focus = getCameraFocusPosition(screen.x, screen.y, viewportRef.current, cameraRef.current.zoom);
    cameraRef.current.x = focus.x;
    cameraRef.current.y = focus.y;
    cameraRef.current.followAgentId = null;
  };

  return (
    <div
      ref={containerRef}
      className={`content__character world-view ${active ? 'world-view--active' : 'world-view--inactive'} ${dragging ? 'world-view--dragging' : ''}`}
      onPointerDown={(event) => {
        if (!active || event.button !== 0) {
          return;
        }
        interactionRef.current.dragging = true;
        interactionRef.current.moved = false;
        interactionRef.current.startX = event.clientX;
        interactionRef.current.startY = event.clientY;
        interactionRef.current.camStartX = cameraRef.current.x;
        interactionRef.current.camStartY = cameraRef.current.y;
        cameraRef.current.followAgentId = null;
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (!active || !interactionRef.current.dragging) {
          return;
        }
        const dx = event.clientX - interactionRef.current.startX;
        const dy = event.clientY - interactionRef.current.startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          interactionRef.current.moved = true;
        }
        cameraRef.current.x = interactionRef.current.camStartX + dx / cameraRef.current.zoom;
        cameraRef.current.y = interactionRef.current.camStartY + dy / cameraRef.current.zoom;
      }}
      onPointerUp={() => {
        if (!active) {
          return;
        }
        interactionRef.current.dragging = false;
        setDragging(false);
      }}
      onPointerLeave={() => {
        if (!active) {
          return;
        }
        interactionRef.current.dragging = false;
        setDragging(false);
      }}
      onWheel={(event) => {
        if (!active) {
          return;
        }
        event.preventDefault();
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) {
          return;
        }

        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        const worldBefore = screenToWorld(mouseX, mouseY, cameraRef.current);
        let rawDelta = event.deltaY;
        if (event.deltaMode === 1) {
          rawDelta *= 16;
        }
        if (event.deltaMode === 2) {
          rawDelta *= 100;
        }
        const clamped = Math.max(-60, Math.min(60, rawDelta));
        const factor = 1 - clamped * 0.003;
        cameraRef.current.zoom = Math.max(cameraRef.current.minZoom, Math.min(cameraRef.current.maxZoom, cameraRef.current.zoom * factor));
        cameraRef.current.x = mouseX / cameraRef.current.zoom - worldBefore.x;
        cameraRef.current.y = mouseY / cameraRef.current.zoom - worldBefore.y;
      }}
      onTouchStart={(event) => {
        if (event.touches.length === 2) {
          const t1 = event.touches[0];
          const t2 = event.touches[1];
          const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

          const rect = containerRef.current?.getBoundingClientRect();
          if (!rect) return;

          const centerX = (t1.clientX + t2.clientX) / 2 - rect.left;
          const centerY = (t1.clientY + t2.clientY) / 2 - rect.top;
          const worldBefore = screenToWorld(centerX, centerY, cameraRef.current);

          touchStateRef.current = {
            initialDistance: dist,
            initialZoom: cameraRef.current.zoom,
            centerWorldX: worldBefore.x,
            centerWorldY: worldBefore.y,
          };
        }
      }}
      onTouchMove={(event) => {
        if (active && event.touches.length === 2) {
          event.preventDefault(); // Prevent browser zoom/scroll
          const t1 = event.touches[0];
          const t2 = event.touches[1];
          const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
          const rect = containerRef.current?.getBoundingClientRect();
          if (!rect) return;

          const centerX = (t1.clientX + t2.clientX) / 2 - rect.left;
          const centerY = (t1.clientY + t2.clientY) / 2 - rect.top;
          const ratio = dist / touchStateRef.current.initialDistance;

          cameraRef.current.zoom = Math.max(
            cameraRef.current.minZoom,
            Math.min(cameraRef.current.maxZoom, touchStateRef.current.initialZoom * ratio)
          );

          cameraRef.current.x = centerX / cameraRef.current.zoom - touchStateRef.current.centerWorldX;
          cameraRef.current.y = centerY / cameraRef.current.zoom - touchStateRef.current.centerWorldY;
        }
      }}
      onTouchEnd={() => {
        touchStateRef.current.initialDistance = 0;
      }}
    >
      <Canvas
        orthographic
        dpr={[1, 2]}
        frameloop="always"
        gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
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
      {active && selectedAgentScreen ? (
        <div ref={selectedMarkerRef} className="world-view__selected-agent-marker" aria-hidden="true">
          <div className="world-view__selected-agent-ring" />
          {selectedAgentName ? <div className="world-view__selected-agent-label">{selectedAgentName}</div> : null}
        </div>
      ) : null}
      {active && selectedAgentId ? <FocusReticle label={selectedAgentName || selectedAgentId} /> : null}
      <MinimapOverlay
        buildings={buildings}
        spritesRef={spritesRef}
        cameraRef={cameraRef}
        viewport={viewport}
        onNavigate={navigateToTile}
      />
    </div>
  );
}
