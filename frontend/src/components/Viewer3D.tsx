/**
 * Interactive 3D viewer using @react-three/fiber.
 * Renders jewellery mesh + placed stones with studio lighting.
 */

import { Suspense, useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { JewelleryMesh } from './JewelleryMesh';
import { base64ToBuffer } from '../utils/base64ToBuffer';
import { MATERIAL_PRESETS } from '../utils/materialPresets';
import type { Cavity, StoneMaterialName } from '../types/api';
import type { MaterialPreset } from '../utils/materialPresets';

interface Viewer3DProps {
  jewelleryB64: string | null;
  stonesGlbB64: string | null;
  cavities: Cavity[];
  stoneMaterial: StoneMaterialName;
  stoneSize: number;
  customColor: string | null;
  showStones: boolean;
  showCavityMarkers: boolean;
  xrayMode: boolean;
  selectedCavityId: number | null;
  meshOpacity: number;
}

// ------------------------------------------------------------------
// Stone scene loader + renderer
// ------------------------------------------------------------------

function StonesRenderer({
  stonesGlbB64,
  materialProps,
  stoneSize,
  customColor,
  visible,
  selectedCavityId,
  centerOffset,
}: {
  stonesGlbB64: string;
  materialProps: MaterialPreset;
  stoneSize: number;
  customColor: string | null;
  visible: boolean;
  selectedCavityId: number | null;
  centerOffset: THREE.Vector3;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const matsRef = useRef<THREE.MeshPhysicalMaterial[]>([]);
  const [scene, setScene] = useState<THREE.Group | null>(null);

  // Async-safe GLB parse — GLTFLoader.parse callback can resolve on a
  // microtask, so we cannot return a value synchronously from useMemo.
  useEffect(() => {
    let cancelled = false;
    setScene(null);
    try {
      const buffer = base64ToBuffer(stonesGlbB64);
      const loader = new GLTFLoader();
      loader.parse(
        buffer,
        '',
        (gltf) => {
          if (!cancelled) setScene(gltf.scene);
        },
        (err) => {
          console.error('GLTF parse error:', err);
        },
      );
    } catch (err) {
      console.error('Failed to decode stones GLB:', err);
    }
    return () => { cancelled = true; };
  }, [stonesGlbB64]);

  // Apply materials whenever scene, material, or custom colour changes
  useEffect(() => {
    if (!scene) return;
    const mats: THREE.MeshPhysicalMaterial[] = [];
    const effectiveColor = customColor ?? materialProps.color;
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mat = new THREE.MeshPhysicalMaterial({
          color: new THREE.Color(effectiveColor),
          transmission: materialProps.transmission,
          ior: materialProps.ior,
          roughness: materialProps.roughness,
          metalness: materialProps.metalness,
          thickness: materialProps.thickness,
          envMapIntensity: materialProps.envMapIntensity,
          clearcoat: materialProps.clearcoat,
          clearcoatRoughness: materialProps.clearcoatRoughness,
          transparent: true,
          side: THREE.DoubleSide,
        });
        child.material = mat;
        child.castShadow = true;
        mats.push(mat);
      }
    });
    matsRef.current = mats;
  }, [scene, materialProps, customColor]);

  // Scale each stone around its own centroid so size changes don't shift
  // the stones away from their cavities.
  useEffect(() => {
    if (!scene) return;
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        // Compute geometry centroid in local space (once per mesh)
        if (!child.userData.localCentroid) {
          child.geometry.computeBoundingBox();
          const c = new THREE.Vector3();
          child.geometry.boundingBox?.getCenter(c);
          child.userData.localCentroid = c.clone();
          child.userData.basePosition = child.position.clone();
        }
        const c: THREE.Vector3 = child.userData.localCentroid;
        const base: THREE.Vector3 = child.userData.basePosition;
        // Scale uniformly, then offset position so centroid stays put:
        //   newPos = base + c - c * scale
        child.scale.setScalar(stoneSize);
        child.position.set(
          base.x + c.x * (1 - stoneSize),
          base.y + c.y * (1 - stoneSize),
          base.z + c.z * (1 - stoneSize),
        );
      }
    });
  }, [scene, stoneSize]);

  // Emissive pulse for selected stone
  useFrame(() => {
    if (!scene) return;
    const t = (Math.sin(Date.now() * 0.005) + 1) / 2;
    const glowColor = customColor ?? materialProps.color;
    let idx = 0;
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && matsRef.current[idx]) {
        const mat = matsRef.current[idx];
        const stoneNum = idx + 1;
        if (selectedCavityId === stoneNum) {
          mat.emissive = new THREE.Color(glowColor);
          mat.emissiveIntensity = 0.2 + t * 0.5;
        } else {
          mat.emissiveIntensity = 0;
        }
        idx++;
      }
    });
  });

  if (!scene || !visible) return null;

  return (
    <group position={[-centerOffset.x, -centerOffset.y, -centerOffset.z]}>
      <primitive ref={groupRef} object={scene} />
    </group>
  );
}

// ------------------------------------------------------------------
// Cavity markers (spheres at cavity centroids)
// ------------------------------------------------------------------

function CavityMarkers({ cavities, visible, centerOffset }: { cavities: Cavity[]; visible: boolean; centerOffset: THREE.Vector3 }) {
  if (!visible) return null;
  return (
    <group>
      {cavities.map(c => {
        const pos: [number, number, number] = [
          c.centroid_mm[0] - centerOffset.x,
          c.centroid_mm[1] - centerOffset.y,
          c.centroid_mm[2] - centerOffset.z,
        ];
        return (
        <mesh key={c.id} position={pos}>
          <sphereGeometry args={[c.diameter_mm * 0.3, 16, 16]} />
          <meshStandardMaterial
            color="#fbbf24"
            emissive="#fbbf24"
            emissiveIntensity={0.5}
            transparent
            opacity={0.6}
            wireframe
          />
        </mesh>
        );
      })}
    </group>
  );
}

// ------------------------------------------------------------------
// Camera controller for smooth focus
// ------------------------------------------------------------------

function CameraFocus({ target, enabled }: { target: THREE.Vector3 | null; enabled: boolean }) {
  const { camera } = useThree();
  const targetRef = useRef<THREE.Vector3 | null>(null);
  const frameCount = useRef(0);

  useEffect(() => {
    if (target && enabled) {
      targetRef.current = target.clone();
      frameCount.current = 0;
    }
  }, [target, enabled]);

  useFrame(() => {
    if (!targetRef.current || frameCount.current > 40) return;
    frameCount.current++;
    const t = frameCount.current / 40;
    const ease = t * t * (3 - 2 * t); // smoothstep

    const dir = new THREE.Vector3().subVectors(targetRef.current, camera.position).normalize();
    const idealPos = targetRef.current.clone().sub(dir.multiplyScalar(15));

    camera.position.lerp(idealPos, ease * 0.1);
    camera.lookAt(targetRef.current);
  });

  return null;
}

// ------------------------------------------------------------------
// Main Viewer
// ------------------------------------------------------------------

export function Viewer3D({
  jewelleryB64,
  stonesGlbB64,
  cavities,
  stoneMaterial,
  stoneSize,
  customColor,
  showStones,
  showCavityMarkers,
  xrayMode,
  selectedCavityId,
  meshOpacity,
}: Viewer3DProps) {
  const [autoRotate, setAutoRotate] = useState(true);
  const [meshCenter, setMeshCenter] = useState<THREE.Vector3>(new THREE.Vector3());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const materialProps = MATERIAL_PRESETS[stoneMaterial];

  const handleCenterComputed = useCallback((center: THREE.Vector3) => {
    setMeshCenter(center);
  }, []);

  const focusTarget = useMemo(() => {
    if (!selectedCavityId) return null;
    const cav = cavities.find(c => c.id === selectedCavityId);
    if (!cav) return null;
    return new THREE.Vector3(
      cav.centroid_mm[0] - meshCenter.x,
      cav.centroid_mm[1] - meshCenter.y,
      cav.centroid_mm[2] - meshCenter.z,
    );
  }, [selectedCavityId, cavities, meshCenter]);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  const resetCamera = useCallback(() => {
    // Will be handled by re-mounting OrbitControls
    setAutoRotate(false);
    setTimeout(() => setAutoRotate(true), 100);
  }, []);

  const hasContent = jewelleryB64 !== null;

  return (
    <div ref={containerRef} className="relative w-full h-full rounded-2xl overflow-hidden">
      {/* Controls bar */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
        <button
          id="toggle-auto-rotate"
          onClick={() => setAutoRotate(!autoRotate)}
          title="Toggle auto-rotate"
          className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs transition-all ${
            autoRotate
              ? 'bg-[var(--color-accent)] text-white'
              : 'glass text-[var(--color-text-muted)] hover:text-white'
          }`}
        >
          ↻
        </button>
        <button
          id="reset-camera"
          onClick={resetCamera}
          title="Reset camera"
          className="w-8 h-8 rounded-lg glass flex items-center justify-center text-xs text-[var(--color-text-muted)] hover:text-white transition-all"
        >
          ⟲
        </button>
        <button
          id="toggle-fullscreen"
          onClick={toggleFullscreen}
          title="Fullscreen"
          className="w-8 h-8 rounded-lg glass flex items-center justify-center text-xs text-[var(--color-text-muted)] hover:text-white transition-all"
        >
          {isFullscreen ? '⊖' : '⊕'}
        </button>
      </div>

      {/* Empty state */}
      {!hasContent && (
        <div className="absolute inset-0 flex items-center justify-center z-0">
          <div className="text-center">
            <div className="w-20 h-20 rounded-full bg-[var(--color-bg-card)] flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl opacity-40">💎</span>
            </div>
            <p className="text-sm text-[var(--color-text-muted)]">Upload an STL to get started</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1 opacity-60">
              Drag & drop or click the upload zone
            </p>
          </div>
        </div>
      )}

      <Canvas
        camera={{ position: [30, 20, 30], fov: 45, near: 0.1, far: 1000 }}
        shadows
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.2 }}
        style={{ background: 'linear-gradient(180deg, #0a0a0f 0%, #12121a 50%, #1a1a2e 100%)' }}
      >
        <Suspense fallback={null}>
          {/* Studio HDRI environment */}
          <Environment preset="studio" />

          {/* Jewellery-optimised lighting */}
          <rectAreaLight
            position={[10, 10, 5]}
            width={10}
            height={10}
            intensity={4}
            color="#ffffff"
          />
          <rectAreaLight
            position={[-8, 5, 8]}
            width={8}
            height={8}
            intensity={2}
            color="#ffffff"
          />
          <pointLight position={[0, -10, 0]} intensity={0.8} color="#FFF5E0" />
          <ambientLight intensity={0.2} />

          {/* Jewellery mesh */}
          {jewelleryB64 && (
            <JewelleryMesh
              stlBase64={jewelleryB64}
              opacity={meshOpacity}
              xrayMode={xrayMode}
              onCenterComputed={handleCenterComputed}
            />
          )}

          {/* Stones */}
          {stonesGlbB64 && (
            <StonesRenderer
              stonesGlbB64={stonesGlbB64}
              materialProps={materialProps}
              stoneSize={stoneSize}
              customColor={customColor}
              visible={showStones}
              selectedCavityId={selectedCavityId}
              centerOffset={meshCenter}
            />
          )}

          {/* Cavity markers */}
          <CavityMarkers cavities={cavities} visible={showCavityMarkers} centerOffset={meshCenter} />

          {/* Camera focus controller */}
          <CameraFocus target={focusTarget} enabled={!!selectedCavityId} />

          {/* Controls */}
          <OrbitControls
            makeDefault
            autoRotate={autoRotate}
            autoRotateSpeed={1.2}
            enableDamping
            dampingFactor={0.05}
            minDistance={5}
            maxDistance={200}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
