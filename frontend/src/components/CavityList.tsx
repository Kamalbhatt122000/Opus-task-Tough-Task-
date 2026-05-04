/**
 * Cavity list sidebar showing all detected stones.
 */

import type { Cavity, StoneMaterialName } from '../types/api';
import { CavityCard } from './CavityCard';

interface CavityListProps {
  cavities: Cavity[];
  selectedId: number | null;
  stoneMaterial: StoneMaterialName;
  onSelect: (cavity: Cavity) => void;
}

export function CavityList({ cavities, selectedId, stoneMaterial, onSelect }: CavityListProps) {
  if (cavities.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
          Stones placed: {cavities.length}
        </h3>
        <span className="text-xs text-[var(--color-text-muted)]">
          Click to focus
        </span>
      </div>

      <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
        {cavities.map(cavity => (
          <CavityCard
            key={cavity.id}
            cavity={cavity}
            isSelected={selectedId === cavity.id}
            stoneMaterial={stoneMaterial}
            onClick={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
