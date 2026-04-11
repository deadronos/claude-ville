// packages/frontend/src/components/Dashboard/AvatarCanvas.tsx

import * as React from 'react';
import { AvatarCanvas as AvatarCanvasRenderer } from '@claude-ville/canvas-renderer';
import type { Agent } from '@claude-ville/canvas-renderer';

interface Props {
  agent: Agent;
  width?: number;
  height?: number;
}

export function AvatarCanvas({ agent, width = 36, height = 48 }: Props) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const rendererRef = React.useRef<AvatarCanvasRenderer | null>(null);

  React.useEffect(() => {
    if (!canvasRef.current) return;
    // Draw once — AvatarCanvas is a static renderer
    rendererRef.current = new AvatarCanvasRenderer(agent);
    const canvas = rendererRef.current.canvas;
    canvas.style.imageRendering = 'pixelated';
    // Clear ref canvas and draw
    const ctx = canvasRef.current.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(canvas, 0, 0);
    }
  }, [agent]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ imageRendering: 'pixelated', display: 'block' }}
    />
  );
}
