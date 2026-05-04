/**
 * Renders a single user-placed gemstone with the same physical material
 * as the auto-detected stones. Click forwards to the parent so the App
 * can mark it selected.
 *
 * Orientation: stone +Z (table-up) is rotated to align with the surface
 * outward normal. Position = surface hit + normal × liftOffset, so the
 * lift slider lets the user fine-tune how deep the girdle sits without
 * having to re-click.
 */

import { useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { buildRoundBrilliantGeometry } from '../utils/buildStoneGeometry';
import type { ManualStone } from '../types/api';
import type { MaterialPreset } from '../utils/materialPresets';

const LOCAL_UP = new THREE.Vector3(0, 0, 1);

interface ManualStoneMeshProps {
  stone: ManualStone;
  materialProps: MaterialPreset;
  customColor: string | null;
  isSelected: boolean;
  visible: boolean;
  onClick: (stoneId: string) => void;
}

export function ManualStoneMesh({
  stone,
  materialProps,
  customColor,
  isSelected,
  visible,
  onClick,
}: ManualStoneMeshProps) {
  const matRef = useRef<THREE.MeshPhysicalMaterial>(null);

  const geometry = useMemo(
    () => buildRoundBrilliantGeometry(stone.diameter_mm, stone.depth_mm),
    [stone.diameter_mm, stone.depth_mm],
  );

  const quaternion = useMemo(() => {
    const target = new THREE.Vector3(...stone.normal);
    const len = target.length();
    if (len < 1e-6) return new THREE.Quaternion();
    target.divideScalar(len);
    return new THREE.Quaternion().setFromUnitVectors(LOCAL_UP, target);
  }, [stone.normal]);

  const position = useMemo(() => {
    const p = new THREE.Vector3(...stone.position);
    const n = new THREE.Vector3(...stone.normal);
    const len = n.length();
    if (len > 1e-6) {
      p.add(n.divideScalar(len).multiplyScalar(stone.liftOffset));
    }
    return p;
  }, [stone.position, stone.normal, stone.liftOffset]);

  useFrame(() => {
    const mat = matRef.current;
    if (!mat) return;
    if (isSelected) {
      const t = (Math.sin(Date.now() * 0.005) + 1) / 2;
      mat.emissive.set(customColor ?? materialProps.color);
      mat.emissiveIntensity = 0.2 + t * 0.5;
    } else if (mat.emissiveIntensity !== 0) {
      mat.emissiveIntensity = 0;
    }
  });

  if (!visible) return null;

  return (
    <mesh
      geometry={geometry}
      position={position}
      quaternion={quaternion}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onClick(stone.id);
      }}
      castShadow
    >
      <meshPhysicalMaterial
        ref={matRef}
        color={customColor ?? materialProps.color}
        transmission={materialProps.transmission}
        ior={materialProps.ior}
        roughness={materialProps.roughness}
        metalness={materialProps.metalness}
        thickness={materialProps.thickness}
        envMapIntensity={materialProps.envMapIntensity}
        clearcoat={materialProps.clearcoat}
        clearcoatRoughness={materialProps.clearcoatRoughness}
        transparent
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
