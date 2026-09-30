import * as THREE from 'three';

import { THEME } from '../../../../../config/theme.js';
import { AgentStatus } from '../../../../../domain/value-objects/AgentStatus.js';
import type { BubbleConfig } from '../../types.js';
import { WorldText } from '../WorldText.js';

export function IdleIndicator({ inverseZoom }: { inverseZoom: number }) {
  return (
    <group position={[0, -30, 10]} scale={[inverseZoom, inverseZoom, 1]}>
      <WorldText position={[10, 8, 0.1]} fontSize={9} color={THEME.idle} anchorX="center" anchorY="middle">z</WorldText>
      <WorldText position={[16, -2, 0.1]} fontSize={12} color={THEME.idle} anchorX="center" anchorY="middle">z</WorldText>
      <WorldText position={[22, -14, 0.1]} fontSize={15} color={THEME.idle} anchorX="center" anchorY="middle">Z</WorldText>
    </group>
  );
}

export function ChatIndicator({ bubbleConfig, inverseZoom }: { bubbleConfig: BubbleConfig; inverseZoom: number }) {
  return (
    <group position={[0, -42, 10]} scale={[inverseZoom, inverseZoom, 1]}>
      <mesh scale={[14, 14, 1]}>
        <circleGeometry args={[1, 20]} />
        <meshBasicMaterial color="#1a1a2e" toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <WorldText position={[0, 0, 0.1]} fontSize={bubbleConfig.chatFontSize} color="#4ade80" anchorX="center" anchorY="middle">💬</WorldText>
    </group>
  );
}

export function StatusIcon({ status, inverseZoom }: { status: string; inverseZoom: number }) {
  const icon = status === AgentStatus.WORKING ? '⚙️' : status === AgentStatus.WAITING ? '⏳' : '💤';
  return (
    <group position={[18, -32, 11]} scale={[inverseZoom * 0.8, inverseZoom * 0.8, 1]}>
      <WorldText fontSize={12} anchorX="center" anchorY="middle">{icon}</WorldText>
    </group>
  );
}
