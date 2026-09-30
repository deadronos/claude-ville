import { Billboard, Text } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type { MeshStandardMaterial } from 'three';
import { Box3, MathUtils, Ray, Vector3 } from 'three';

import type { VoxelVillageAgent, VoxelVillageBuilding } from '../model.js';

export function VoxelBuilding({
  building,
  selected,
  occlusionTargets,
  animatedAgentPositionsRef,
  onSelect,
}: {
  building: VoxelVillageBuilding;
  selected: boolean;
  occlusionTargets: VoxelVillageAgent[];
  animatedAgentPositionsRef: React.MutableRefObject<Map<string, Vector3>>;
  onSelect: () => void;
}) {
  const { camera } = useThree();
  const { voxelPosition, footprint } = building;
  const roofHeight = 0.45;
  const wallThickness = 0.14;
  const frontWallRef = useRef<MeshStandardMaterial | null>(null);
  const backWallRef = useRef<MeshStandardMaterial | null>(null);
  const leftWallRef = useRef<MeshStandardMaterial | null>(null);
  const rightWallRef = useRef<MeshStandardMaterial | null>(null);
  const roofRef = useRef<MeshStandardMaterial | null>(null);
  const occlusionBox = useMemo(() => new Box3(), []);
  const expandedOcclusionBox = useMemo(() => new Box3(), []);
  const ray = useMemo(() => new Ray(), []);
  const hitPoint = useMemo(() => new Vector3(), []);
  const buildingCenter = useMemo(
    () => new Vector3(voxelPosition.x, footprint.height / 2, voxelPosition.z),
    [footprint.height, voxelPosition.x, voxelPosition.z],
  );
  const cameraOffset = useMemo(() => new Vector3(), []);
  const targetOffset = useMemo(() => new Vector3(), []);
  const cameraForward = useMemo(() => new Vector3(), []);
  const cameraRight = useMemo(() => new Vector3(), []);
  const cameraUp = useMemo(() => new Vector3(), []);
  const targetPosition = useMemo(() => new Vector3(), []);
  const rayDirection = useMemo(() => new Vector3(), []);
  const sampleOffsets = useMemo(
    () => [
      new Vector3(0, 0.72, 0),
      new Vector3(0, 0.95, 0),
      new Vector3(0, 1.2, 0),
      new Vector3(0, 1.45, 0),
      new Vector3(0, 1.95, 0),
      new Vector3(0, 2.15, 0),
      new Vector3(0, 2.28, 0),
    ],
    [],
  );
  const samplePoint = useMemo(() => new Vector3(), []);

  useFrame(() => {
    const wallMaterials = [frontWallRef.current, backWallRef.current, leftWallRef.current, rightWallRef.current];
    if (!wallMaterials.every(Boolean) || !roofRef.current) {
      return;
    }

    let frontOpacity = 1;
    let backOpacity = 1;
    let leftOpacity = 1;
    let rightOpacity = 1;
    let roofOpacity = 1;

    occlusionBox.set(
      new Vector3(
        voxelPosition.x - footprint.width / 2,
        0,
        voxelPosition.z - footprint.depth / 2,
      ),
      new Vector3(
        voxelPosition.x + footprint.width / 2,
        footprint.height + roofHeight,
        voxelPosition.z + footprint.depth / 2,
      ),
    );
    expandedOcclusionBox.copy(occlusionBox).expandByVector(new Vector3(0.95, 0.45, 0.95));

    camera.getWorldDirection(cameraForward);
    cameraRight.copy(cameraForward).cross(camera.up).normalize();
    cameraUp.copy(camera.up).normalize();

    const targetIsOccluded = occlusionTargets.some((target) => {
      const animatedPosition = animatedAgentPositionsRef.current.get(target.id);
      if (animatedPosition) {
        targetPosition.copy(animatedPosition);
      } else {
        targetPosition.set(target.voxelPosition.x, 0, target.voxelPosition.z);
      }

      const rayOccluded = sampleOffsets.some((baseOffset, index) => {
        samplePoint.copy(targetPosition).add(baseOffset);

        if (index >= 4) {
          const labelHalfWidth = index === 4 ? 1.35 : index === 5 ? 1.35 : 0;
          const labelLift = index === 6 ? 0.24 : index === 5 ? 0.12 : 0;
          samplePoint.addScaledVector(cameraUp, labelLift);
          if (index === 4) {
            samplePoint.addScaledVector(cameraRight, -labelHalfWidth);
          } else if (index === 5) {
            samplePoint.addScaledVector(cameraRight, labelHalfWidth);
          }
        } else {
          const bodyHalfWidth = index === 0 ? 0 : index === 1 ? 0.24 : index === 2 ? -0.24 : index === 3 ? 0.34 : -0.34;
          samplePoint.addScaledVector(cameraRight, bodyHalfWidth);
        }

        rayDirection.copy(samplePoint).sub(camera.position);
        const targetDistance = rayDirection.length();
        if (targetDistance <= 0.001) {
          return false;
        }

        rayDirection.divideScalar(targetDistance);
        ray.set(camera.position, rayDirection);
        const intersection = ray.intersectBox(expandedOcclusionBox, hitPoint);
        return Boolean(intersection) && camera.position.distanceTo(hitPoint) < targetDistance - 0.05;
      });

      if (rayOccluded) {
        return true;
      }

      targetOffset.copy(targetPosition).sub(buildingCenter);
      const nearBuilding = Math.abs(targetOffset.x) <= footprint.width * 0.95 && Math.abs(targetOffset.z) <= footprint.depth * 0.95;
      const insideVerticalBand = targetPosition.y <= footprint.height + roofHeight + 1.2;
      const onFarSide = cameraOffset.dot(targetOffset) < 0.75;
      return nearBuilding && insideVerticalBand && onFarSide;
    });

    if (targetIsOccluded) {
      cameraOffset.copy(camera.position).sub(buildingCenter);
      frontOpacity = 0.08;
      backOpacity = 0.08;
      leftOpacity = 0.08;
      rightOpacity = 0.08;
      roofOpacity = cameraOffset.y > -0.4 ? 0.1 : 0.16;
    }

    setMaterialOpacity(frontWallRef.current, frontOpacity);
    setMaterialOpacity(backWallRef.current, backOpacity);
    setMaterialOpacity(leftWallRef.current, leftOpacity);
    setMaterialOpacity(rightWallRef.current, rightOpacity);
    setMaterialOpacity(roofRef.current, roofOpacity);
  });

  return (
    <group position={[voxelPosition.x, 0, voxelPosition.z]} onClick={(event) => {
      event.stopPropagation();
      onSelect();
    }}>
      <mesh position={[0, footprint.height / 2, footprint.depth / 2 - wallThickness / 2]}>
        <boxGeometry args={[footprint.width, footprint.height, wallThickness]} />
        <meshStandardMaterial ref={frontWallRef} color={building.colorHex} roughness={0.82} transparent opacity={1} />
      </mesh>
      <mesh position={[0, footprint.height / 2, -footprint.depth / 2 + wallThickness / 2]}>
        <boxGeometry args={[footprint.width, footprint.height, wallThickness]} />
        <meshStandardMaterial ref={backWallRef} color={building.colorHex} roughness={0.82} transparent opacity={1} />
      </mesh>
      <mesh position={[-footprint.width / 2 + wallThickness / 2, footprint.height / 2, 0]}>
        <boxGeometry args={[wallThickness, footprint.height, footprint.depth - wallThickness * 2]} />
        <meshStandardMaterial ref={leftWallRef} color={building.colorHex} roughness={0.82} transparent opacity={1} />
      </mesh>
      <mesh position={[footprint.width / 2 - wallThickness / 2, footprint.height / 2, 0]}>
        <boxGeometry args={[wallThickness, footprint.height, footprint.depth - wallThickness * 2]} />
        <meshStandardMaterial ref={rightWallRef} color={building.colorHex} roughness={0.82} transparent opacity={1} />
      </mesh>
      <mesh position={[0, footprint.height + roofHeight / 2, 0]}>
        <boxGeometry args={[footprint.width + 0.35, roofHeight, footprint.depth + 0.35]} />
        <meshStandardMaterial ref={roofRef} color={selected ? '#ffe16f' : building.roofHex} roughness={0.74} transparent opacity={1} />
      </mesh>
      <mesh position={[0, 0.04, footprint.depth / 2 + 0.08]}>
        <boxGeometry args={[0.58, 0.08, 0.18]} />
        <meshStandardMaterial color="#f4d09b" />
      </mesh>
      <Billboard position={[0, footprint.height + 1.05, 0]}>
        <Text
          fontSize={0.32}
          maxWidth={3.4}
          anchorX="center"
          anchorY="middle"
          color="#11233a"
          outlineWidth={0.025}
          outlineColor="#ffffff"
        >
          {building.name}
        </Text>
      </Billboard>
    </group>
  );
}

function setMaterialOpacity(material: MeshStandardMaterial | null, targetOpacity: number) {
  if (!material) {
    return;
  }
  material.opacity = MathUtils.lerp(material.opacity, targetOpacity, 0.18);
  material.transparent = material.opacity < 0.995;
  material.depthWrite = material.opacity >= 0.35;
}
