import { Children, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { CanvasTexture, DoubleSide, LinearFilter, SRGBColorSpace } from 'three';
import type { ThreeElements } from '@react-three/fiber';

function collectTextCharacters(children: ReactNode) {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') {
        return String(child);
      }
      return '';
    })
    .join('');
}

type WorldTextProps = Omit<ThreeElements['mesh'], 'scale'> & {
  anchorX?: 'left' | 'center' | 'right' | number;
  anchorY?: 'top' | 'middle' | 'bottom' | number;
  characters?: string;
  children?: ReactNode;
  color?: string;
  depthOffset?: number;
  fontSize?: number;
  outlineColor?: string;
  outlineWidth?: number;
  scale?: ThreeElements['mesh']['scale'];
};

function anchorToUnit(anchor: WorldTextProps['anchorX'] | WorldTextProps['anchorY'], axis: 'x' | 'y') {
  if (typeof anchor === 'number') {
    return anchor;
  }
  if (axis === 'x') {
    return anchor === 'left' ? 0 : anchor === 'right' ? 1 : 0.5;
  }
  return anchor === 'top' ? 1 : anchor === 'bottom' ? 0 : 0.5;
}

function createTextTexture({
  text,
  color,
  fontSize,
  outlineColor,
  outlineWidth,
}: {
  text: string;
  color: string;
  fontSize: number;
  outlineColor: string;
  outlineWidth: number;
}) {
  const canvas = document.createElement('canvas');
  const safeText = text || ' ';
  const padding = Math.ceil(Math.max(4, outlineWidth * 2));
  const isJsdom = typeof navigator !== 'undefined' && navigator.userAgent.includes('jsdom');
  const context = isJsdom ? null : canvas.getContext('2d');

  if (!context) {
    canvas.width = Math.max(1, Math.ceil(safeText.length * fontSize * 0.6));
    canvas.height = Math.max(1, Math.ceil(fontSize * 1.4));
    return { texture: new CanvasTexture(canvas), width: canvas.width, height: canvas.height };
  }

  context.font = `700 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  context.textBaseline = 'middle';
  const metrics = context.measureText(safeText);
  const width = Math.ceil(metrics.width + padding * 2);
  const height = Math.ceil(fontSize * 1.45 + padding * 2);

  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);

  context.font = `700 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.lineWidth = outlineWidth * 2;

  const x = canvas.width / 2;
  const y = canvas.height / 2;

  if (outlineWidth > 0) {
    context.strokeStyle = outlineColor;
    context.strokeText(safeText, x, y);
  }

  context.fillStyle = color;
  context.fillText(safeText, x, y);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;

  return { texture, width: canvas.width, height: canvas.height };
}

export function WorldText({
  anchorX = 'center',
  anchorY = 'middle',
  characters,
  children,
  color = '#ffffff',
  depthOffset = -1,
  fontSize = 12,
  outlineColor = 'transparent',
  outlineWidth = 0,
  renderOrder = 1000,
  scale: callerScale,
  position: callerPosition,
}: WorldTextProps) {
  void characters;

  const text = collectTextCharacters(children);
  const textureData = useMemo(
    () => createTextTexture({
      text,
      color,
      fontSize,
      outlineColor,
      outlineWidth,
    }),
    [color, fontSize, outlineColor, outlineWidth, text],
  );

  useEffect(() => () => {
    textureData.texture.dispose();
  }, [textureData.texture]);

  const zOffset = typeof depthOffset === 'number' ? depthOffset * 0.001 : 0;
  const position: ThreeElements['mesh']['position'] = Array.isArray(callerPosition)
    ? [callerPosition[0] ?? 0, callerPosition[1] ?? 0, (callerPosition[2] ?? 0) + zOffset]
    : callerPosition;
  const scale = callerScale ?? ([1, -1, 1] satisfies [number, number, number]);
  const offsetX = (0.5 - anchorToUnit(anchorX, 'x')) * textureData.width;
  const offsetY = (0.5 - anchorToUnit(anchorY, 'y')) * textureData.height;

  return (
    <group
      position={position}
      renderOrder={renderOrder}
      scale={scale as ThreeElements['mesh']['scale']}
    >
      <mesh position={[offsetX, offsetY, 0]} renderOrder={renderOrder}>
        <planeGeometry args={[textureData.width, textureData.height]} />
        <meshBasicMaterial
          map={textureData.texture}
          transparent
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
          side={DoubleSide}
        />
      </mesh>
    </group>
  );
}
