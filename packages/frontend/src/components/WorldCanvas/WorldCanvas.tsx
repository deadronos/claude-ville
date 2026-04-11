// packages/frontend/src/components/WorldCanvas/WorldCanvas.tsx

import * as React from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { sessionsAtom, selectedAgentIdAtom } from '../../store';
import { pixelTheme } from '@claude-ville/ui';
import { buildWorld } from '../../adapters/world-adapter';

export function WorldCanvas() {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const rendererRef = React.useRef<{
    show: (canvas: HTMLCanvasElement) => void;
    hide: () => void;
    selectAgentById: (id: string | null) => void;
    onAgentSelect: ((agent: { id: string } | null) => void) | null;
  } | null>(null);
  const sessions = useAtomValue(sessionsAtom);
  const selectedAgentId = useAtomValue(selectedAgentIdAtom);
  const setSelectedAgentId = useSetAtom(selectedAgentIdAtom);

  // Mount IsometricRenderer on canvas
  React.useEffect(() => {
    let mounted = true;

    async function mountRenderer() {
      if (!canvasRef.current || !containerRef.current) return;

      const canvas = canvasRef.current;
      const container = containerRef.current;

      // Size canvas to container
      const resize = () => {
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
      };
      resize();

      try {
        const module = await import('@claude-ville/canvas-renderer');
        const { IsometricRenderer } = module;
        const world = buildWorld(sessions);
        const renderer = new IsometricRenderer(world);
        rendererRef.current = renderer;

        renderer.show(canvas);
        renderer.onAgentSelect = (agent: { id: string } | null) => {
          if (mounted) {
            setSelectedAgentId(agent?.id ?? null);
          }
        };
      } catch (err) {
        console.warn('[WorldCanvas] IsometricRenderer not available:', err);
      }
    }

    mountRenderer();

    return () => {
      mounted = false;
      if (rendererRef.current) {
        rendererRef.current.hide();
        rendererRef.current = null;
      }
    };
  }, []); // mount once

  // Sync selectedAgentId from store → renderer
  React.useEffect(() => {
    if (!rendererRef.current) return;
    rendererRef.current.selectAgentById(selectedAgentId ?? null);
  }, [selectedAgentId]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: pixelTheme.colors.background,
        position: 'relative',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
    </div>
  );
}
