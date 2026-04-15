import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';

import { MAP_SIZE } from '../../../../config/constants.js';
import { THEME } from '../../../../config/theme.js';
import type { AgentSprite } from '../../../character-mode/AgentSprite.js';
import { MINIMAP_SIZE, BUILDING_STYLES } from '../styles.js';
import type { CameraModel, ViewportSize } from '../types.js';
import { screenToTile } from '../utils.js';

export function MinimapOverlay({
  buildings,
  spritesRef,
  cameraRef,
  viewport,
  onNavigate,
}: {
  buildings: any[];
  spritesRef: MutableRefObject<Map<string, AgentSprite>>;
  cameraRef: MutableRefObject<CameraModel>;
  viewport: ViewportSize;
  onNavigate: (tileX: number, tileY: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let frameId = 0;
    const draw = () => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (!canvas || !context) {
        frameId = window.requestAnimationFrame(draw);
        return;
      }

      const scale = MINIMAP_SIZE / MAP_SIZE;
      context.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
      context.fillStyle = '#0a0f0a';
      context.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
      context.fillStyle = THEME.grass[1];
      context.globalAlpha = 0.4;
      context.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
      context.globalAlpha = 1;

      for (const building of buildings) {
        context.fillStyle = BUILDING_STYLES[building.type]?.accentColor || '#666666';
        context.fillRect(
          building.position.tileX * scale,
          building.position.tileY * scale,
          building.width * scale,
          building.height * scale,
        );
      }

      for (const sprite of spritesRef.current.values()) {
        const tile = screenToTile(sprite.x, sprite.y, { ...cameraRef.current, x: 0, y: 0, zoom: 1, followAgentId: null, followSmoothing: 0, minZoom: 0.5, maxZoom: 3 });
        context.fillStyle = sprite.agent.status === 'working' ? THEME.working : sprite.agent.status === 'waiting' ? THEME.waiting : THEME.idle;
        context.beginPath();
        context.arc(tile.tileX * scale, tile.tileY * scale, 2, 0, Math.PI * 2);
        context.fill();
      }

      const topLeft = screenToTile(0, 0, cameraRef.current);
      const bottomRight = screenToTile(viewport.width, viewport.height, cameraRef.current);
      context.strokeStyle = '#ff4444';
      context.lineWidth = 1.5;
      context.strokeRect(
        topLeft.tileX * scale,
        topLeft.tileY * scale,
        (bottomRight.tileX - topLeft.tileX) * scale,
        (bottomRight.tileY - topLeft.tileY) * scale,
      );

      context.strokeStyle = THEME.border;
      context.lineWidth = 1;
      context.strokeRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

      frameId = window.requestAnimationFrame(draw);
    };

    frameId = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [buildings, cameraRef, spritesRef, viewport.height, viewport.width]);

  return (
    <div className="world-view__minimap">
      <canvas
        ref={canvasRef}
        width={MINIMAP_SIZE}
        height={MINIMAP_SIZE}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const scale = MINIMAP_SIZE / MAP_SIZE;
          onNavigate((event.clientX - rect.left) / scale, (event.clientY - rect.top) / scale);
        }}
      />
    </div>
  );
}
