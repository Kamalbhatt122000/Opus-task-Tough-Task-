/**
 * Renders the STL jewellery mesh with metallic PBR material.
 *
 * If `onSurfaceClick` is provided, mesh clicks are reported with the
 * world-space hit point and outward face normal. The mesh sits at
 * identity transform (only the geometry is centered), so e.point and
 * e.face.normal are already in world / centered space.
 */

import { useMemo, useEffect, useCallback } from 'react';
import { type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { base64ToBuffer } from '../utils/base64ToBuffer';
import type { JewelleryPreset } from '../utils/materialPresets';

interface JewelleryMeshProps {
  stlBase64: string;
  opacity: number;
  xrayMode: boolean;
  materialPreset: JewelleryPreset;
  customColor: string | null;
  onCenterComputed?: (center: THREE.Vector3) => void;
  onSurfaceClick?: (
    point: [number, number, number],
    normal: [number, number, number],
  ) => void;
}

export function JewelleryMesh({
  stlBase64,
  opacity,
  xrayMode,
  materialPreset,
  customColor,
  onCenterComputed,
  onSurfaceClick,
}: JewelleryMeshProps) {
  const { geometry, center } = useMemo(() => {
    const buffer = base64ToBuffer(stlBase64);
    const loader = new STLLoader();
    const geo = loader.parse(buffer);
    geo.computeVertexNormals();
    // Centre geometry
    geo.computeBoundingBox();
    const c = new THREE.Vector3();
    geo.boundingBox?.getCenter(c);
    geo.translate(-c.x, -c.y, -c.z);
    return { geometry: geo, center: c };
  }, [stlBase64]);

  // Notify parent about the centering offset so stones can be aligned
  useEffect(() => {
    if (onCenterComputed) {
      onCenterComputed(center);
    }
  }, [center, onCenterComputed]);

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (!onSurfaceClick || !e.face) return;
      e.stopPropagation();
      const n = e.face.normal.clone().normalize();
      onSurfaceClick(
        [e.point.x, e.point.y, e.point.z],
        [n.x, n.y, n.z],
      );
    },
    [onSurfaceClick],
  );

  const effectiveColor = customColor ?? materialPreset.color;

  return (
    <mesh
      geometry={geometry}
      castShadow
      receiveShadow
      onClick={onSurfaceClick ? handleClick : undefined}
    >
      <meshPhysicalMaterial
        color={effectiveColor}
        metalness={materialPreset.metalness}
        roughness={materialPreset.roughness}
        transparent={xrayMode || opacity < 1}
        opacity={xrayMode ? 0.3 : opacity}
        side={THREE.DoubleSide}
        envMapIntensity={materialPreset.envMapIntensity}
        clearcoat={materialPreset.clearcoat}
        clearcoatRoughness={materialPreset.clearcoatRoughness}
      />
    </mesh>
  );
}
