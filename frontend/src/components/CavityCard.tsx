/**
 * Single cavity card showing stone details.
 */

import type { Cavity, StoneMaterialName } from '../types/api';

interface CavityCardProps {
  cavity: Cavity;
  isSelected: boolean;
  stoneMaterial: StoneMaterialName;
  onClick: (cavity: Cavity) => void;
}

const CUT_LABELS: Record<string, string> = {
  round_brilliant: 'Round Brilliant',
  princess: 'Princess',
  oval: 'Oval',
  marquise: 'Marquise',
  emerald: 'Emerald',
};

export function CavityCard({ cavity, isSelected, stoneMaterial, onClick }: CavityCardProps) {
  return (
    <div
      id={`cavity-card-${cavity.id}`}
      onClick={() => onClick(cavity)}
      className={`
        rounded-xl p-3.5 cursor-pointer
        transition-all duration-300 border
        ${isSelected
          ? 'border-[var(--color-accent)] bg-[rgba(99,102,241,0.1)] glow-accent'
          : 'border-[var(--color-border)] bg-[var(--color-bg-card)] hover:border-[var(--color-border-active)] hover:bg-[var(--color-bg-hover)]'
        }
      `}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">
          💎 Stone #{cavity.id}
        </span>
        <span className={`
          text-xs px-2 py-0.5 rounded-full font-medium
          ${cavity.confidence >= 0.75
            ? 'bg-[rgba(52,211,153,0.15)] text-[var(--color-success)]'
            : cavity.confidence >= 0.55
              ? 'bg-[rgba(251,191,36,0.15)] text-[var(--color-warning)]'
              : 'bg-[rgba(248,113,113,0.15)] text-[var(--color-error)]'
          }
        `}>
          {(cavity.confidence * 100).toFixed(0)}%
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <div>
          <span className="text-[var(--color-text-muted)]">Diameter</span>
          <p className="text-[var(--color-text-secondary)] font-medium">{cavity.diameter_mm.toFixed(2)} mm</p>
        </div>
        <div>
          <span className="text-[var(--color-text-muted)]">Depth</span>
          <p className="text-[var(--color-text-secondary)] font-medium">{cavity.depth_mm.toFixed(2)} mm</p>
        </div>
        <div>
          <span className="text-[var(--color-text-muted)]">Cut</span>
          <p className="text-[var(--color-text-secondary)] font-medium">{CUT_LABELS[cavity.stone_cut] || cavity.stone_cut}</p>
        </div>
        <div>
          <span className="text-[var(--color-text-muted)]">Material</span>
          <p className="text-[var(--color-text-secondary)] font-medium">{stoneMaterial}</p>
        </div>
      </div>
    </div>
  );
}
