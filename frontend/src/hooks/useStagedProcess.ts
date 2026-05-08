/**
 * Staged-pipeline hook — one HTTP call per stage, so the user can pause
 * between stages and inspect intermediate state. Mirrors the per-stage
 * endpoints under /api/session/...
 *
 * Each stage's response is held in its own state slot. The component decides
 * what to render based on which slots are populated.
 */

import { useState, useCallback } from 'react';
import type {
  StageProgress,
  Stage1Response,
  Stage2Response,
  Stage3Response,
  Stage4Response,
  StoneCutName,
} from '../types/api';

const INITIAL_STAGES: StageProgress[] = [
  { stage: 1, status: 'pending', message: 'Loading mesh…' },
  { stage: 2, status: 'pending', message: 'Detecting cavities…' },
  { stage: 3, status: 'pending', message: 'Generating stones…' },
  { stage: 4, status: 'pending', message: 'Placing stones…' },
];

interface UseStagedProcessReturn {
  stages: StageProgress[];
  sessionId: string | null;
  stage1: Stage1Response | null;
  stage2: Stage2Response | null;
  stage3: Stage3Response | null;
  stage4: Stage4Response | null;
  error: string | null;
  isRunning: boolean;
  /** Index (1..4) of the next stage that's runnable, or null if pipeline complete. */
  nextRunnableStage: 1 | 2 | 3 | 4 | null;
  runStage1: (file: File) => Promise<void>;
  runStage2: () => Promise<void>;
  runStage3: (stoneType?: StoneCutName) => Promise<void>;
  runStage4: () => Promise<void>;
  runNext: (stoneType?: StoneCutName) => Promise<void>;
  reset: () => void;
}

export function useStagedProcess(): UseStagedProcessReturn {
  const [stages, setStages] = useState<StageProgress[]>(INITIAL_STAGES);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [stage1, setStage1] = useState<Stage1Response | null>(null);
  const [stage2, setStage2] = useState<Stage2Response | null>(null);
  const [stage3, setStage3] = useState<Stage3Response | null>(null);
  const [stage4, setStage4] = useState<Stage4Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const reset = useCallback(() => {
    setStages(INITIAL_STAGES);
    setSessionId(null);
    setStage1(null);
    setStage2(null);
    setStage3(null);
    setStage4(null);
    setError(null);
    setIsRunning(false);
  }, []);

  const markStage = useCallback(
    (n: number, status: StageProgress['status'], message?: string) => {
      setStages(prev =>
        prev.map(s =>
          s.stage === n
            ? { ...s, status, ...(message ? { message } : {}) }
            : s,
        ),
      );
    },
    [],
  );

  const fail = useCallback(
    (n: number, msg: string) => {
      markStage(n, 'error', msg);
      setError(`Stage ${n}: ${msg}`);
      setIsRunning(false);
    },
    [markStage],
  );

  const runStage1 = useCallback(
    async (file: File) => {
      reset();
      setIsRunning(true);
      markStage(1, 'running');

      const fd = new FormData();
      fd.append('file', file);

      try {
        const res = await fetch('/api/session', { method: 'POST', body: fd });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }
        const data: Stage1Response = await res.json();
        setStage1(data);
        setSessionId(data.session_id);
        markStage(
          1,
          'done',
          `Loaded ${data.metadata.vertices.toLocaleString()} verts in ${data.stage_ms} ms`,
        );
      } catch (err) {
        fail(1, err instanceof Error ? err.message : 'Unknown error');
        return;
      }
      setIsRunning(false);
    },
    [reset, markStage, fail],
  );

  const runStage2 = useCallback(async () => {
    if (!sessionId) {
      setError('No session — load a mesh first.');
      return;
    }
    setIsRunning(true);
    markStage(2, 'running');
    try {
      const res = await fetch(`/api/session/${sessionId}/detect`, { method: 'POST' });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data: Stage2Response = await res.json();
      setStage2(data);
      markStage(2, 'done', `${data.total_cavities} cavities in ${data.stage_ms} ms`);
    } catch (err) {
      fail(2, err instanceof Error ? err.message : 'Unknown error');
      return;
    }
    setIsRunning(false);
  }, [sessionId, markStage, fail]);

  const runStage3 = useCallback(
    async (stoneType: StoneCutName = 'round_brilliant') => {
      if (!sessionId) {
        setError('No session — load a mesh first.');
        return;
      }
      setIsRunning(true);
      markStage(3, 'running');
      try {
        const res = await fetch(`/api/session/${sessionId}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stone_type: stoneType }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }
        const data: Stage3Response = await res.json();
        setStage3(data);
        markStage(
          3,
          'done',
          `${data.stone_count} stones in ${data.stage_ms} ms`,
        );
      } catch (err) {
        fail(3, err instanceof Error ? err.message : 'Unknown error');
        return;
      }
      setIsRunning(false);
    },
    [sessionId, markStage, fail],
  );

  const runStage4 = useCallback(async () => {
    if (!sessionId) {
      setError('No session — load a mesh first.');
      return;
    }
    setIsRunning(true);
    markStage(4, 'running');
    try {
      const res = await fetch(`/api/session/${sessionId}/place`, { method: 'POST' });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data: Stage4Response = await res.json();
      setStage4(data);
      markStage(4, 'done', `Placed in ${data.stage_ms} ms`);
    } catch (err) {
      fail(4, err instanceof Error ? err.message : 'Unknown error');
      return;
    }
    setIsRunning(false);
  }, [sessionId, markStage, fail]);

  // Which stage is runnable next? Used by the UI to label the "Next" button.
  let nextRunnableStage: 1 | 2 | 3 | 4 | null;
  if (!stage1) nextRunnableStage = 1;
  else if (!stage2) nextRunnableStage = 2;
  else if (!stage3) nextRunnableStage = 3;
  else if (!stage4) nextRunnableStage = 4;
  else nextRunnableStage = null;

  // The component shouldn't have to know which file it uploaded for stage 1 —
  // runNext for stage 1 is intentionally not wired up; callers use runStage1.
  const runNext = useCallback(
    async (stoneType?: StoneCutName) => {
      if (nextRunnableStage === 2) await runStage2();
      else if (nextRunnableStage === 3) await runStage3(stoneType);
      else if (nextRunnableStage === 4) await runStage4();
    },
    [nextRunnableStage, runStage2, runStage3, runStage4],
  );

  return {
    stages,
    sessionId,
    stage1,
    stage2,
    stage3,
    stage4,
    error,
    isRunning,
    nextRunnableStage,
    runStage1,
    runStage2,
    runStage3,
    runStage4,
    runNext,
    reset,
  };
}
