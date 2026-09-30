import { useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import * as THREE from 'three';

import { THEME } from '../../../../config/theme.js';
import { AgentStatus } from '../../../../domain/value-objects/AgentStatus.js';
import type { BubbleConfig, CameraModel, InteractionModel } from '../types.js';
import { useInverseZoom } from '../hooks/useInverseZoom.js';
import { Accessory, Eyes, Hair } from './agent/AvatarParts.js';
import { Bubble } from './agent/Bubble.js';
import { ChatIndicator, IdleIndicator, StatusIcon } from './agent/Indicators.js';
import { NameTag } from './agent/NameTag.js';

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
