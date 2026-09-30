import { useMemo } from 'react';
import * as THREE from 'three';

import type { BubbleConfig } from '../../types.js';
import { createRoundedRectGeometry } from '../../utils.js';
import { WorldText } from '../WorldText.js';

export function Bubble({
  text,
  accentColor,
  bubbleConfig,
  inverseZoom,
  y = -38,
}: {
  text: string;
  accentColor: string;
  bubbleConfig: BubbleConfig;
  inverseZoom: number;
  y?: number;
}) {
  const maxChars = Math.max(8, Math.floor((bubbleConfig.statusMaxWidth - bubbleConfig.statusPaddingH) / (bubbleConfig.statusFontSize * 0.56)));
  const displayText = text.length > maxChars ? `${text.slice(0, Math.max(1, maxChars - 1))}…` : text;
  const width = Math.min(displayText.length * bubbleConfig.statusFontSize * 0.56 + bubbleConfig.statusPaddingH, bubbleConfig.statusMaxWidth);
  const geometry = useMemo(
    () => createRoundedRectGeometry(width, bubbleConfig.statusBubbleH, 6),
    [bubbleConfig.statusBubbleH, width],
  );

  return (
    <group position={[0, y, 10]} scale={[inverseZoom, inverseZoom, 1]}>
      <mesh geometry={geometry}>
        <meshBasicMaterial color="#1a1a2e" toneMapped={false} side={THREE.DoubleSide} depthWrite={true} />
      </mesh>
      <lineSegments position={[0, 0, 0.01]}>
        <edgesGeometry args={[geometry]} />
        <lineBasicMaterial color={accentColor} toneMapped={false} />
      </lineSegments>
      <WorldText
        position={[0, 1, 0.1]}
        fontSize={bubbleConfig.statusFontSize}
        color="#eeeeee"
        anchorX="center"
        anchorY="middle"
        outlineWidth={Math.max(0.75, bubbleConfig.statusFontSize * 0.08)}
        outlineColor="#05070d"
        renderOrder={1001}
      >
        {displayText}
      </WorldText>
    </group>
  );
}
