/**
 * Hook to handle POST /api/regenerate — re-runs stages 3+4
 * with a new stone type without re-uploading.
 */

import { useState, useCallback } from 'react';
import type { ProcessResponse, RegenerateRequest } from '../types/api';

interface UseRegenerateReturn {
  regenerate: (req: RegenerateRequest) => Promise<ProcessResponse | null>;
  isRegenerating: boolean;
  error: string | null;
}

export function useRegenerate(): UseRegenerateReturn {
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const regenerate = useCallback(async (req: RegenerateRequest): Promise<ProcessResponse | null> => {
    setIsRegenerating(true);
    setError(null);

    try {
      const response = await fetch('/api/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || `HTTP ${response.status}`);
      }

      const data: ProcessResponse = await response.json();
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Regeneration failed';
      setError(msg);
      return null;
    } finally {
      setIsRegenerating(false);
    }
  }, []);

  return { regenerate, isRegenerating, error };
}
