import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Text as DreiText } from '@react-three/drei';
import * as THREE from 'three';

import { AgentSprite } from '../../character-mode/AgentSprite.js';
import { MAP_SIZE, TILE_HEIGHT, TILE_WIDTH } from '../../../config/constants.js';
import { THEME } from '../../../config/theme.js';
import { AgentStatus } from '../../../domain/value-objects/AgentStatus.js';

const MINIMAP_SIZE = 150;

const BUILDING_STYLES: Record<string, {
  wallColor: string;
  roofColor: string;
  accentColor: string;
  wallHeight: number;
  roundRoof?: boolean;
}> = {
  command: {
    wallColor: '#5a3e2b',
    roofColor: '#8b0000',
    accentColor: '#ffd700',
    wallHeight: 50,
  },
  forge: {
    wallColor: '#4a3520',
    roofColor: '#555555',
    accentColor: '#ff6b00',
    wallHeight: 40,
  },
  mine: {
    wallColor: '#3e3530',
    roofColor: '#5a4a3a',
    accentColor: '#ffd700',
    wallHeight: 35,
  },
  taskboard: {
    wallColor: '#4a4035',
    roofColor: '#6b5b4a',
    accentColor: '#4a9eff',
    wallHeight: 30,
  },
  chathall: {
    wallColor: '#3a4a5a',
    roofColor: '#5a7a9a',
    accentColor: '#51cf66',
    wallHeight: 38,
    roundRoof: true,
  },
};

type BubbleConfig = {
  textScale: number;
  statusFontSize: number;
  statusMaxWidth: number;
  statusBubbleH: number;
  statusPaddingH: number;
  chatFontSize: number;
};

type CameraModel = {
  x: number;
  y: number;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  followAgentId: string | null;
  followSmoothing: number;
};

type WorldViewProps = {
  agents: any[];
  buildings: any[];
  selectedAgentId: string | null;
  bubbleConfig: BubbleConfig;
  onSelectAgent: (agentId: string) => void;
  onClearSelection: () => void;
};

function isoToScreen(tileX: number, tileY: number) {
  return {
    x: (tileX - tileY) * TILE_WIDTH / 2,
    y: (tileX + tileY) * TILE_HEIGHT / 2,
  };
}

function screenToWorld(screenX: number, screenY: number, camera: CameraModel) {
  return {
    x: screenX / camera.zoom - camera.x,
    y: screenY / camera.zoom - camera.y,
  };
}

function screenToTile(screenX: number, screenY: number, camera: CameraModel) {
  const world = screenToWorld(screenX, screenY, camera);
  const tileX = (world.x / (TILE_WIDTH / 2) + world.y / (TILE_HEIGHT / 2)) / 2;
  const tileY = (world.y / (TILE_HEIGHT / 2) - world.x / (TILE_WIDTH / 2)) / 2;
  return {
    tileX: Math.floor(tileX),
    tileY: Math.floor(tileY),
  };
}

function createCenteredCamera(width: number, height: number, zoom = 1.2): CameraModel {
  const centerTile = MAP_SIZE / 2;
  const center = isoToScreen(centerTile, centerTile);
  return {
    x: -center.x + width / (2 * zoom),
    y: -center.y + height / (2 * zoom),
    zoom,
    minZoom: 0.5,
    maxZoom: 3,
    followAgentId: null,
    followSmoothing: 0.08,
  };
}

function createPolygonGeometry(points: Array<[number, number]>) {
  const shape = new THREE.Shape();
  const [first, ...rest] = points;
  shape.moveTo(first[0], first[1]);
  for (const [x, y] of rest) {
    shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

function createRoundedRectGeometry(width: number, height: number, radius = 5) {
  const left = -width / 2;
  const top = -height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(left + radius, top);
  shape.lineTo(left + width - radius, top);
  shape.quadraticCurveTo(left + width, top, left + width, top + radius);
  shape.lineTo(left + width, top + height - radius);
  shape.quadraticCurveTo(left + width, top + height, left + width - radius, top + height);
  shape.lineTo(left + radius, top + height);
  shape.quadraticCurveTo(left, top + height, left, top + height - radius);
  shape.lineTo(left, top + radius);
  shape.quadraticCurveTo(left, top, left + radius, top);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

function WorldText(props: React.ComponentProps<typeof DreiText>) {
  return <DreiText {...props} scale={[1, -1, 1]} />;
}

function lighten(hex: string, amount: number) {
  const num = parseInt(hex.replace('#', ''), 16);
  const clamp = (value: number) => Math.max(0, Math.min(255, value));
  const red = clamp((num >> 16) + amount);
  const green = clamp(((num >> 8) & 0xff) + amount);
  const blue = clamp((num & 0xff) + amount);
  return `rgb(${red},${green},${blue})`;
}

function useTerrain(buildings: any[]) {
  return useMemo(() => {
    const pathTiles = new Set<string>();
    const waterTiles = new Set<string>();
    const terrainSeed = Array.from({ length: MAP_SIZE * MAP_SIZE }, () => Math.random());

    for (const building of buildings) {
      for (let x = building.position.tileX - 1; x <= building.position.tileX + building.width; x += 1) {
        for (let y = building.position.tileY - 1; y <= building.position.tileY + building.height; y += 1) {
          if (x >= 0 && x < MAP_SIZE && y >= 0 && y < MAP_SIZE) {
            pathTiles.add(`${x},${y}`);
          }
        }
      }
    }

    if (buildings.length >= 2) {
      for (let index = 0; index < buildings.length - 1; index += 1) {
        const left = buildings[index];
        const right = buildings[index + 1];
        const leftX = Math.floor(left.position.tileX + left.width / 2);
        const leftY = Math.floor(left.position.tileY + left.height / 2);
        const rightX = Math.floor(right.position.tileX + right.width / 2);
        const rightY = Math.floor(right.position.tileY + right.height / 2);
        for (let x = Math.min(leftX, rightX); x <= Math.max(leftX, rightX); x += 1) {
          pathTiles.add(`${x},${leftY}`);
          pathTiles.add(`${x},${leftY + 1}`);
        }
        for (let y = Math.min(leftY, rightY); y <= Math.max(leftY, rightY); y += 1) {
          pathTiles.add(`${rightX},${y}`);
          pathTiles.add(`${rightX + 1},${y}`);
        }
      }
    }

    for (let x = 3; x <= 8; x += 1) {
      for (let y = 30; y <= 35; y += 1) {
        const distance = Math.sqrt((x - 5.5) ** 2 + (y - 32.5) ** 2);
        if (distance < 3) {
          waterTiles.add(`${x},${y}`);
        }
      }
    }

    const tiles = [] as Array<{ key: string; x: number; y: number; color: string; water: boolean }>;
    for (let y = 0; y < MAP_SIZE; y += 1) {
      for (let x = 0; x < MAP_SIZE; x += 1) {
        const screen = isoToScreen(x, y);
        const key = `${x},${y}`;
        const seed = terrainSeed[y * MAP_SIZE + x] || 0;
        const palette = waterTiles.has(key)
          ? THEME.water
          : pathTiles.has(key)
            ? THEME.path
            : THEME.grass;
        const color = palette[Math.floor(seed * palette.length)] || palette[0];
        tiles.push({
          key,
          x: screen.x,
          y: screen.y,
          color,
          water: waterTiles.has(key),
        });
      }
    }

    return { tiles, waterTiles };
  }, [buildings]);
}

function ScreenSpaceCamera({ viewport }: { viewport: { width: number; height: number } }) {
  const { camera } = useThree();

  useLayoutEffect(() => {
    const orthoCamera = camera as THREE.OrthographicCamera;
    orthoCamera.left = 0;
    orthoCamera.right = viewport.width;
    orthoCamera.top = 0;
    orthoCamera.bottom = viewport.height;
    orthoCamera.near = -1000;
    orthoCamera.far = 1000;
    orthoCamera.position.set(0, 0, 100);
    orthoCamera.zoom = 1;
    orthoCamera.updateProjectionMatrix();
  }, [camera, viewport.height, viewport.width]);

  return null;
}

function TerrainLayer({ tiles }: { tiles: Array<{ key: string; x: number; y: number; color: string; water: boolean }> }) {
  const diamondGeometry = useMemo(() => createPolygonGeometry([
    [0, -TILE_HEIGHT / 2],
    [TILE_WIDTH / 2, 0],
    [0, TILE_HEIGHT / 2],
    [-TILE_WIDTH / 2, 0],
  ]), []);

  return (
    <group>
      {tiles.map((tile) => (
        <TerrainTile key={tile.key} tile={tile} geometry={diamondGeometry} />
      ))}
    </group>
  );
}

function TerrainTile({ tile, geometry }: { tile: { key: string; x: number; y: number; color: string; water: boolean }; geometry: THREE.ShapeGeometry }) {
  const shimmerMaterial = useRef<THREE.MeshBasicMaterial | null>(null);

  useFrame(({ clock }) => {
    if (!tile.water || !shimmerMaterial.current) {
      return;
    }
    shimmerMaterial.current.opacity = Math.sin(clock.elapsedTime * 2 + tile.x * 0.015 + tile.y * 0.02) * 0.15 + 0.18;
  });

  return (
    <group position={[tile.x, tile.y, 0]}>
      <mesh geometry={geometry} position={[0, 0, 0]}>
        <meshBasicMaterial color={tile.color} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      {tile.water ? (
        <mesh geometry={geometry} position={[0, 0, 0.01]}>
          <meshBasicMaterial ref={shimmerMaterial} color="#ffffff" transparent opacity={0.12} toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ) : null}
    </group>
  );
}

function BuildingActor({
  building,
  roofAlphaRef,
  hovered,
}: {
  building: any;
  roofAlphaRef: React.MutableRefObject<Map<string, number>>;
  hovered: boolean;
}) {
  const style = BUILDING_STYLES[building.type];
  const halfW = building.width * TILE_WIDTH / 4;
  const halfH = building.height * TILE_HEIGHT / 4;
  const center = isoToScreen(building.position.tileX + building.width / 2, building.position.tileY + building.height / 2);
  const roofMaterial = useRef<THREE.MeshBasicMaterial | null>(null);
  const roofMaterialAlt = useRef<THREE.MeshBasicMaterial | null>(null);
  const frontLeftMaterial = useRef<THREE.MeshBasicMaterial | null>(null);
  const frontRightMaterial = useRef<THREE.MeshBasicMaterial | null>(null);
  const interiorMaterial = useRef<THREE.MeshBasicMaterial | null>(null);

  const foundationGeometry = useMemo(() => createPolygonGeometry([
    [0, -halfH],
    [halfW, 0],
    [0, halfH],
    [-halfW, 0],
  ]), [halfH, halfW]);

  const backLeftGeometry = useMemo(() => createPolygonGeometry([
    [-halfW, 0],
    [-halfW, -style.wallHeight],
    [0, -style.wallHeight - halfH],
    [0, -halfH],
  ]), [halfH, halfW, style.wallHeight]);

  const backRightGeometry = useMemo(() => createPolygonGeometry([
    [halfW, 0],
    [halfW, -style.wallHeight],
    [0, -style.wallHeight - halfH],
    [0, -halfH],
  ]), [halfH, halfW, style.wallHeight]);

  const frontLeftGeometry = useMemo(() => createPolygonGeometry([
    [-halfW, 0],
    [0, halfH],
    [0, halfH - style.wallHeight],
    [-halfW, -style.wallHeight],
  ]), [halfH, halfW, style.wallHeight]);

  const frontRightGeometry = useMemo(() => createPolygonGeometry([
    [0, halfH],
    [halfW, 0],
    [halfW, -style.wallHeight],
    [0, halfH - style.wallHeight],
  ]), [halfH, halfW, style.wallHeight]);

  const interiorGeometry = useMemo(() => createPolygonGeometry([
    [0, -halfH + 2],
    [halfW - 2, 0],
    [0, halfH - 2],
    [-halfW + 2, 0],
  ]), [halfH, halfW]);

  const roofGeometries = useMemo(() => {
    if (style.roundRoof) {
      const dome = new THREE.Shape();
      dome.moveTo(-halfW - 5, -style.wallHeight);
      dome.lineTo(0, -style.wallHeight - halfH - 5);
      dome.lineTo(halfW + 5, -style.wallHeight);
      dome.lineTo(0, halfH - style.wallHeight + 5);
      dome.closePath();
      return {
        left: new THREE.ShapeGeometry(dome),
        right: new THREE.ShapeGeometry(dome),
      };
    }

    return {
      left: createPolygonGeometry([
        [-halfW - 5, -style.wallHeight],
        [0, halfH - style.wallHeight + 5],
        [0, -style.wallHeight - halfH - 12],
      ]),
      right: createPolygonGeometry([
        [0, halfH - style.wallHeight + 5],
        [halfW + 5, -style.wallHeight],
        [0, -style.wallHeight - halfH - 12],
      ]),
    };
  }, [halfH, halfW, style.roundRoof, style.wallHeight]);

  useFrame(() => {
    const alpha = roofAlphaRef.current.get(building.type) ?? 1;
    if (roofMaterial.current) {
      roofMaterial.current.opacity = alpha;
      roofMaterial.current.transparent = alpha < 0.999;
    }
    if (roofMaterialAlt.current) {
      roofMaterialAlt.current.opacity = alpha;
      roofMaterialAlt.current.transparent = alpha < 0.999;
    }
    if (frontLeftMaterial.current) {
      frontLeftMaterial.current.opacity = alpha;
      frontLeftMaterial.current.transparent = alpha < 0.999;
    }
    if (frontRightMaterial.current) {
      frontRightMaterial.current.opacity = alpha;
      frontRightMaterial.current.transparent = alpha < 0.999;
    }
    if (interiorMaterial.current) {
      interiorMaterial.current.opacity = 1 - alpha;
      interiorMaterial.current.transparent = true;
    }
  });

  const activeCount = 0;
  const labelColor = hovered ? THEME.text : THEME.textSecondary;

  return (
    <group position={[center.x, center.y, 10]}>
      <mesh position={[8, 6, 0]} scale={[halfW + 5, halfH + 3, 1]}>
        <circleGeometry args={[1, 24]} />
        <meshBasicMaterial color="black" transparent opacity={0.25} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={foundationGeometry} position={[0, 0, 0.1]}>
        <meshBasicMaterial color="#3a3025" toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={backLeftGeometry} position={[0, 0, 0.12]}>
        <meshBasicMaterial color={lighten(style.wallColor, -15)} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={backRightGeometry} position={[0, 0, 0.13]}>
        <meshBasicMaterial color={lighten(style.wallColor, -5)} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={interiorGeometry} position={[0, 0, 0.14]}>
        <meshBasicMaterial ref={interiorMaterial} color={lighten(style.wallColor, 35)} transparent opacity={0} toneMapped={false} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={frontLeftGeometry} position={[0, 0, 0.15]}>
        <meshBasicMaterial ref={frontLeftMaterial} color={style.wallColor} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={frontRightGeometry} position={[0, 0, 0.16]}>
        <meshBasicMaterial ref={frontRightMaterial} color={lighten(style.wallColor, 20)} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={roofGeometries.left} position={[0, 0, 0.17]}>
        <meshBasicMaterial ref={roofMaterial} color={style.roofColor} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={roofGeometries.right} position={[0, 0, 0.18]}>
        <meshBasicMaterial ref={roofMaterialAlt} color={lighten(style.roofColor, 18)} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <WorldText position={[0, halfH + 16, 0.3]} fontSize={9} color={labelColor} anchorX="center" anchorY="middle" outlineWidth={0.7} outlineColor="#10141f">
        {building.label}
      </WorldText>
      <WorldText position={[0, -style.wallHeight - halfH - 20, 0.3]} fontSize={11} color={style.accentColor} anchorX="center" anchorY="middle" outlineWidth={0.8} outlineColor="#10141f">
        {building.icon}
      </WorldText>
      {activeCount > 0 ? (
        <WorldText position={[0, -style.wallHeight - halfH - 35, 0.31]} fontSize={8} color="#ffffff" anchorX="center" anchorY="middle" outlineWidth={0.6} outlineColor="#10141f">
          {`${activeCount} agents`}
        </WorldText>
      ) : null}
    </group>
  );
}

function Bubble({ text, accentColor, bubbleConfig, inverseZoom, y = -38 }: { text: string; accentColor: string; bubbleConfig: BubbleConfig; inverseZoom: number; y?: number }) {
  const maxChars = Math.max(8, Math.floor((bubbleConfig.statusMaxWidth - bubbleConfig.statusPaddingH) / (bubbleConfig.statusFontSize * 0.56)));
  const displayText = text.length > maxChars ? `${text.slice(0, Math.max(1, maxChars - 1))}…` : text;
  const width = Math.min(displayText.length * bubbleConfig.statusFontSize * 0.56 + bubbleConfig.statusPaddingH, bubbleConfig.statusMaxWidth);
  const geometry = useMemo(() => createRoundedRectGeometry(width, bubbleConfig.statusBubbleH, 6), [bubbleConfig.statusBubbleH, width]);

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
  const geometry = useMemo(() => createRoundedRectGeometry(width, 16, 4), [width]);

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

function ChatIndicator({ inverseZoom, bubbleConfig }: { inverseZoom: number; bubbleConfig: BubbleConfig }) {
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

function AgentActor({
  sprite,
  selected,
  cameraRef,
  bubbleConfig,
  onSelect,
  interactionRef,
}: {
  sprite: AgentSprite;
  selected: boolean;
  cameraRef: React.MutableRefObject<CameraModel>;
  bubbleConfig: BubbleConfig;
  onSelect: (agentId: string) => void;
  interactionRef: React.MutableRefObject<{ moved: boolean }>;
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
      <group scale={[sprite.facingLeft ? -1 : 1, 1, 1]}>
        {selected ? (
          <mesh position={[0, 16, 0]} scale={[14, 6, 1]}>
            <circleGeometry args={[1, 24]} />
            <meshBasicMaterial color="#ffd700" transparent opacity={0.3} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
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
      {sprite.chatting ? <ChatIndicator inverseZoom={inverseZoom} bubbleConfig={bubbleConfig} /> : null}
      {!sprite.chatting && sprite.agent.status === AgentStatus.IDLE ? <IdleIndicator inverseZoom={inverseZoom} /> : null}
      {!sprite.chatting && (sprite.agent.status === AgentStatus.WORKING || (sprite.agent.status === AgentStatus.WAITING && bubbleText)) ? (
        <Bubble
          text={bubbleText || '...'}
          accentColor={sprite.agent.status === AgentStatus.WORKING ? THEME.working : THEME.waiting}
          bubbleConfig={bubbleConfig}
          inverseZoom={inverseZoom}
        />
      ) : null}
      {!sprite.chatting && sprite.agent.status === AgentStatus.WAITING && !bubbleText ? (
        <Bubble text="..." accentColor={THEME.waiting} bubbleConfig={bubbleConfig} inverseZoom={inverseZoom} y={-34} />
      ) : null}
      <NameTag name={sprite.agent.name} inverseZoom={inverseZoom} />
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

function WorldScene({
  viewport,
  sprites,
  cameraRef,
  roofAlphaRef,
  bubbleConfig,
  buildings,
  selectedAgentId,
  hoveredBuildingId,
  onSelectAgent,
  onHoverBuilding,
  interactionRef,
}: {
  viewport: { width: number; height: number };
  sprites: AgentSprite[];
  cameraRef: React.MutableRefObject<CameraModel>;
  roofAlphaRef: React.MutableRefObject<Map<string, number>>;
  bubbleConfig: BubbleConfig;
  buildings: any[];
  selectedAgentId: string | null;
  hoveredBuildingId: string | null;
  onSelectAgent: (agentId: string) => void;
  onHoverBuilding: (buildingId: string | null) => void;
  interactionRef: React.MutableRefObject<{ moved: boolean }>;
}) {
  const rootRef = useRef<THREE.Group | null>(null);
  const terrain = useTerrain(buildings);

  useFrame(() => {
    const camera = cameraRef.current;
    if (camera.followAgentId) {
      const target = sprites.find((sprite) => sprite.agent.id === camera.followAgentId);
      if (target) {
        const targetX = -target.x + viewport.width / (2 * camera.zoom);
        const targetY = -target.y + viewport.height / (2 * camera.zoom);
        camera.x += (targetX - camera.x) * camera.followSmoothing;
        camera.y += (targetY - camera.y) * camera.followSmoothing;
      }
    }

    for (const sprite of sprites) {
      sprite.chatPartner = sprite.chatPartner && sprites.includes(sprite.chatPartner) ? sprite.chatPartner : sprite.chatPartner;
      sprite.selected = sprite.agent.id === selectedAgentId;
      sprite.update(null);
    }

    for (const building of buildings) {
      const style = BUILDING_STYLES[building.type];
      const center = isoToScreen(building.position.tileX + building.width / 2, building.position.tileY + building.height / 2);
      const halfW = building.width * TILE_WIDTH / 4;
      let agentNear = false;
      for (const sprite of sprites) {
        const dx = sprite.x - center.x;
        const dy = sprite.y - center.y;
        if (Math.abs(dx) < halfW + 15 && dy > -style.wallHeight - 10 && dy < 20) {
          agentNear = true;
          break;
        }
      }
      const current = roofAlphaRef.current.get(building.type) ?? 1;
      const next = current + ((agentNear ? 0 : 1) - current) * 0.06;
      roofAlphaRef.current.set(building.type, next);
    }

    if (rootRef.current) {
      rootRef.current.position.set(Math.round(camera.x * camera.zoom), Math.round(camera.y * camera.zoom), 0);
      rootRef.current.scale.set(camera.zoom, camera.zoom, 1);
    }
  });

  return (
    <>
      <ScreenSpaceCamera viewport={viewport} />
      <color attach="background" args={[THEME.bg]} />
      <group ref={rootRef}>
        <TerrainLayer tiles={terrain.tiles} />
        {buildings.map((building) => (
          <group
            key={building.type}
            onPointerOver={(event) => {
              event.stopPropagation();
              onHoverBuilding(building.type);
            }}
            onPointerOut={(event) => {
              event.stopPropagation();
              onHoverBuilding(null);
            }}
          >
            <BuildingActor building={building} roofAlphaRef={roofAlphaRef} hovered={hoveredBuildingId === building.type} />
          </group>
        ))}
        {sprites.map((sprite) => (
          <AgentActor
            key={sprite.agent.id}
            sprite={sprite}
            selected={selectedAgentId === sprite.agent.id}
            cameraRef={cameraRef}
            bubbleConfig={bubbleConfig}
            onSelect={onSelectAgent}
            interactionRef={interactionRef}
          />
        ))}
      </group>
    </>
  );
}

function MinimapOverlay({
  buildings,
  spritesRef,
  cameraRef,
  viewport,
  onNavigate,
}: {
  buildings: any[];
  spritesRef: React.MutableRefObject<Map<string, AgentSprite>>;
  cameraRef: React.MutableRefObject<CameraModel>;
  viewport: { width: number; height: number };
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

export function WorldView({
  agents,
  buildings,
  selectedAgentId,
  bubbleConfig,
  onSelectAgent,
  onClearSelection,
}: WorldViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<CameraModel>(createCenteredCamera(1, 1));
  const roofAlphaRef = useRef(new Map<string, number>());
  const spritesRef = useRef(new Map<string, AgentSprite>());
  const interactionRef = useRef({
    dragging: false,
    moved: false,
    startX: 0,
    startY: 0,
    camStartX: 0,
    camStartY: 0,
  });
  const [viewport, setViewport] = useState({ width: 1, height: 1 });
  const [dragging, setDragging] = useState(false);
  const [hoveredBuildingId, setHoveredBuildingId] = useState<string | null>(null);

  const sprites = agents.map((agent) => {
    let sprite = spritesRef.current.get(agent.id);
    if (!sprite) {
      sprite = new AgentSprite(agent);
      spritesRef.current.set(agent.id, sprite);
    }
    sprite.agent = agent;
    return sprite;
  });

  for (const id of Array.from(spritesRef.current.keys())) {
    if (!agents.some((agent) => agent.id === id)) {
      spritesRef.current.delete(id);
    }
  }

  useEffect(() => {
    cameraRef.current.followAgentId = selectedAgentId;
  }, [selectedAgentId]);

  useLayoutEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const resize = () => {
      if (!containerRef.current) {
        return;
      }
      const width = Math.max(1, containerRef.current.clientWidth);
      const height = Math.max(1, containerRef.current.clientHeight);
      setViewport({ width, height });
      cameraRef.current = {
        ...createCenteredCamera(width, height, cameraRef.current.zoom),
        followAgentId: cameraRef.current.followAgentId,
      };
    };

    const observer = new ResizeObserver(() => resize());
    observer.observe(containerRef.current);
    resize();

    return () => {
      observer.disconnect();
    };
  }, []);

  const navigateToTile = (tileX: number, tileY: number) => {
    const screen = isoToScreen(tileX, tileY);
    cameraRef.current.x = -screen.x + viewport.width / (2 * cameraRef.current.zoom);
    cameraRef.current.y = -screen.y + viewport.height / (2 * cameraRef.current.zoom);
    cameraRef.current.followAgentId = null;
  };

  return (
    <div
      ref={containerRef}
      className={`content__character world-view ${dragging ? 'world-view--dragging' : ''}`}
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        interactionRef.current.dragging = true;
        interactionRef.current.moved = false;
        interactionRef.current.startX = event.clientX;
        interactionRef.current.startY = event.clientY;
        interactionRef.current.camStartX = cameraRef.current.x;
        interactionRef.current.camStartY = cameraRef.current.y;
        cameraRef.current.followAgentId = null;
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (!interactionRef.current.dragging) {
          return;
        }
        const dx = event.clientX - interactionRef.current.startX;
        const dy = event.clientY - interactionRef.current.startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          interactionRef.current.moved = true;
        }
        cameraRef.current.x = interactionRef.current.camStartX + dx / cameraRef.current.zoom;
        cameraRef.current.y = interactionRef.current.camStartY + dy / cameraRef.current.zoom;
      }}
      onPointerUp={() => {
        interactionRef.current.dragging = false;
        setDragging(false);
      }}
      onPointerLeave={() => {
        interactionRef.current.dragging = false;
        setDragging(false);
      }}
      onWheel={(event) => {
        event.preventDefault();
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) {
          return;
        }

        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        const worldBefore = screenToWorld(mouseX, mouseY, cameraRef.current);
        let rawDelta = event.deltaY;
        if (event.deltaMode === 1) {
          rawDelta *= 16;
        }
        if (event.deltaMode === 2) {
          rawDelta *= 100;
        }
        const clamped = Math.max(-60, Math.min(60, rawDelta));
        const factor = 1 - clamped * 0.003;
        cameraRef.current.zoom = Math.max(cameraRef.current.minZoom, Math.min(cameraRef.current.maxZoom, cameraRef.current.zoom * factor));
        cameraRef.current.x = mouseX / cameraRef.current.zoom - worldBefore.x;
        cameraRef.current.y = mouseY / cameraRef.current.zoom - worldBefore.y;
      }}
    >
      <Canvas
        orthographic
        dpr={[1, 2]}
        frameloop="always"
        gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
        className="content__canvas world-view__canvas"
        onPointerMissed={() => {
          if (!interactionRef.current.moved) {
            onClearSelection();
          }
          interactionRef.current.moved = false;
        }}
      >
        <WorldScene
          viewport={viewport}
          sprites={sprites}
          cameraRef={cameraRef}
          roofAlphaRef={roofAlphaRef}
          bubbleConfig={bubbleConfig}
          buildings={buildings}
          selectedAgentId={selectedAgentId}
          hoveredBuildingId={hoveredBuildingId}
          onSelectAgent={onSelectAgent}
          onHoverBuilding={setHoveredBuildingId}
          interactionRef={interactionRef}
        />
      </Canvas>
      <MinimapOverlay
        buildings={buildings}
        spritesRef={spritesRef}
        cameraRef={cameraRef}
        viewport={viewport}
        onNavigate={navigateToTile}
      />
    </div>
  );
}
