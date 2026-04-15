import { useRef } from 'react';
import type { MutableRefObject } from 'react';

import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import type { AgentSprite } from '../../../character-mode/AgentSprite.js';
import { THEME } from '../../../../config/theme.js';
import { AgentStatus } from '../../../../domain/value-objects/AgentStatus.js';
import type { BubbleConfig, CameraModel } from '../types.js';
import { createPolygonGeometry, createRoundedRectGeometry } from '../utils.js';
import { WorldText } from './WorldText.js';

function Bubble({
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
  const geometry = createRoundedRectGeometry(width, bubbleConfig.statusBubbleH, 6);

  return (
    <group position={[0, y, 0.2]} scale={[inverseZoom, inverseZoom, 1]}>
      <mesh geometry={geometry}>
        <meshBasicMaterial color="#1a1a2e" toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[geometry]} />
        <lineBasicMaterial color={accentColor} toneMapped={false} />
      </lineSegments>
      <WorldText
        position={[0, 1, 0.01]}
        fontSize={bubbleConfig.statusFontSize}
        color="#eeeeee"
        anchorX="center"
        anchorY="middle"
        outlineWidth={Math.max(0.75, bubbleConfig.statusFontSize * 0.08)}
        outlineColor="#05070d"
      >
        {displayText}
      </WorldText>
    </group>
  );
}

function NameTag({ name, inverseZoom }: { name: string; inverseZoom: number }) {
  const width = Math.max(name.length * 6 + 14, 48);
  const geometry = createRoundedRectGeometry(width, 16, 4);

  return (
    <group position={[0, 24, 0.2]} scale={[inverseZoom, inverseZoom, 1]}>
      <mesh geometry={geometry}>
        <meshBasicMaterial color="#e8d44d" toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <WorldText position={[0, 1, 0.01]} fontSize={10} color="#1a1a2e" anchorX="center" anchorY="middle" outlineWidth={0.8} outlineColor="#f6e98d">
        {name}
      </WorldText>
    </group>
  );
}

function IdleIndicator({ inverseZoom }: { inverseZoom: number }) {
  return (
    <group position={[0, -30, 0.2]} scale={[inverseZoom, inverseZoom, 1]}>
      <WorldText position={[10, 8, 0]} fontSize={9} color={THEME.idle} anchorX="center" anchorY="middle">z</WorldText>
      <WorldText position={[16, -2, 0]} fontSize={12} color={THEME.idle} anchorX="center" anchorY="middle">z</WorldText>
      <WorldText position={[22, -14, 0]} fontSize={15} color={THEME.idle} anchorX="center" anchorY="middle">Z</WorldText>
    </group>
  );
}

function ChatIndicator({ bubbleConfig, inverseZoom }: { bubbleConfig: BubbleConfig; inverseZoom: number }) {
  return (
    <group position={[0, -38, 0.25]} scale={[inverseZoom, inverseZoom, 1]}>
      <mesh scale={[14, 14, 1]}>
        <circleGeometry args={[1, 20]} />
        <meshBasicMaterial color="#1a1a2e" toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <WorldText position={[0, 0, 0.02]} fontSize={bubbleConfig.chatFontSize} color="#4ade80" anchorX="center" anchorY="middle">...</WorldText>
    </group>
  );
}

function Hair({ style, color }: { style: string; color: string }) {
  switch (style) {
    case 'long':
      return (
        <group position={[0, -10, 0.1]}>
          <mesh scale={[5, 5, 1]}>
            <circleGeometry args={[1, 20, Math.PI, Math.PI]} />
            <meshBasicMaterial color={color} toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[-4, 1, 0]}>
            <planeGeometry args={[2, 8]} />
            <meshBasicMaterial color={color} toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[4, 1, 0]}>
            <planeGeometry args={[2, 8]} />
            <meshBasicMaterial color={color} toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
        </group>
      );
    case 'spiky':
      return (
        <mesh position={[0, -12, 0.1]} geometry={createPolygonGeometry([[-4, 4], [-2, -2], [0, 3], [2, -2], [4, 4]])}>
          <meshBasicMaterial color={color} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      );
    case 'mohawk':
      return (
        <mesh position={[0, -13, 0.1]}>
          <planeGeometry args={[2, 6]} />
          <meshBasicMaterial color={color} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      );
    case 'bald':
      return null;
    default:
      return (
        <mesh position={[0, -9, 0.1]} scale={[5, 5, 1]}>
          <circleGeometry args={[1, 20, Math.PI, Math.PI]} />
          <meshBasicMaterial color={color} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      );
  }
}

function Eyes({ style }: { style: string }) {
  if (style === 'sleepy') {
    return (
      <group position={[0, -6.5, 0.11]}>
        <mesh position={[-2, 0, 0]}>
          <planeGeometry args={[2, 0.7]} />
          <meshBasicMaterial color="#000000" toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[2, 0, 0]}>
          <planeGeometry args={[2, 0.7]} />
          <meshBasicMaterial color="#000000" toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
    );
  }

  const eyeHeight = style === 'determined' ? 1.2 : 2;
  return (
    <group position={[0, -6.5, 0.11]}>
      <mesh position={[-2, 0, 0]}>
        <planeGeometry args={[2, eyeHeight]} />
        <meshBasicMaterial color="#000000" toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[2, 0, 0]}>
        <planeGeometry args={[2, eyeHeight]} />
        <meshBasicMaterial color="#000000" toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function Accessory({ type }: { type: string }) {
  switch (type) {
    case 'crown':
      return (
        <mesh position={[0, -15, 0.12]} geometry={createPolygonGeometry([[-4, 3], [-4, 0], [-2, 2], [0, -1], [2, 2], [4, 0], [4, 3]])}>
          <meshBasicMaterial color="#ffd700" toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      );
    case 'glasses':
      return (
        <group position={[0, -6.5, 0.12]}>
          <mesh position={[-2.5, 0, 0]}>
            <planeGeometry args={[3, 3]} />
            <meshBasicMaterial color="#333333" wireframe toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[2.5, 0, 0]}>
            <planeGeometry args={[3, 3]} />
            <meshBasicMaterial color="#333333" wireframe toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
        </group>
      );
    case 'headphones':
      return (
        <group position={[0, -7, 0.12]}>
          <mesh scale={[6, 6, 1]}>
            <ringGeometry args={[0.8, 1, 16, 1, Math.PI, Math.PI]} />
            <meshBasicMaterial color="#333333" toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[-6, 0, 0]}>
            <planeGeometry args={[3, 4]} />
            <meshBasicMaterial color="#555555" toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[6, 0, 0]}>
            <planeGeometry args={[3, 4]} />
            <meshBasicMaterial color="#555555" toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
        </group>
      );
    case 'hat':
      return (
        <group position={[0, -14, 0.12]}>
          <mesh position={[0, 2, 0]}>
            <planeGeometry args={[12, 2]} />
            <meshBasicMaterial color="#8b4513" toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, -1, 0]}>
            <planeGeometry args={[6, 4]} />
            <meshBasicMaterial color="#8b4513" toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
        </group>
      );
    default:
      return null;
  }
}

export function AgentActor({
  sprite,
  selected,
  showUi,
  cameraRef,
  bubbleConfig,
  onSelect,
  interactionRef,
}: {
  sprite: AgentSprite;
  selected: boolean;
  showUi: boolean;
  cameraRef: MutableRefObject<CameraModel>;
  bubbleConfig: BubbleConfig;
  onSelect: (agentId: string) => void;
  interactionRef: MutableRefObject<{ moved: boolean }>;
}) {
  const groupRef = useRef<THREE.Group | null>(null);

  useFrame(() => {
    if (!groupRef.current) {
      return;
    }
    const depth = 20 + sprite.y * 0.001;
    groupRef.current.position.set(Math.round(sprite.x), Math.round(sprite.y), depth);
  });

  const inverseZoom = 1 / cameraRef.current.zoom;
  const swing = sprite.moving ? Math.sin(sprite.walkFrame * 4) * 4 : 0;
  const app = sprite.agent.appearance;
  const bubbleText = sprite.agent.bubbleText;

  return (
    <group
      ref={groupRef}
      onClick={(event) => {
        event.stopPropagation();
        if (interactionRef.current.moved) {
          return;
        }
        onSelect(sprite.agent.id);
      }}
    >
      <group scale={[sprite.facingLeft ? -1 : 1, selected ? 1.12 : 1, 1]}>
        {selected ? (
          <mesh position={[0, 16, 0]} scale={[16, 7, 1]}>
            <circleGeometry args={[1, 24]} />
            <meshBasicMaterial color="#ffd700" transparent opacity={0.35} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
        ) : null}
        <mesh position={[-3 - swing * 0.25, 12, 0.05]} rotation={[0, 0, 0.08]}>
          <planeGeometry args={[2, 10]} />
          <meshBasicMaterial color={app.pants} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[3 + swing * 0.25, 12, 0.05]} rotation={[0, 0, -0.08]}>
          <planeGeometry args={[2, 10]} />
          <meshBasicMaterial color={app.pants} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 4, 0.07]}>
          <planeGeometry args={[10, 12]} />
          <meshBasicMaterial color={app.shirt} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[-7 + swing * 0.2, 4, 0.08]} rotation={[0, 0, 0.25]}>
          <planeGeometry args={[2, 8]} />
          <meshBasicMaterial color={app.skin} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[7 - swing * 0.2, 4, 0.08]} rotation={[0, 0, -0.25]}>
          <planeGeometry args={[2, 8]} />
          <meshBasicMaterial color={app.skin} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, -6, 0.09]} scale={[5, 5, 1]}>
          <circleGeometry args={[1, 20]} />
          <meshBasicMaterial color={app.skin} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
        <Hair style={app.hairStyle} color={app.hair} />
        <Eyes style={app.eyeStyle} />
        <Accessory type={app.accessory} />
      </group>
      {showUi && sprite.chatting ? <ChatIndicator bubbleConfig={bubbleConfig} inverseZoom={inverseZoom} /> : null}
      {showUi && !sprite.chatting && sprite.agent.status === AgentStatus.IDLE ? <IdleIndicator inverseZoom={inverseZoom} /> : null}
      {showUi && !sprite.chatting && (sprite.agent.status === AgentStatus.WORKING || (sprite.agent.status === AgentStatus.WAITING && bubbleText)) ? (
        <Bubble
          text={bubbleText || '...'}
          accentColor={sprite.agent.status === AgentStatus.WORKING ? THEME.working : THEME.waiting}
          bubbleConfig={bubbleConfig}
          inverseZoom={inverseZoom}
        />
      ) : null}
      {showUi && !sprite.chatting && sprite.agent.status === AgentStatus.WAITING && !bubbleText ? (
        <Bubble text="..." accentColor={THEME.waiting} bubbleConfig={bubbleConfig} inverseZoom={inverseZoom} y={-34} />
      ) : null}
      {showUi ? <NameTag name={sprite.agent.name} inverseZoom={inverseZoom} /> : null}
    </group>
  );
}
