/**
 * Stepped progress indicator showing 4 processing stages.
 */

import type { StageProgress } from '../types/api';

interface ProgressStepperProps {
  stages: StageProgress[];
}

const STAGE_LABELS = [
  'Loading mesh',
  'Detecting cavities',
  'Generating stones',
  'Placing stones',
];

const STAGE_ICONS = ['📦', '🔍', '💎', '🎯'];

export function ProgressStepper({ stages }: ProgressStepperProps) {
  return (
    <div className="space-y-2 py-3">
      {stages.map((stage, i) => (
        <div
          key={stage.stage}
          className={`
            flex items-center gap-3 px-3 py-2.5 rounded-lg
            transition-all duration-500
            ${stage.status === 'running'
              ? 'bg-[rgba(99,102,241,0.1)] border border-[var(--color-accent)]'
              : stage.status === 'done'
                ? 'bg-[rgba(52,211,153,0.06)]'
                : stage.status === 'error'
                  ? 'bg-[rgba(248,113,113,0.08)] border border-[var(--color-error)]'
                  : 'bg-transparent'
            }
          `}
        >
          {/* Status icon */}
          <div className={`
            w-8 h-8 rounded-full flex items-center justify-center text-sm
            transition-all duration-300 flex-shrink-0
            ${stage.status === 'running'
              ? 'bg-[var(--color-accent)] text-white animate-pulse'
              : stage.status === 'done'
                ? 'bg-[var(--color-success)] text-white'
                : stage.status === 'error'
                  ? 'bg-[var(--color-error)] text-white'
                  : 'bg-[var(--color-bg-hover)] text-[var(--color-text-muted)]'
            }
          `}>
            {stage.status === 'done' ? '✓' : stage.status === 'error' ? '✕' : STAGE_ICONS[i]}
          </div>

          {/* Label and message */}
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium ${
              stage.status === 'running' ? 'text-[var(--color-accent)]' :
              stage.status === 'done' ? 'text-[var(--color-success)]' :
              stage.status === 'error' ? 'text-[var(--color-error)]' :
              'text-[var(--color-text-muted)]'
            }`}>
              {STAGE_LABELS[i]}
            </p>
            {(stage.status === 'running' || stage.status === 'error') && (
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate">
                {stage.message}
              </p>
            )}
          </div>

          {/* Spinner for running */}
          {stage.status === 'running' && (
            <svg className="animate-spin w-4 h-4 text-[var(--color-accent)] flex-shrink-0" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
              <path fill="currentColor" className="opacity-75"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
        </div>
      ))}
    </div>
  );
}
