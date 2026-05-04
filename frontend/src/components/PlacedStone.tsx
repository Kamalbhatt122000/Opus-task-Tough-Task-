/**
 * Renders one placed stone from a GLB scene with PBR gem material.
 * Supports selection highlight with emissive pulse animation.
 */

import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { MaterialPreset } from '../utils/materialPresets';

interface PlacedStoneProps {
  geometry: THREE.BufferGeometry;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
  materialProps: MaterialPreset;
  isSelected: boolean;
  visible: boolean;
}

export function PlacedStone({
  geometry,
  position,
  rotation,
  scale,
  materialProps,
  isSelected,
  visible,
}: PlacedStoneProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshPhysicalMaterial>(null);

  // Emissive pulse animation when selected
  useFrame((_, delta) => {
    if (!matRef.current) return;
    if (isSelected) {
      const t = (Math.sin(Date.now() * 0.005) + 1) / 2;
      matRef.current.emissiveIntensity = 0.2 + t * 0.4;
      matRef.current.emissive = new THREE.Color(materialProps.color);
    } else {
      matRef.current.emissiveIntensity = 0;
    }
  });

  if (!visible) return null;

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      position={position}
      rotation={rotation}
      scale={scale}
      castShadow
    >
      <meshPhysicalMaterial
        ref={matRef}
        color={materialProps.color}
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
