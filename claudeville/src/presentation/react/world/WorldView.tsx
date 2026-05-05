import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Canvas } from '@react-three/fiber';

import type { AgentSprite } from '../../character-mode/AgentSprite.js';
import { FocusReticle } from './components/FocusReticle.js';
import { MinimapOverlay } from './components/MinimapOverlay.js';
import { WorldScene } from './components/WorldScene.js';
import { BubbleDebugOverlay } from './components/BubbleDebugOverlay.js';
import { PostProcessing } from './components/PostProcessing.js';
import { useWorldSprites } from './hooks/useWorldSprites.js';
import { useWorldStore } from './state/useWorldStore.js';
import type { CameraModel, InteractionModel, ViewportSize, WorldViewProps } from './types.js';
import { createCenteredCamera, getCameraFocusPosition, screenToIso, worldToIso } from './utils.js';

export function WorldView({
  active,
  bubbleConfig,
  onSelectAgent,
  onClearSelection,
}: Omit<WorldViewProps, 'agents' | 'buildings' | 'selectedAgentId' | 'selectedAgentName'>) {
  const agents = useWorldStore((s) => s.agents);
  const buildings = useWorldStore((s) => s.buildings);
  const selectedAgentId = useWorldStore((s) => s.selectedAgentId);
  const selectedAgent = agents.find((a) => a.id === selectedAgentId);
  const selectedAgentName = selectedAgent?.name ?? null;
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
    camStartZ: 0,
  });
  const viewportRef = useRef<ViewportSize>({ width: 1, height: 1 });
  const touchStateRef = useRef({
    initialDistance: 0,
    initialZoom: 0,
    centerIsoX: 0,
    centerIsoY: 0,
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
  }, []);

  // Manual wheel event listener with passive: false to allow preventDefault
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (event: WheelEvent) => {
      if (!active) return;
      event.preventDefault();

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;

      // Get iso point under cursor before zoom
      const isoBefore = screenToIso(mouseX, mouseY, cameraRef.current, viewportRef.current);

      // Calculate new zoom
      let rawDelta = event.deltaY;
      if (event.deltaMode === 1) rawDelta *= 16;
      if (event.deltaMode === 2) rawDelta *= 100;
      const clamped = Math.max(-60, Math.min(60, rawDelta));
      const factor = 1 - clamped * 0.003;
      const newZoom = Math.max(cameraRef.current.minZoom, Math.min(cameraRef.current.maxZoom, cameraRef.current.zoom * factor));

      // Temporarily set new zoom to get iso point after
      cameraRef.current.zoom = newZoom;
      const isoAfter = screenToIso(mouseX, mouseY, cameraRef.current, viewportRef.current);

      // Adjust target to keep the iso point under cursor stationary
      cameraRef.current.targetX += isoBefore.x - isoAfter.x;
      cameraRef.current.targetZ += isoBefore.y - isoAfter.y;
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [active]);

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
      onPointerDown={(event) => {
        if (!active || event.button !== 0) {
          return;
        }
        event.currentTarget.setPointerCapture?.(event.pointerId);
        interactionRef.current.dragging = true;
        interactionRef.current.moved = false;
        interactionRef.current.startX = event.clientX;
        interactionRef.current.startY = event.clientY;
        interactionRef.current.camStartX = cameraRef.current.targetX;
        interactionRef.current.camStartZ = cameraRef.current.targetZ;
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
        // Pan opposite to drag direction (drag right -> world appears to move left)
        cameraRef.current.targetX = interactionRef.current.camStartX - dx / cameraRef.current.zoom;
        cameraRef.current.targetZ = interactionRef.current.camStartZ - dy / cameraRef.current.zoom;
      }}
      onPointerUp={(event) => {
        if (!active) {
          return;
        }
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        interactionRef.current.dragging = false;
        setDragging(false);
      }}
      onPointerCancel={(event) => {
        if (!active) {
          return;
        }
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        interactionRef.current.dragging = false;
        setDragging(false);
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
          const isoBefore = screenToIso(centerX, centerY, cameraRef.current, viewportRef.current);

          touchStateRef.current = {
            initialDistance: dist,
            initialZoom: cameraRef.current.zoom,
            centerIsoX: isoBefore.x,
            centerIsoY: isoBefore.y,
          };
        }
      }}
      onTouchMove={(event) => {
        if (active && event.touches.length === 2) {
          event.preventDefault();
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

          const isoAfter = screenToIso(centerX, centerY, cameraRef.current, viewportRef.current);
          cameraRef.current.targetX += touchStateRef.current.centerIsoX - isoAfter.x;
          cameraRef.current.targetZ += touchStateRef.current.centerIsoY - isoAfter.y;
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
        <PostProcessing />
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
      <BubbleDebugOverlay
        spritesRef={spritesRef}
        selectedAgentId={selectedAgentId}
        cameraRef={cameraRef}
      />
    </div>
  );
}
