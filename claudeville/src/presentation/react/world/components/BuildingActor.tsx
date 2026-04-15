import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import * as THREE from 'three';

import { TILE_HEIGHT, TILE_WIDTH } from '../../../../config/constants.js';
import { THEME } from '../../../../config/theme.js';
import { BUILDING_STYLES } from '../styles.js';
import { createPolygonGeometry, isoToScreen, lighten } from '../utils.js';
import { WorldText } from './WorldText.js';

export function BuildingActor({
  building,
  roofAlphaRef,
  hovered,
}: {
  building: any;
  roofAlphaRef: MutableRefObject<Map<string, number>>;
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
    </group>
  );
}
