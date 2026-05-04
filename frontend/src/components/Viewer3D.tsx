/**
 * Interactive 3D viewer using @react-three/fiber.
 * Renders jewellery mesh + placed stones with studio lighting.
 */

import { Suspense, useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { JewelleryMesh } from './JewelleryMesh';
import { ManualStoneMesh } from './ManualStoneMesh';
import { base64ToBuffer } from '../utils/base64ToBuffer';
import { MATERIAL_PRESETS } from '../utils/materialPresets';
import type { Cavity, ManualStone, PendingMeshClick, StoneMaterialName } from '../types/api';
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
  hiddenStoneIds: ReadonlySet<number>;
  onStoneClick: (stoneId: number) => void;
  onRemoveStone: (stoneId: number) => void;
  meshOpacity: number;
  zoomDistance: number;
  onZoomDistanceChange: (distance: number) => void;
  // Manual stone placement
  manualStones: ManualStone[];
  selectedManualId: string | null;
  pendingMeshClick: PendingMeshClick;
  onManualStoneClick: (stoneId: string) => void;
  onSurfaceClick: (
    point: [number, number, number],
    normal: [number, number, number],
  ) => void;
  onCancelPending: () => void;
  onDeselectAll: () => void;
  // Per-stone movement
  autoStoneOffsets: ReadonlyMap<number, [number, number, number]>;
  onMoveAutoStone: (stoneId: number, delta: [number, number, number]) => void;
  onResetAutoStone: (stoneId: number) => void;
  onMoveManualStone: (stoneId: string, delta: [number, number, number]) => void;
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
  selectedStoneId,
  hiddenStoneIds,
  onStoneClick,
  centerOffset,
  offsets,
}: {
  stonesGlbB64: string;
  materialProps: MaterialPreset;
  stoneSize: number;
  customColor: string | null;
  visible: boolean;
  selectedStoneId: number | null;
  hiddenStoneIds: ReadonlySet<number>;
  onStoneClick: (stoneId: number) => void;
  centerOffset: THREE.Vector3;
  offsets: ReadonlyMap<number, [number, number, number]>;
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

  // Tag each mesh with a stable stoneId derived from the GLB node name
  // (backend names them "stone_1", "stone_2", …). Falls back to traversal
  // order if the name is missing.
  useEffect(() => {
    if (!scene) return;
    let traversalIdx = 0;
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const name = child.name || child.parent?.name || '';
        const m = name.match(/stone_(\d+)/i);
        const id = m ? parseInt(m[1], 10) : traversalIdx + 1;
        child.userData.stoneId = id;
        traversalIdx++;
      }
    });
  }, [scene]);

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

  // Per-stone visibility: hide stones whose id is in hiddenStoneIds.
  useEffect(() => {
    if (!scene) return;
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const id = child.userData.stoneId as number | undefined;
        child.visible = id == null ? true : !hiddenStoneIds.has(id);
      }
    });
  }, [scene, hiddenStoneIds]);

  // Scale each stone around its own centroid so size changes don't shift
  // the stones away from their cavities. Also apply user offsets from the
  // move pad so the stone can be nudged left/right/up/down.
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
        const id = child.userData.stoneId as number | undefined;
        const off = (id != null ? offsets.get(id) : undefined) ?? [0, 0, 0];

        // Scale uniformly around the local centroid, then add the user
        // offset on top. The group wrapping this mesh has no rotation,
        // so a world-space delta and a local-space delta are equal.
        child.scale.setScalar(stoneSize);
        child.position.set(
          base.x + c.x * (1 - stoneSize) + off[0],
          base.y + c.y * (1 - stoneSize) + off[1],
          base.z + c.z * (1 - stoneSize) + off[2],
        );
      }
    });
  }, [scene, stoneSize, offsets]);

  // Emissive pulse for selected stone
  useFrame(() => {
    if (!scene) return;
    const t = (Math.sin(Date.now() * 0.005) + 1) / 2;
    const glowColor = customColor ?? materialProps.color;
    let idx = 0;
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && matsRef.current[idx]) {
        const mat = matsRef.current[idx];
        const id = child.userData.stoneId as number | undefined;
        if (id != null && selectedStoneId === id) {
          mat.emissive = new THREE.Color(glowColor);
          mat.emissiveIntensity = 0.2 + t * 0.5;
        } else {
          mat.emissiveIntensity = 0;
        }
        idx++;
      }
    });
  });

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    let obj: THREE.Object3D | null = e.object;
    // Walk up until we find a node with a stoneId tag
    while (obj && obj.userData?.stoneId == null) {
      obj = obj.parent;
    }
    const id = obj?.userData?.stoneId as number | undefined;
    if (typeof id === 'number') onStoneClick(id);
  }, [onStoneClick]);

  if (!scene || !visible) return null;

  return (
    <group position={[-centerOffset.x, -centerOffset.y, -centerOffset.z]}>
      <primitive ref={groupRef} object={scene} onClick={handleClick} />
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
// Camera-vector tracker — keeps a ref up to date with the camera's
// world-space right and up axes. Used by the Move pad to translate
// "left/right/up/down" arrow clicks into a world-space delta that
// matches what the user sees on screen.
//
// A ref (not state) avoids re-rendering the viewer every frame.
// ------------------------------------------------------------------

interface CameraVectors {
  right: THREE.Vector3;
  up: THREE.Vector3;
}

function CameraVectorTracker({ store }: { store: React.MutableRefObject<CameraVectors> }) {
  const { camera } = useThree();
  useFrame(() => {
    store.current.right.setFromMatrixColumn(camera.matrixWorld, 0);
    store.current.up.setFromMatrixColumn(camera.matrixWorld, 1);
  });
  return null;
}

// ------------------------------------------------------------------
// Move-pad UI: 4-arrow tangent move + 2 lift buttons. Step is 0.2 mm
// by default; Shift-click multiplies by 5.
//
// All work happens in the parent — this component is purely the
// 3×3 grid of buttons + the lift row.
// ------------------------------------------------------------------

const MOVE_STEP_MM = 0.2;
const MOVE_STEP_SHIFT_MULT = 5;

type MoveDirection = 'left' | 'right' | 'up' | 'down' | 'liftUp' | 'liftDown';

function MovePad({
  onMove,
  onReset,
}: {
  onMove: (dir: MoveDirection, isShift: boolean) => void;
  onReset?: () => void;
}) {
  const btn =
    'w-7 h-7 rounded-md flex items-center justify-center text-xs ' +
    'bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] ' +
    'hover:bg-[var(--color-border-active)] hover:text-[var(--color-text-primary)] transition-colors';

  return (
    <div className="flex items-center gap-3">
      {/* Tangent (left / right / up / down) */}
      <div className="grid grid-cols-3 gap-0.5">
        <span />
        <button onClick={e => onMove('up', e.shiftKey)} title="Up (Shift × 5)" className={btn}>↑</button>
        <span />
        <button onClick={e => onMove('left', e.shiftKey)} title="Left (Shift × 5)" className={btn}>←</button>
        <span className="w-7 h-7 flex items-center justify-center text-[10px] text-[var(--color-text-muted)]">●</span>
        <button onClick={e => onMove('right', e.shiftKey)} title="Right (Shift × 5)" className={btn}>→</button>
        <span />
        <button onClick={e => onMove('down', e.shiftKey)} title="Down (Shift × 5)" className={btn}>↓</button>
        <span />
      </div>

      {/* Lift along surface normal */}
      <div className="flex flex-col gap-0.5">
        <button onClick={e => onMove('liftUp', e.shiftKey)} title="Lift up along normal" className={btn}>⬆</button>
        <button onClick={e => onMove('liftDown', e.shiftKey)} title="Sink along normal" className={btn}>⬇</button>
      </div>

      {/* Optional reset (only used for auto stones) */}
      {onReset && (
        <button
          onClick={onReset}
          title="Reset to original position"
          className="text-[10px] px-2 py-1 rounded-md bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          Reset
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Zoom controller — keeps the slider value in App and the camera's
// distance to the OrbitControls target in two-way sync.
//
// • Slider/buttons change `distance` → we dolly the camera there.
// • Wheel/drag zoom changes the camera → we report the new distance up.
//
// The `skipNext` ref prevents the feedback loop where applying our own
// dolly fires the controls 'change' event and bounces back as a
// duplicate state update.
// ------------------------------------------------------------------

export const ZOOM_MIN_DIST = 5;
export const ZOOM_MAX_DIST = 200;

type OrbitLike = {
  target: THREE.Vector3;
  update: () => void;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

function ZoomController({
  distance,
  onDistanceChange,
}: {
  distance: number;
  onDistanceChange: (d: number) => void;
}) {
  const { camera } = useThree();
  const controls = useThree(s => s.controls) as OrbitLike | null;
  const skipNext = useRef(false);

  // Apply incoming `distance` (from slider/buttons) to the camera.
  useEffect(() => {
    if (!controls) return;
    const target = controls.target;
    const offset = new THREE.Vector3().subVectors(camera.position, target);
    const currentDist = offset.length();
    if (currentDist < 1e-6) return;
    if (Math.abs(currentDist - distance) < 0.05) return;

    const clamped = Math.max(ZOOM_MIN_DIST, Math.min(ZOOM_MAX_DIST, distance));
    offset.setLength(clamped);
    skipNext.current = true;
    camera.position.copy(target).add(offset);
    controls.update();
  }, [distance, camera, controls]);

  // Report distance changes (wheel zoom, drag) back up to App.
  useEffect(() => {
    if (!controls) return;
    const handleChange = () => {
      if (skipNext.current) {
        skipNext.current = false;
        return;
      }
      const d = camera.position.distanceTo(controls.target);
      const clamped = Math.max(ZOOM_MIN_DIST, Math.min(ZOOM_MAX_DIST, d));
      if (Math.abs(clamped - distance) > 0.05) {
        onDistanceChange(clamped);
      }
    };
    controls.addEventListener('change', handleChange);
    return () => controls.removeEventListener('change', handleChange);
  }, [controls, camera, distance, onDistanceChange]);

  return null;
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
  hiddenStoneIds,
  onStoneClick,
  onRemoveStone,
  meshOpacity,
  zoomDistance,
  onZoomDistanceChange,
  manualStones,
  selectedManualId,
  pendingMeshClick,
  onManualStoneClick,
  onSurfaceClick,
  onCancelPending,
  onDeselectAll,
  autoStoneOffsets,
  onMoveAutoStone,
  onResetAutoStone,
  onMoveManualStone,
}: Viewer3DProps) {
  const [autoRotate, setAutoRotate] = useState(true);
  const [meshCenter, setMeshCenter] = useState<THREE.Vector3>(new THREE.Vector3());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Updated every frame by <CameraVectorTracker>. Read on each arrow
  // click — keeping it in a ref avoids re-rendering the whole viewer.
  const cameraVectorsRef = useRef<CameraVectors>({
    right: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
  });

  /**
   * Convert a directional click + a surface normal into a world-space
   * delta. Tangent moves (left/right/up/down) are projected onto the
   * plane perpendicular to the normal so the stone slides along the
   * surface; lift moves run along the normal itself.
   */
  const computeMoveDelta = useCallback(
    (
      dir: MoveDirection,
      surfaceNormal: [number, number, number],
      isShift: boolean,
    ): [number, number, number] => {
      const step = MOVE_STEP_MM * (isShift ? MOVE_STEP_SHIFT_MULT : 1);
      const N = new THREE.Vector3(...surfaceNormal);
      if (N.lengthSq() < 1e-9) {
        N.set(0, 1, 0);
      } else {
        N.normalize();
      }

      let v: THREE.Vector3;
      switch (dir) {
        case 'liftUp':
          v = N.clone().multiplyScalar(step);
          break;
        case 'liftDown':
          v = N.clone().multiplyScalar(-step);
          break;
        case 'left':
        case 'right':
        case 'up':
        case 'down': {
          const camR = cameraVectorsRef.current.right;
          const camU = cameraVectorsRef.current.up;
          const tangentR = camR.clone().sub(N.clone().multiplyScalar(camR.dot(N)));
          const tangentU = camU.clone().sub(N.clone().multiplyScalar(camU.dot(N)));
          // Fall back to a non-zero perpendicular if the camera axis is
          // parallel to the normal (degenerate at exactly top-down view).
          if (tangentR.lengthSq() < 1e-9) tangentR.crossVectors(N, camU).normalize();
          else tangentR.normalize();
          if (tangentU.lengthSq() < 1e-9) tangentU.crossVectors(tangentR, N).normalize();
          else tangentU.normalize();

          const sign = dir === 'right' || dir === 'up' ? 1 : -1;
          v = (dir === 'right' || dir === 'left' ? tangentR : tangentU)
            .multiplyScalar(sign * step);
          break;
        }
      }
      return [v.x, v.y, v.z];
    },
    [],
  );

  const handleZoomIn = useCallback(() => {
    onZoomDistanceChange(
      Math.max(ZOOM_MIN_DIST, Math.min(ZOOM_MAX_DIST, zoomDistance * 0.8)),
    );
  }, [zoomDistance, onZoomDistanceChange]);

  const handleZoomOut = useCallback(() => {
    onZoomDistanceChange(
      Math.max(ZOOM_MIN_DIST, Math.min(ZOOM_MAX_DIST, zoomDistance * 1.25)),
    );
  }, [zoomDistance, onZoomDistanceChange]);

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

  const selectedCavity = useMemo(
    () => (selectedCavityId == null ? null : cavities.find(c => c.id === selectedCavityId) ?? null),
    [selectedCavityId, cavities],
  );

  const selectedManual = useMemo(() => {
    if (selectedManualId == null) return null;
    const idx = manualStones.findIndex(s => s.id === selectedManualId);
    if (idx < 0) return null;
    return { stone: manualStones[idx], label: `M${idx + 1}` };
  }, [selectedManualId, manualStones]);

  const isAwaitingMeshClick = pendingMeshClick !== null;
  const movingLabel = useMemo(() => {
    if (pendingMeshClick?.kind !== 'move') return null;
    const idx = manualStones.findIndex(s => s.id === pendingMeshClick.stoneId);
    return idx >= 0 ? `M${idx + 1}` : null;
  }, [pendingMeshClick, manualStones]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full rounded-2xl overflow-hidden"
      style={{ cursor: isAwaitingMeshClick ? 'crosshair' : 'default' }}
    >
      {/* Placement banner */}
      {isAwaitingMeshClick && (
        <div
          id="placement-banner"
          className="absolute top-3 left-1/2 -translate-x-1/2 z-10 glass rounded-xl px-4 py-2 flex items-center gap-3 animate-fade-in"
        >
          <div className="text-xs text-[var(--color-text-secondary)]">
            {pendingMeshClick?.kind === 'add'
              ? '🎯 Click on the model to place a stone'
              : `🎯 Click on the model to relocate Stone ${movingLabel ?? ''}`}
          </div>
          <button
            id="cancel-placement"
            onClick={onCancelPending}
            className="text-[10px] px-2 py-1 rounded-md bg-[rgba(248,113,113,0.15)] text-[var(--color-error)] hover:bg-[rgba(248,113,113,0.25)] transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Selected-stone overlay (auto-detected) */}
      {selectedCavity && (
        <div
          id="selected-stone-overlay"
          className="absolute top-3 left-3 z-10 glass rounded-xl px-3.5 py-2.5 flex flex-col gap-2 animate-fade-in"
        >
          <div className="flex items-center gap-3">
            <div className="text-xs text-[var(--color-text-secondary)] leading-tight">
              <div className="font-semibold text-[var(--color-text-primary)]">
                💎 Stone #{selectedCavity.id}
              </div>
              <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                ⌀ {selectedCavity.diameter_mm.toFixed(2)} · depth {selectedCavity.depth_mm.toFixed(2)} mm
                {hiddenStoneIds.has(selectedCavity.id) && ' · hidden'}
              </div>
            </div>
            <div className="flex items-center gap-1 ml-auto">
              <button
                id="clear-focus-auto"
                onClick={onDeselectAll}
                title="Clear focus (Esc)"
                className="text-xs font-medium px-2 py-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] transition-all"
              >
                ✕
              </button>
              <button
                id="remove-selected-stone"
                onClick={() => onRemoveStone(selectedCavity.id)}
                className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-all ${
                  hiddenStoneIds.has(selectedCavity.id)
                    ? 'bg-[var(--color-accent)] text-white hover:opacity-90'
                    : 'bg-[rgba(248,113,113,0.15)] text-[var(--color-error)] hover:bg-[rgba(248,113,113,0.25)]'
                }`}
              >
                {hiddenStoneIds.has(selectedCavity.id) ? '↺ Restore' : '✕ Remove'}
              </button>
            </div>
          </div>
          {!hiddenStoneIds.has(selectedCavity.id) && (
            <div className="border-t border-[var(--color-border)] pt-2">
              <MovePad
                onMove={(dir, isShift) => {
                  // Cavity stores the INWARD normal; flip to outward.
                  const n: [number, number, number] = [
                    -selectedCavity.normal[0],
                    -selectedCavity.normal[1],
                    -selectedCavity.normal[2],
                  ];
                  onMoveAutoStone(selectedCavity.id, computeMoveDelta(dir, n, isShift));
                }}
                onReset={
                  autoStoneOffsets.has(selectedCavity.id)
                    ? () => onResetAutoStone(selectedCavity.id)
                    : undefined
                }
              />
            </div>
          )}
        </div>
      )}

      {/* Selected-stone overlay (manual) */}
      {selectedManual && (
        <div
          id="selected-manual-overlay"
          className="absolute top-3 left-3 z-10 glass rounded-xl px-3.5 py-2.5 flex flex-col gap-2 animate-fade-in"
        >
          <div className="flex items-center gap-3">
            <div className="text-xs text-[var(--color-text-secondary)] leading-tight">
              <div className="font-semibold text-[var(--color-text-primary)]">
                💎 Stone {selectedManual.label}
                <span className="ml-2 text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-normal">
                  manual
                </span>
              </div>
              <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                ⌀ {selectedManual.stone.diameter_mm.toFixed(2)} mm
                {selectedManual.stone.liftOffset !== 0 && (
                  <>
                    {' · lift '}
                    {selectedManual.stone.liftOffset > 0 ? '+' : ''}
                    {selectedManual.stone.liftOffset.toFixed(2)} mm
                  </>
                )}
              </div>
            </div>
            <button
              id="clear-focus-manual"
              onClick={onDeselectAll}
              title="Clear focus (Esc, or click empty space)"
              className="ml-auto text-xs font-medium px-3 py-1.5 rounded-lg bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border)] transition-all"
            >
              ✕ Clear focus
            </button>
          </div>
          <div className="border-t border-[var(--color-border)] pt-2">
            <MovePad
              onMove={(dir, isShift) => {
                onMoveManualStone(
                  selectedManual.stone.id,
                  computeMoveDelta(dir, selectedManual.stone.normal, isShift),
                );
              }}
            />
          </div>
        </div>
      )}

      {/* Controls bar */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
        <button
          id="zoom-in"
          onClick={handleZoomIn}
          title="Zoom in"
          className="w-8 h-8 rounded-lg glass flex items-center justify-center text-sm text-[var(--color-text-muted)] hover:text-white transition-all"
        >
          +
        </button>
        <button
          id="zoom-out"
          onClick={handleZoomOut}
          title="Zoom out"
          className="w-8 h-8 rounded-lg glass flex items-center justify-center text-sm text-[var(--color-text-muted)] hover:text-white transition-all"
        >
          −
        </button>
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
        onPointerMissed={() => {
          // Click on empty space → clear focus.
          // Skip if a placement is armed; the user is mid-action.
          if (isAwaitingMeshClick) return;
          if (selectedCavityId !== null || selectedManualId !== null) {
            onDeselectAll();
          }
        }}
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
              onSurfaceClick={isAwaitingMeshClick ? onSurfaceClick : undefined}
            />
          )}

          {/* Stones (auto-detected) */}
          {stonesGlbB64 && (
            <StonesRenderer
              stonesGlbB64={stonesGlbB64}
              materialProps={materialProps}
              stoneSize={stoneSize}
              customColor={customColor}
              visible={showStones}
              selectedStoneId={selectedCavityId}
              hiddenStoneIds={hiddenStoneIds}
              onStoneClick={onStoneClick}
              centerOffset={meshCenter}
              offsets={autoStoneOffsets}
            />
          )}

          {/* Manual stones (user-placed) */}
          {manualStones.map(stone => (
            <ManualStoneMesh
              key={stone.id}
              stone={stone}
              materialProps={materialProps}
              customColor={customColor}
              isSelected={selectedManualId === stone.id}
              visible={showStones}
              onClick={onManualStoneClick}
            />
          ))}

          {/* Cavity markers */}
          <CavityMarkers cavities={cavities} visible={showCavityMarkers} centerOffset={meshCenter} />

          {/* Camera focus controller */}
          <CameraFocus target={focusTarget} enabled={!!selectedCavityId} />

          {/* Two-way zoom binding (slider/buttons ↔ wheel) */}
          <ZoomController
            distance={zoomDistance}
            onDistanceChange={onZoomDistanceChange}
          />

          {/* Track camera world-space right/up axes for move-pad use */}
          <CameraVectorTracker store={cameraVectorsRef} />

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
