/**
 * Renders the STL jewellery mesh with metallic PBR material.
 */

import { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { base64ToBuffer } from '../utils/base64ToBuffer';

interface JewelleryMeshProps {
  stlBase64: string;
  opacity: number;
  xrayMode: boolean;
  onCenterComputed?: (center: THREE.Vector3) => void;
}

export function JewelleryMesh({ stlBase64, opacity, xrayMode, onCenterComputed }: JewelleryMeshProps) {
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

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshPhysicalMaterial
        color="#C0C0C0"
        metalness={0.9}
        roughness={0.15}
        transparent={xrayMode || opacity < 1}
        opacity={xrayMode ? 0.3 : opacity}
        side={THREE.DoubleSide}
        envMapIntensity={2}
        clearcoat={0.5}
        clearcoatRoughness={0.1}
      />
    </mesh>
  );
}
