/**
 * Hook to handle the SSE stream from POST /api/process.
 * Uses fetch + ReadableStream since EventSource doesn't support POST.
 */

import { useState, useCallback } from 'react';
import type { ProcessResponse, StageProgress, SSEEvent } from '../types/api';

interface UseProcessReturn {
  stages: StageProgress[];
  result: ProcessResponse | null;
  error: string | null;
  isProcessing: boolean;
  process: (file: File) => Promise<void>;
  reset: () => void;
}

const INITIAL_STAGES: StageProgress[] = [
  { stage: 1, status: 'pending', message: 'Loading mesh…' },
  { stage: 2, status: 'pending', message: 'Detecting cavities…' },
  { stage: 3, status: 'pending', message: 'Generating stones…' },
  { stage: 4, status: 'pending', message: 'Placing stones…' },
];

export function useProcess(): UseProcessReturn {
  const [stages, setStages] = useState<StageProgress[]>(INITIAL_STAGES);
  const [result, setResult] = useState<ProcessResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const reset = useCallback(() => {
    setStages(INITIAL_STAGES);
    setResult(null);
    setError(null);
    setIsProcessing(false);
  }, []);

  const process = useCallback(async (file: File) => {
    reset();
    setIsProcessing(true);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/process', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // SSE format: "data: {json}"
          const dataPrefix = 'data: ';
          const jsonStr = trimmed.startsWith(dataPrefix)
            ? trimmed.slice(dataPrefix.length)
            : trimmed;

          try {
            const event: SSEEvent = JSON.parse(jsonStr);

            setStages(prev =>
              prev.map(s =>
                s.stage === event.stage
                  ? { ...s, status: event.status === 'running' ? 'running' : event.status, message: event.message }
                  : s.stage < event.stage && event.status !== 'error'
                    ? { ...s, status: 'done' }
                    : s
              )
            );

            if (event.status === 'error') {
              setError(`Stage ${event.stage} failed: ${event.message}`);
              setIsProcessing(false);
              return;
            }

            if (event.stage === 4 && event.status === 'done' && event.data) {
              setResult(event.data);
            }
          } catch {
            // Skip non-JSON lines
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsProcessing(false);
    }
  }, [reset]);

  return { stages, result, error, isProcessing, process, reset };
}
