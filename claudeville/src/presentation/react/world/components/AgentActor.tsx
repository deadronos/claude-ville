import { useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import * as THREE from 'three';

import { THEME } from '../../../../config/theme.js';
import { AgentStatus } from '../../../../domain/value-objects/AgentStatus.js';
import type { BubbleConfig, CameraModel, InteractionModel } from '../types.js';
import { useInverseZoom } from '../hooks/useInverseZoom.js';
import { createPolygonGeometry, createRoundedRectGeometry } from '../utils.js';
import { WorldText } from './WorldText.js';

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

export function NameTag({ name, inverseZoom }: { name: string; inverseZoom: number }) {
  const width = Math.max(name.length * 6 + 14, 48);
  const geometry = useMemo(() => createRoundedRectGeometry(width, 16, 4), [width]);

  return (
    <group position={[0, 24, 10]} scale={[inverseZoom, inverseZoom, 1]}>
      <mesh geometry={geometry}>
        <meshBasicMaterial color="#e8d44d" toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <WorldText position={[0, 1, 0.1]} fontSize={10} color="#1a1a2e" anchorX="center" anchorY="middle" outlineWidth={0.8} outlineColor="#f6e98d">
        {name}
      </WorldText>
    </group>
  );
}

function IdleIndicator({ inverseZoom }: { inverseZoom: number }) {
  return (
    <group position={[0, -30, 10]} scale={[inverseZoom, inverseZoom, 1]}>
      <WorldText position={[10, 8, 0.1]} fontSize={9} color={THEME.idle} anchorX="center" anchorY="middle">z</WorldText>
      <WorldText position={[16, -2, 0.1]} fontSize={12} color={THEME.idle} anchorX="center" anchorY="middle">z</WorldText>
      <WorldText position={[22, -14, 0.1]} fontSize={15} color={THEME.idle} anchorX="center" anchorY="middle">Z</WorldText>
    </group>
  );
}

function ChatIndicator({ bubbleConfig, inverseZoom }: { bubbleConfig: BubbleConfig; inverseZoom: number }) {
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

function StatusIcon({ status, inverseZoom }: { status: string; inverseZoom: number }) {
  const icon = status === AgentStatus.WORKING ? '⚙️' : status === AgentStatus.WAITING ? '⏳' : '💤';
  return (
    <group position={[18, -32, 11]} scale={[inverseZoom * 0.8, inverseZoom * 0.8, 1]}>
      <WorldText fontSize={12} anchorX="center" anchorY="middle">{icon}</WorldText>
    </group>
  );
}

export function Hair({ style, color }: { style: string; color: string }) {
  const spikyGeometry = useMemo(() => createPolygonGeometry([[-4, 4], [-2, -2], [0, 3], [2, -2], [4, 4]]), []);

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
        <mesh position={[0, -12, 0.1]} geometry={spikyGeometry}>
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

export function Accessory({ type }: { type: string }) {
  const crownGeometry = useMemo(() => createPolygonGeometry([[-4, 3], [-4, 0], [-2, 2], [0, -1], [2, 2], [4, 0], [4, 3]]), []);

  switch (type) {
    case 'crown':
      return (
        <mesh position={[0, -15, 0.12]} geometry={crownGeometry}>
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
  entity,
  selected,
  showUi,
  cameraRef,
  bubbleConfig,
  onSelect,
  interactionRef,
}: {
  entity: {
    id: string;
    name: string;
    status: string;
    bubbleText: string | null;
    appearance: any;
    x: number;
    y: number;
    z?: number;
    moving: boolean;
    walkFrame: number;
    facingLeft: boolean;
    chatting?: boolean;
  };
  selected: boolean;
  showUi: boolean;
  cameraRef: MutableRefObject<CameraModel>;
  bubbleConfig: BubbleConfig;
  onSelect: (agentId: string) => void;
  interactionRef: MutableRefObject<InteractionModel>;
}) {
  const groupRef = useRef<THREE.Group | null>(null);

  const inverseZoom = useInverseZoom(cameraRef);
  const walkTime = entity.walkFrame * 4;
  const swing = entity.moving ? Math.sin(walkTime) * 4 : 0;
  const hop = entity.moving ? Math.abs(Math.sin(walkTime)) * 3 : 0;
  const squash = entity.moving ? 1.0 - Math.abs(Math.sin(walkTime)) * 0.1 : 1.0;
  const stretch = entity.moving ? 1.0 + Math.abs(Math.sin(walkTime)) * 0.05 : 1.0;
  
  const app = entity.appearance;
  const bubbleText = entity.bubbleText;
  
  // Tie-breaker based on ID to prevent z-fighting when agents are at exactly the same coordinates
  const idHash = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < entity.id.length; i++) {
      hash = ((hash << 5) - hash) + entity.id.charCodeAt(i);
      hash |= 0;
    }
    return (Math.abs(hash) % 1000) * 0.000001;
  }, [entity.id]);

  const depth = 20 + entity.y * 0.001 + entity.x * 0.00001 + idHash;

  return (
    <group
      ref={groupRef}
      position={[Math.round(entity.x), Math.round(entity.y), depth]}
      onClick={(event) => {
        event.stopPropagation();
        if (interactionRef.current.moved) {
          interactionRef.current.moved = false;
          return;
        }
        onSelect(entity.id);
      }}
    >
      {/* Dynamic Gradient Shadow */}
      <mesh position={[0, 14, -0.01]} rotation={[-Math.PI / 2, 0, 0]} scale={[12 * (1 - hop * 0.1), 8 * (1 - hop * 0.1), 1]}>
        <circleGeometry args={[1, 16]} />
        <meshBasicMaterial color="black" transparent opacity={0.3 * (1 - hop * 0.1)} toneMapped={false} />
      </mesh>

      <group position={[0, -hop, 0]} scale={[entity.facingLeft ? -stretch : stretch, selected ? 1.12 * squash : squash, 1]}>
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
      <group visible={showUi}>
        {entity.chatting ? <ChatIndicator bubbleConfig={bubbleConfig} inverseZoom={inverseZoom} /> : null}
        {!entity.chatting && entity.status === AgentStatus.IDLE ? <IdleIndicator inverseZoom={inverseZoom} /> : null}
        {!entity.chatting && (entity.status === AgentStatus.WORKING || (entity.status === AgentStatus.WAITING && bubbleText)) ? (
          <>
            <Bubble
              text={bubbleText || '...'}
              accentColor={entity.status === AgentStatus.WORKING ? THEME.working : THEME.waiting}
              bubbleConfig={bubbleConfig}
              inverseZoom={inverseZoom}
            />
            <StatusIcon status={entity.status} inverseZoom={inverseZoom} />
          </>
        ) : null}
        {!entity.chatting && entity.status === AgentStatus.WAITING && !bubbleText ? (
          <Bubble text="..." accentColor={THEME.waiting} bubbleConfig={bubbleConfig} inverseZoom={inverseZoom} y={-34} />
        ) : null}
        <NameTag name={entity.name} inverseZoom={inverseZoom} />
      </group>
    </group>
  );
}