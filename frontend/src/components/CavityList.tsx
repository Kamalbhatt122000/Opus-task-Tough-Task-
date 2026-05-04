/**
 * Cavity list sidebar showing all detected stones.
 */

import type { Cavity, StoneMaterialName } from '../types/api';
import { CavityCard } from './CavityCard';

interface CavityListProps {
  cavities: Cavity[];
  selectedId: number | null;
  hiddenIds: ReadonlySet<number>;
  stoneMaterial: StoneMaterialName;
  onSelect: (cavity: Cavity) => void;
  onToggleHidden: (stoneId: number) => void;
}

export function CavityList({
  cavities,
  selectedId,
  hiddenIds,
  stoneMaterial,
  onSelect,
  onToggleHidden,
}: CavityListProps) {
  if (cavities.length === 0) return null;

  const visibleCount = cavities.length - hiddenIds.size;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
          Stones placed: {visibleCount}
          {hiddenIds.size > 0 && (
            <span className="text-[var(--color-text-muted)] font-normal">
              {' '}/ {cavities.length}
            </span>
          )}
        </h3>
        <span className="text-xs text-[var(--color-text-muted)]">
          Click to focus · ✕ to remove
        </span>
      </div>

      <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
        {cavities.map(cavity => (
          <CavityCard
            key={cavity.id}
            cavity={cavity}
            isSelected={selectedId === cavity.id}
            isHidden={hiddenIds.has(cavity.id)}
            stoneMaterial={stoneMaterial}
            onClick={onSelect}
            onToggleHidden={onToggleHidden}
          />
        ))}
      </div>
    </div>
  );
}
