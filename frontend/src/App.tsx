/**
 * Main application — Jewellery STL Stone Fitting.
 *
 * Layout: Left panel (35%) with controls + Right panel (65%) with 3D viewer.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { UploadZone } from './components/UploadZone';
import { ProgressStepper } from './components/ProgressStepper';
import { StoneControls } from './components/StoneControls';
import { CavityList } from './components/CavityList';
import { ManualStonePanel } from './components/ManualStonePanel';
import { ChatPanel } from './components/ChatPanel';
import { Viewer3D } from './components/Viewer3D';
import { useStagedProcess } from './hooks/useStagedProcess';
import { useRegenerate } from './hooks/useRegenerate';
import { useChat } from './hooks/useChat';
import type {
  Cavity,
  ChatOperation,
  ManualStone,
  PendingMeshClick,
  StoneMaterialName,
  StoneCutName,
  JewelleryMaterialName,
  ProcessResponse,
} from './types/api';

function App() {
  // File state
  const [file, setFile] = useState<File | null>(null);

  // Staged-pipeline hook — one HTTP call per stage so the user can pause
  // between stages and inspect intermediate state.
  const {
    stages,
    stage1,
    stage2,
    stage3,
    stage4,
    error,
    isRunning,
    nextRunnableStage,
    runStage1,
    runNext,
    reset,
  } = useStagedProcess();

  // Regenerate hook
  const { regenerate, isRegenerating } = useRegenerate();

  // Chat hook — natural-language stone modifications via Gemini.
  const {
    messages: chatMessages,
    isThinking: chatThinking,
    send: sendChat,
    clear: clearChat,
  } = useChat();

  // Display data — overrides built-from-stages output when regenerate lands.
  const [displayResult, setDisplayResult] = useState<ProcessResponse | null>(null);

  // Stone settings
  const [stoneCut, setStoneCut] = useState<StoneCutName>('round_brilliant');
  const [stoneMaterial, setStoneMaterial] = useState<StoneMaterialName>('Diamond');
  const [stoneSize, setStoneSize] = useState<number>(1.0);
  const [customColor, setCustomColor] = useState<string | null>(null);

  // Jewellery (STL body) appearance — independent from the stones.
  const [jewelleryMaterial, setJewelleryMaterial] = useState<JewelleryMaterialName>('Silver');
  const [jewelleryCustomColor, setJewelleryCustomColor] = useState<string | null>(null);

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

  // Build a ProcessResponse-shaped object from per-stage data so the rest
  // of the UI doesn't need to know about the staged flow.
  const builtFromStages = useMemo<ProcessResponse | null>(() => {
    if (!stage1) return null;
    const total =
      stage1.stage_ms +
      (stage2?.stage_ms ?? 0) +
      (stage3?.stage_ms ?? 0) +
      (stage4?.stage_ms ?? 0);
    return {
      session_id: stage1.session_id,
      metadata: {
        filename: stage1.metadata.filename,
        vertices: stage1.metadata.vertices,
        faces: stage1.metadata.faces,
        bounding_box_mm: stage1.metadata.bounding_box_mm,
        total_cavities: stage2?.total_cavities ?? 0,
        processing_time_ms: {
          stage1_load: stage1.stage_ms,
          stage2_detect: stage2?.stage_ms ?? 0,
          stage3_generate: stage3?.stage_ms ?? 0,
          stage4_place: stage4?.stage_ms ?? 0,
          total,
        },
      },
      cavities: stage2?.cavities ?? [],
      jewellery_mesh_b64: stage1.jewellery_mesh_b64,
      composite_mesh_b64: stage4?.composite_mesh_b64 ?? '',
      stones_glb_b64: stage4?.stones_glb_b64 ?? '',
    };
  }, [stage1, stage2, stage3, stage4]);

  const activeResult = displayResult || builtFromStages;

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

  // Stage 1 trigger — wired to the UploadZone's primary button.
  const handleProcess = useCallback(() => {
    if (file) {
      setDisplayResult(null);
      setHiddenStoneIds(new Set());
      setSelectedCavityId(null);
      setManualStones([]);
      setSelectedManualId(null);
      setPendingMeshClick(null);
      setAutoStoneOffsets(new Map());
      runStage1(file);
    }
  }, [file, runStage1]);

  // Stage 2/3/4 trigger — wired to the ProgressStepper's Next button.
  const handleRunNext = useCallback(() => {
    runNext(stoneCut);
  }, [runNext, stoneCut]);

  // Apply a list of chat-driven operations to viewer state.
  // handleCutChange isn't defined yet at this point in the file, so we
  // route through a ref that gets bound below.
  const handleApplyOperationsRef = useRef<(ops: ChatOperation[]) => Promise<void>>(
    async () => {},
  );

  const handleSendChat = useCallback(
    async (msg: string) => {
      if (!activeResult?.session_id) return;
      const ops = await sendChat(activeResult.session_id, msg);
      if (ops.length > 0) {
        await handleApplyOperationsRef.current(ops);
      }
    },
    [activeResult, sendChat],
  );

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
    // Regenerate only lands meaningful output once stage 4 has run.
    if (activeResult?.session_id && stage4) {
      const newResult = await regenerate({
        session_id: activeResult.session_id,
        stone_type: cut,
        stone_material: stoneMaterial,
      });
      if (newResult) {
        setDisplayResult({
          ...activeResult,
          cavities: newResult.cavities ?? activeResult.cavities,
          composite_mesh_b64:
            newResult.composite_mesh_b64 ?? activeResult.composite_mesh_b64,
          stones_glb_b64:
            newResult.stones_glb_b64 ?? activeResult.stones_glb_b64,
        });
      }
    }
  }, [activeResult, stage4, stoneMaterial, regenerate]);

  const handleMaterialChange = useCallback((mat: StoneMaterialName) => {
    setStoneMaterial(mat);
    // Material change is client-side only — no backend call needed
  }, []);

  // Apply a chat-driven operation list. Defined here (after handleCutChange)
  // and assigned to handleApplyOperationsRef so the chat-send callback
  // declared earlier can call into it.
  const handleApplyOperations = useCallback(
    async (ops: ChatOperation[]) => {
      for (const op of ops) {
        switch (op.type) {
          case 'set_size':
            setStoneSize(op.factor);
            break;
          case 'set_cut':
            await handleCutChange(op.cut);
            break;
          case 'set_material':
            setStoneMaterial(op.material);
            break;
          case 'set_color':
            setCustomColor(op.color);
            break;
          case 'set_jewellery_material':
            setJewelleryMaterial(op.material);
            break;
          case 'remove_stone':
            setHiddenStoneIds(prev => {
              const next = new Set(prev);
              next.add(op.stone_id);
              return next;
            });
            break;
          case 'restore_all':
            setHiddenStoneIds(new Set());
            break;
          case 'move_stone':
            setAutoStoneOffsets(prev => {
              const next = new Map(prev);
              const cur = next.get(op.stone_id) ?? [0, 0, 0];
              next.set(op.stone_id, [
                cur[0] + op.dx,
                cur[1] + op.dy,
                cur[2] + op.dz,
              ]);
              return next;
            });
            break;
          case 'duplicate_stone': {
            // Look up the source cavity and clone its position + normal as a
            // manual stone offset by (dx, dy, dz). Manual stones live entirely
            // client-side, so this never hits the backend.
            const src = activeResult?.cavities.find(c => c.id === op.stone_id);
            if (!src) break;
            const id =
              typeof crypto !== 'undefined' && 'randomUUID' in crypto
                ? crypto.randomUUID()
                : `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            // Cavity stores INWARD normal — flip for the manual stone API.
            const outward: [number, number, number] = [
              -src.normal[0],
              -src.normal[1],
              -src.normal[2],
            ];
            setManualStones(s => [
              ...s,
              {
                id,
                position: [
                  src.centroid_mm[0] + op.dx,
                  src.centroid_mm[1] + op.dy,
                  src.centroid_mm[2] + op.dz,
                ],
                normal: outward,
                diameter_mm: src.diameter_mm,
                depth_mm: src.depth_mm,
                cut: (src.stone_cut as StoneCutName) ?? 'round_brilliant',
                liftOffset: 0,
              },
            ]);
            break;
          }
          case 'add_stone': {
            const id =
              typeof crypto !== 'undefined' && 'randomUUID' in crypto
                ? crypto.randomUUID()
                : `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const diameter = op.diameter_mm ?? 2.0;
            // Match the depth ratio used elsewhere for round-brilliants.
            const depth = diameter * 0.7;
            // Default to flat-up (+Y) if no normal supplied — matches the
            // anchors the prompt advertises (top/bottom/center on Y axis).
            const nx = op.nx ?? 0;
            const ny = op.ny ?? 1;
            const nz = op.nz ?? 0;
            setManualStones(s => [
              ...s,
              {
                id,
                position: [op.x, op.y, op.z],
                normal: [nx, ny, nz],
                diameter_mm: diameter,
                depth_mm: depth,
                cut: op.cut ?? 'round_brilliant',
                liftOffset: 0,
              },
            ]);
            setSelectedManualId(id);
            setSelectedCavityId(null);
            break;
          }
        }
      }
    },
    [activeResult, handleCutChange],
  );

  // Keep the forward-declared ref pointing at the latest handler.
  useEffect(() => {
    handleApplyOperationsRef.current = handleApplyOperations;
  }, [handleApplyOperations]);

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
            isProcessing={isRunning && nextRunnableStage === 1}
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

          {/* Progress stepper — show as soon as a file is selected so the
              user can see the upcoming steps and click Next on each one. */}
          {(file || isRunning || activeResult || error) && (
            <ProgressStepper
              stages={stages}
              // Stage 1 is triggered by the UploadZone button.
              nextRunnableStage={
                nextRunnableStage && nextRunnableStage > 1 ? nextRunnableStage : null
              }
              isRunning={isRunning}
              onRunNext={handleRunNext}
            />
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
                jewelleryMaterial={jewelleryMaterial}
                jewelleryCustomColor={jewelleryCustomColor}
                showStones={showStones}
                showCavityMarkers={showCavityMarkers}
                xrayMode={xrayMode}
                onCutChange={handleCutChange}
                onMaterialChange={handleMaterialChange}
                onSizeChange={setStoneSize}
                onCustomColorChange={setCustomColor}
                onJewelleryMaterialChange={setJewelleryMaterial}
                onJewelleryCustomColorChange={setJewelleryCustomColor}
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

          {/* Chat panel — natural-language stone modifications via Gemini */}
          <div className="h-px bg-[var(--color-border)]" />
          <ChatPanel
            messages={chatMessages}
            onSend={handleSendChat}
            onClear={clearChat}
            isThinking={chatThinking}
            disabled={!activeResult?.session_id}
          />
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
          jewelleryMaterial={jewelleryMaterial}
          jewelleryCustomColor={jewelleryCustomColor}
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
          onRemoveManualStone={handleRemoveManual}
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
