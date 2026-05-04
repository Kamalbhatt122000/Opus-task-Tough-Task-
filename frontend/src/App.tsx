/**
 * Main application — Jewellery STL Stone Fitting.
 *
 * Layout: Left panel (35%) with controls + Right panel (65%) with 3D viewer.
 */

import { useState, useCallback, useEffect } from 'react';
import { UploadZone } from './components/UploadZone';
import { ProgressStepper } from './components/ProgressStepper';
import { StoneControls } from './components/StoneControls';
import { CavityList } from './components/CavityList';
import { ManualStonePanel } from './components/ManualStonePanel';
import { Viewer3D } from './components/Viewer3D';
import { useProcess } from './hooks/useProcess';
import { useRegenerate } from './hooks/useRegenerate';
import type {
  Cavity,
  ManualStone,
  PendingMeshClick,
  StoneMaterialName,
  StoneCutName,
  ProcessResponse,
} from './types/api';

function App() {
  // File state
  const [file, setFile] = useState<File | null>(null);

  // Process hook
  const { stages, result, error, isProcessing, process, reset } = useProcess();

  // Regenerate hook
  const { regenerate, isRegenerating } = useRegenerate();

  // Display data (can be updated by regeneration)
  const [displayResult, setDisplayResult] = useState<ProcessResponse | null>(null);

  // Stone settings
  const [stoneCut, setStoneCut] = useState<StoneCutName>('round_brilliant');
  const [stoneMaterial, setStoneMaterial] = useState<StoneMaterialName>('Diamond');
  const [stoneSize, setStoneSize] = useState<number>(1.0);
  const [customColor, setCustomColor] = useState<string | null>(null);

  // Viewer toggles
  const [showStones, setShowStones] = useState(true);
  const [showCavityMarkers, setShowCavityMarkers] = useState(false);
  const [xrayMode, setXrayMode] = useState(false);
  const [meshOpacity, setMeshOpacity] = useState(1.0);
  const [selectedCavityId, setSelectedCavityId] = useState<number | null>(null);

  // Stones the user has hidden (per-session, never persisted to backend)
  const [hiddenStoneIds, setHiddenStoneIds] = useState<Set<number>>(() => new Set());

  // Camera distance to OrbitControls target. Two-way bound with the
  // viewer — wheel-zoom updates this, and the slider drives it back.
  // Default ≈ √(30² + 20² + 30²) ≈ 47, matching the initial camera at
  // [30, 20, 30] looking at the origin.
  const [zoomDistance, setZoomDistance] = useState<number>(47);

  // Manual stone placement (entirely client-side)
  const [manualStones, setManualStones] = useState<ManualStone[]>([]);
  const [selectedManualId, setSelectedManualId] = useState<string | null>(null);
  const [pendingMeshClick, setPendingMeshClick] = useState<PendingMeshClick>(null);

  // World-space delta applied on top of each auto stone's baked position.
  // Empty = stone sits exactly where the backend placed it. Cleared when
  // the user re-uploads / reprocesses.
  const [autoStoneOffsets, setAutoStoneOffsets] = useState<Map<number, [number, number, number]>>(
    () => new Map(),
  );

  // Use displayResult if available (from regeneration), else use original result
  const activeResult = displayResult || result;

  // Sync result to displayResult when first result arrives
  const prevResultRef = useState<ProcessResponse | null>(null);
  if (result && result !== prevResultRef[0]) {
    prevResultRef[1](result);
    if (!displayResult) {
      setDisplayResult(result);
    } else if (result.session_id !== displayResult.session_id) {
      setDisplayResult(result);
    }
  }

  const handleFileSelected = useCallback((f: File) => {
    setFile(f);
    setDisplayResult(null);
    setHiddenStoneIds(new Set());
    setSelectedCavityId(null);
    setManualStones([]);
    setSelectedManualId(null);
    setPendingMeshClick(null);
    setAutoStoneOffsets(new Map());
    reset();
  }, [reset]);

  const handleProcess = useCallback(() => {
    if (file) {
      setDisplayResult(null);
      setHiddenStoneIds(new Set());
      setSelectedCavityId(null);
      setManualStones([]);
      setSelectedManualId(null);
      setPendingMeshClick(null);
      setAutoStoneOffsets(new Map());
      process(file);
    }
  }, [file, process]);

  const handleStoneClick = useCallback((stoneId: number) => {
    // Selecting an auto stone clears manual selection and any pending click.
    setSelectedManualId(null);
    setPendingMeshClick(null);
    setSelectedCavityId(prev => (prev === stoneId ? null : stoneId));
  }, []);

  // ---- Manual stone handlers ----

  const handleManualStoneClick = useCallback((stoneId: string) => {
    setSelectedCavityId(null);
    setSelectedManualId(prev => (prev === stoneId ? null : stoneId));
  }, []);

  const handleSelectManual = useCallback((stoneId: string | null) => {
    setSelectedCavityId(null);
    setSelectedManualId(stoneId);
  }, []);

  const handleArmAdd = useCallback(() => {
    setPendingMeshClick({ kind: 'add' });
  }, []);

  const handleArmMove = useCallback((stoneId: string) => {
    setPendingMeshClick({ kind: 'move', stoneId });
  }, []);

  const handleCancelPending = useCallback(() => {
    setPendingMeshClick(null);
  }, []);

  const handleSurfaceClick = useCallback(
    (
      point: [number, number, number],
      normal: [number, number, number],
    ) => {
      setPendingMeshClick(prev => {
        if (prev === null) return prev;
        if (prev.kind === 'add') {
          const id =
            typeof crypto !== 'undefined' && 'randomUUID' in crypto
              ? crypto.randomUUID()
              : `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const newStone: ManualStone = {
            id,
            position: point,
            normal,
            diameter_mm: 2.0,
            depth_mm: 1.4,
            cut: 'round_brilliant',
            liftOffset: 0,
          };
          setManualStones(s => [...s, newStone]);
          setSelectedManualId(id);
          setSelectedCavityId(null);
        } else if (prev.kind === 'move') {
          const targetId = prev.stoneId;
          setManualStones(s =>
            s.map(stone =>
              stone.id === targetId ? { ...stone, position: point, normal } : stone,
            ),
          );
        }
        return null;
      });
    },
    [],
  );

  const handleUpdateManual = useCallback(
    (stoneId: string, patch: Partial<ManualStone>) => {
      setManualStones(s =>
        s.map(stone => (stone.id === stoneId ? { ...stone, ...patch } : stone)),
      );
    },
    [],
  );

  const handleRemoveManual = useCallback((stoneId: string) => {
    setManualStones(s => s.filter(stone => stone.id !== stoneId));
    setSelectedManualId(prev => (prev === stoneId ? null : prev));
    setPendingMeshClick(prev =>
      prev?.kind === 'move' && prev.stoneId === stoneId ? null : prev,
    );
  }, []);

  /**
   * Clear focus from any selected stone (auto or manual).
   * Bound to: ✕ overlay button, click on empty viewer space, ESC key.
   */
  const handleDeselectAll = useCallback(() => {
    setSelectedCavityId(null);
    setSelectedManualId(null);
  }, []);

  // ---- Move handlers (work for both auto and manual stones) ----

  const handleMoveAutoStone = useCallback(
    (stoneId: number, delta: [number, number, number]) => {
      setAutoStoneOffsets(prev => {
        const next = new Map(prev);
        const cur = next.get(stoneId) ?? [0, 0, 0];
        next.set(stoneId, [
          cur[0] + delta[0],
          cur[1] + delta[1],
          cur[2] + delta[2],
        ]);
        return next;
      });
    },
    [],
  );

  const handleResetAutoStone = useCallback((stoneId: number) => {
    setAutoStoneOffsets(prev => {
      if (!prev.has(stoneId)) return prev;
      const next = new Map(prev);
      next.delete(stoneId);
      return next;
    });
  }, []);

  const handleMoveManualStone = useCallback(
    (stoneId: string, delta: [number, number, number]) => {
      setManualStones(s =>
        s.map(stone =>
          stone.id === stoneId
            ? {
                ...stone,
                position: [
                  stone.position[0] + delta[0],
                  stone.position[1] + delta[1],
                  stone.position[2] + delta[2],
                ],
              }
            : stone,
        ),
      );
    },
    [],
  );

  // ESC clears focus / cancels a pending placement, whichever is active.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Don't steal Esc when the user is typing in an input/textarea/select.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (pendingMeshClick !== null) {
        setPendingMeshClick(null);
      } else if (selectedCavityId !== null || selectedManualId !== null) {
        handleDeselectAll();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingMeshClick, selectedCavityId, selectedManualId, handleDeselectAll]);

  const handleToggleHidden = useCallback((stoneId: number) => {
    setHiddenStoneIds(prev => {
      const next = new Set(prev);
      if (next.has(stoneId)) next.delete(stoneId);
      else next.add(stoneId);
      return next;
    });
  }, []);

  const handleCutChange = useCallback(async (cut: StoneCutName) => {
    setStoneCut(cut);
    if (activeResult?.session_id) {
      const newResult = await regenerate({
        session_id: activeResult.session_id,
        stone_type: cut,
        stone_material: stoneMaterial,
      });
      if (newResult) {
        setDisplayResult(newResult);
      }
    }
  }, [activeResult, stoneMaterial, regenerate]);

  const handleMaterialChange = useCallback((mat: StoneMaterialName) => {
    setStoneMaterial(mat);
    // Material change is client-side only — no backend call needed
  }, []);

  const handleCavitySelect = useCallback((cavity: Cavity) => {
    setSelectedCavityId(prev => prev === cavity.id ? null : cavity.id);
  }, []);

  const handleExportGlb = useCallback(() => {
    if (activeResult?.session_id) {
      window.open(`/api/export/glb/${activeResult.session_id}`, '_blank');
    }
  }, [activeResult]);

  const handleExportJson = useCallback(() => {
    if (!activeResult) return;
    const blob = new Blob([JSON.stringify(activeResult.cavities, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cavities.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [activeResult]);

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-[var(--color-bg-primary)]">
      {/* ───── LEFT PANEL ───── */}
      <aside className="w-[35%] min-w-[340px] max-w-[480px] h-full border-r border-[var(--color-border)] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--color-accent)] to-[#a78bfa] flex items-center justify-center">
              <span className="text-lg">💎</span>
            </div>
            <div>
              <h1 className="text-base font-bold text-[var(--color-text-primary)]">
                Stone Fitter
              </h1>
              <p className="text-[10px] text-[var(--color-text-muted)] tracking-wider uppercase">
                Jewellery STL Processing
              </p>
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Upload */}
          <UploadZone
            onFileSelected={handleFileSelected}
            isProcessing={isProcessing}
            onProcess={handleProcess}
            hasFile={!!file}
            fileName={file?.name}
            fileSize={file?.size}
          />

          {/* Error banner */}
          {error && (
            <div className="rounded-xl bg-[rgba(248,113,113,0.1)] border border-[var(--color-error)] p-3 animate-fade-in">
              <p className="text-xs font-semibold text-[var(--color-error)] mb-0.5">Processing Error</p>
              <p className="text-xs text-[var(--color-text-secondary)]">{error}</p>
            </div>
          )}

          {/* Progress stepper (show during/after processing) */}
          {(isProcessing || activeResult || error) && (
            <ProgressStepper stages={stages} />
          )}

          {/* Metadata card */}
          {activeResult && (
            <div className="rounded-xl bg-[var(--color-bg-card)] border border-[var(--color-border)] p-3.5 animate-fade-in">
              <h3 className="text-xs font-semibold text-[var(--color-text-muted)] mb-2 uppercase tracking-wider">
                Mesh Info
              </h3>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[var(--color-text-muted)]">Vertices</span>
                  <p className="text-[var(--color-text-primary)] font-medium">
                    {activeResult.metadata.vertices.toLocaleString()}
                  </p>
                </div>
                <div>
                  <span className="text-[var(--color-text-muted)]">Faces</span>
                  <p className="text-[var(--color-text-primary)] font-medium">
                    {activeResult.metadata.faces.toLocaleString()}
                  </p>
                </div>
                <div>
                  <span className="text-[var(--color-text-muted)]">Cavities</span>
                  <p className="text-[var(--color-text-primary)] font-medium">
                    {activeResult.metadata.total_cavities}
                  </p>
                </div>
                <div>
                  <span className="text-[var(--color-text-muted)]">Time</span>
                  <p className="text-[var(--color-text-primary)] font-medium">
                    {(activeResult.metadata.processing_time_ms.total / 1000).toFixed(1)}s
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Stone controls */}
          {activeResult && (
            <>
              <div className="h-px bg-[var(--color-border)]" />
              <StoneControls
                stoneCut={stoneCut}
                stoneMaterial={stoneMaterial}
                stoneSize={stoneSize}
                customColor={customColor}
                showStones={showStones}
                showCavityMarkers={showCavityMarkers}
                xrayMode={xrayMode}
                onCutChange={handleCutChange}
                onMaterialChange={handleMaterialChange}
                onSizeChange={setStoneSize}
                onCustomColorChange={setCustomColor}
                onToggleStones={() => setShowStones(!showStones)}
                onToggleCavityMarkers={() => setShowCavityMarkers(!showCavityMarkers)}
                onToggleXray={() => setXrayMode(!xrayMode)}
                onExportGlb={handleExportGlb}
                onExportJson={handleExportJson}
                isRegenerating={isRegenerating}
              />
            </>
          )}

          {/* Opacity slider */}
          {activeResult && (
            <div>
              <label className="text-xs text-[var(--color-text-muted)] mb-1.5 block">
                Mesh Opacity: {Math.round(meshOpacity * 100)}%
              </label>
              <input
                id="mesh-opacity-slider"
                type="range"
                min={0.2}
                max={1}
                step={0.05}
                value={meshOpacity}
                onChange={e => setMeshOpacity(parseFloat(e.target.value))}
                className="w-full accent-[var(--color-accent)]"
              />
            </div>
          )}

          {/* Zoom slider */}
          {activeResult && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-[var(--color-text-muted)]">
                  Zoom
                </label>
                <span className="text-[10px] text-[var(--color-text-muted)] font-mono">
                  {zoomDistance.toFixed(1)} mm
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[var(--color-text-muted)]">−</span>
                <input
                  id="zoom-slider"
                  type="range"
                  min={5}
                  max={200}
                  step={1}
                  /* Slider direction: pulled right = zoom IN (smaller distance).
                     We invert by displaying (max - value + min). */
                  value={205 - zoomDistance}
                  onChange={e => setZoomDistance(205 - parseFloat(e.target.value))}
                  className="flex-1 accent-[var(--color-accent)]"
                />
                <span className="text-[10px] text-[var(--color-text-muted)]">+</span>
              </div>
            </div>
          )}

          {/* Cavity list */}
          {activeResult && (
            <>
              <div className="h-px bg-[var(--color-border)]" />
              <CavityList
                cavities={activeResult.cavities}
                selectedId={selectedCavityId}
                hiddenIds={hiddenStoneIds}
                stoneMaterial={stoneMaterial}
                onSelect={handleCavitySelect}
                onToggleHidden={handleToggleHidden}
              />
            </>
          )}

          {/* Manual stone placement */}
          {activeResult && (
            <>
              <div className="h-px bg-[var(--color-border)]" />
              <ManualStonePanel
                stones={manualStones}
                selectedId={selectedManualId}
                pending={pendingMeshClick}
                onArmAdd={handleArmAdd}
                onArmMove={handleArmMove}
                onCancelPending={handleCancelPending}
                onSelect={handleSelectManual}
                onUpdate={handleUpdateManual}
                onRemove={handleRemoveManual}
              />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-[var(--color-border)]">
          <p className="text-[10px] text-[var(--color-text-muted)] text-center">
            Stone Fitter v1.0 — Powered by trimesh + Three.js
          </p>
        </div>
      </aside>

      {/* ───── RIGHT PANEL — 3D Viewer ───── */}
      <main className="flex-1 h-full p-3">
        <Viewer3D
          jewelleryB64={activeResult?.jewellery_mesh_b64 ?? null}
          stonesGlbB64={activeResult?.stones_glb_b64 ?? null}
          cavities={activeResult?.cavities ?? []}
          stoneMaterial={stoneMaterial}
          stoneSize={stoneSize}
          customColor={customColor}
          showStones={showStones}
          showCavityMarkers={showCavityMarkers}
          xrayMode={xrayMode}
          selectedCavityId={selectedCavityId}
          hiddenStoneIds={hiddenStoneIds}
          onStoneClick={handleStoneClick}
          onRemoveStone={handleToggleHidden}
          meshOpacity={meshOpacity}
          zoomDistance={zoomDistance}
          onZoomDistanceChange={setZoomDistance}
          manualStones={manualStones}
          selectedManualId={selectedManualId}
          pendingMeshClick={pendingMeshClick}
          onManualStoneClick={handleManualStoneClick}
          onSurfaceClick={handleSurfaceClick}
          onCancelPending={handleCancelPending}
          onDeselectAll={handleDeselectAll}
          autoStoneOffsets={autoStoneOffsets}
          onMoveAutoStone={handleMoveAutoStone}
          onResetAutoStone={handleResetAutoStone}
          onMoveManualStone={handleMoveManualStone}
        />
      </main>
    </div>
  );
}

export default App;
