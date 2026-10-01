import { Billboard, Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type { Group } from 'three';
import { Vector3 } from 'three';

import type { VoxelVillageAgent } from '../model.js';

interface AgentMotionState {
  currentPosition: Vector3;
  currentTarget: Vector3 | null;
  route: Vector3[];
  dwellUntilMs: number;
  anchorIndex: number;
  lastBuildingId: string;
  lastHomeKey: string;
  lastRoadAnchor: Vector3;
  facingAngle: number;
}

export function VoxelAgent({
  agent,
  selected,
  animatedAgentPositionsRef,
  onSelect,
}: {
  agent: VoxelVillageAgent;
  selected: boolean;
  animatedAgentPositionsRef: React.MutableRefObject<Map<string, Vector3>>;
  onSelect: () => void;
}) {
  const groupRef = useRef<Group>(null);
  const phase = useMemo(() => hashAgent(agent.id) * Math.PI * 2, [agent.id]);
  const routeSeed = useMemo(() => hashAgent(`${agent.id}:route`), [agent.id]);
  const animatedPositionRef = useRef(new Vector3(agent.voxelPosition.x, agent.voxelPosition.y, agent.voxelPosition.z));
  const motionStateRef = useRef<AgentMotionState>({
    currentPosition: new Vector3(agent.voxelPosition.x, agent.voxelPosition.y, agent.voxelPosition.z),
    currentTarget: null,
    route: [],
    dwellUntilMs: 0,
    anchorIndex: Math.floor(routeSeed * 7),
    lastBuildingId: agent.buildingId,
    lastHomeKey: positionKey(agent.homePosition),
    lastRoadAnchor: toVector3(agent.roadAnchorPosition),
    facingAngle: 0,
  });

  useEffect(() => {
    const positions = animatedAgentPositionsRef.current;
    positions.set(agent.id, animatedPositionRef.current);
    return () => {
      // Capture the current Map reference at mount time. The caller is
      // expected to keep using the same Map instance for the lifetime of the
      // world scene, so reading `.current` here would always return the same
      // value, but referencing the local binding keeps React's exhaustive-deps
      // rule happy and avoids a stale-closure footgun if that ever changes.
      positions.delete(agent.id);
    };
  }, [agent.id, animatedAgentPositionsRef]);

  useEffect(() => {
    const state = motionStateRef.current;
    const nextHomeKey = positionKey(agent.homePosition);
    const nextRoadAnchor = toVector3(agent.roadAnchorPosition);

    if (state.lastBuildingId !== agent.buildingId || state.lastHomeKey !== nextHomeKey) {
      const nextRoute: Vector3[] = [];
      if (state.currentPosition.distanceToSquared(state.lastRoadAnchor) > 0.25) {
        nextRoute.push(state.lastRoadAnchor.clone());
      }
      if (nextRoute.length === 0 || nextRoute[nextRoute.length - 1].distanceToSquared(nextRoadAnchor) > 0.25) {
        nextRoute.push(nextRoadAnchor.clone());
      }
      nextRoute.push(toVector3(agent.doorwayPosition));
      nextRoute.push(toVector3(agent.homePosition));
      state.route = nextRoute;
      state.currentTarget = state.route.shift() ?? null;
      state.dwellUntilMs = 0;
    }

    state.lastBuildingId = agent.buildingId;
    state.lastHomeKey = nextHomeKey;
    state.lastRoadAnchor.copy(nextRoadAnchor);
  }, [agent.buildingId, agent.homePosition, agent.roadAnchorPosition, agent.doorwayPosition]);

  useFrame(({ clock }, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const state = motionStateRef.current;
    const elapsedMs = clock.elapsedTime * 1000;

    if (!state.currentTarget && state.route.length > 0) {
      state.currentTarget = state.route.shift() ?? null;
    }

    if (!state.currentTarget && elapsedMs >= state.dwellUntilMs) {
      state.currentTarget = chooseLocalWaypoint(agent, state, routeSeed);
    }

    let moving = false;
    if (state.currentTarget) {
      const movement = state.currentTarget.clone().sub(state.currentPosition);
      const distance = movement.length();

      if (distance <= 0.001) {
        state.currentPosition.copy(state.currentTarget);
        state.currentTarget = state.route.shift() ?? null;
        if (!state.currentTarget) {
          state.dwellUntilMs = elapsedMs + resolveDwellDuration(agent, state, routeSeed);
        }
      } else {
        moving = true;
        const step = Math.min(distance, agent.walkSpeed * delta);
        movement.divideScalar(distance);
        state.currentPosition.addScaledVector(movement, step);
        state.facingAngle = Math.atan2(movement.x, movement.z);

        if (distance - step <= 0.01) {
          state.currentPosition.copy(state.currentTarget);
          state.currentTarget = state.route.shift() ?? null;
          if (!state.currentTarget) {
            state.dwellUntilMs = elapsedMs + resolveDwellDuration(agent, state, routeSeed);
          }
        }
      }
    }

    group.position.copy(state.currentPosition);
    group.position.y = state.currentPosition.y + (moving
      ? Math.abs(Math.sin(clock.elapsedTime * (4.2 + agent.movementIntensity * 2.4) + phase)) * 0.08
      : 0);
    group.rotation.y = state.facingAngle;
    animatedPositionRef.current.copy(group.position);
  });

  return (
    <group
      ref={groupRef}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <mesh position={[0, 0.48, 0]}>
        <boxGeometry args={[0.46, 0.74, 0.34]} />
        <meshStandardMaterial color={selected ? '#fff176' : agent.color} roughness={0.65} />
      </mesh>
      <mesh position={[0, 1.0, 0]}>
        <boxGeometry args={[0.42, 0.38, 0.42]} />
        <meshStandardMaterial color="#f0c49a" roughness={0.6} />
      </mesh>
      <mesh position={[0, 1.28, 0]}>
        <boxGeometry args={[0.48, 0.18, 0.48]} />
        <meshStandardMaterial color="#273244" roughness={0.7} />
      </mesh>
      <Billboard position={[0, 1.95, 0]}>
        <group>
          <mesh position={[0, 0, -0.025]}>
            <planeGeometry args={[3.2, 0.92]} />
            <meshBasicMaterial color="#fffaf0" transparent opacity={0.93} />
          </mesh>
          <Text
            position={[0, 0.16, 0]}
            fontSize={0.18}
            maxWidth={2.82}
            anchorX="center"
            anchorY="middle"
            color="#152033"
          >
            {agent.name}
          </Text>
          <Text
            position={[0, -0.15, 0]}
            fontSize={0.14}
            maxWidth={2.76}
            anchorX="center"
            anchorY="middle"
            color="#41516c"
          >
            {agent.currentTask}
          </Text>
        </group>
      </Billboard>
    </group>
  );
}

function hashAgent(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return (hash % 1000) / 1000;
}

function chooseLocalWaypoint(agent: VoxelVillageAgent, state: AgentMotionState, seed: number) {
  const anchors = buildLocalAnchors(agent, seed);
  const sequence = agent.movementIntensity >= 0.72
    ? [1, 2, 3, 0, 4, 2, 5, 0]
    : agent.movementIntensity >= 0.36
      ? [1, 3, 0, 2, 0, 4]
      : [1, 0, 5, 0];

  for (let attempt = 0; attempt < sequence.length; attempt += 1) {
    state.anchorIndex = (state.anchorIndex + 1) % sequence.length;
    const target = anchors[sequence[state.anchorIndex]].clone();
    if (target.distanceToSquared(state.currentPosition) > 0.1) {
      return target;
    }
  }

  return anchors[0].clone();
}

function buildLocalAnchors(agent: VoxelVillageAgent, seed: number) {
  const home = toVector3(agent.homePosition);
  const doorway = toVector3(agent.doorwayPosition);
  const road = toVector3(agent.roadAnchorPosition);
  const lateral = seed >= 0.5 ? 1 : -1;
  const pathBlend = doorway.clone().lerp(road, 0.45);
  const roadRadius = 0.45 + agent.movementIntensity * 0.85;
  const homeRadius = 0.18 + agent.movementIntensity * 0.35;

  return [
    home,
    doorway,
    road,
    pathBlend.clone().add(new Vector3(lateral * roadRadius, 0, 0.18 + seed * 0.42)),
    road.clone().add(new Vector3(lateral * 0.4, 0, roadRadius)),
    home.clone().add(new Vector3(-lateral * homeRadius, 0, 0.22 + seed * 0.28)),
  ];
}

function resolveDwellDuration(agent: VoxelVillageAgent, state: AgentMotionState, seed: number) {
  const cadenceOffset = ((state.anchorIndex + Math.round(seed * 10)) % 3) * 140;
  return Math.max(650, agent.dwellDurationMs - cadenceOffset);
}

function toVector3(position: { x: number; y: number; z: number }) {
  return new Vector3(position.x, position.y, position.z);
}

function positionKey(position: { x: number; y: number; z: number }) {
  return `${position.x}:${position.y}:${position.z}`;
}
