/**
 * Left-panel UI for the manual stone placement feature.
 *
 *  • "Add stone" button arms a single-shot click intent on the mesh.
 *  • Each placed stone gets a card with diameter / lift sliders, a Move
 *    button (re-arm the click intent), and a Delete button.
 *  • Selecting a card highlights the corresponding stone in 3D, and
 *    vice versa — App owns selection so both sides stay in sync.
 */

import type { ManualStone, PendingMeshClick } from '../types/api';

interface ManualStonePanelProps {
  stones: ManualStone[];
  selectedId: string | null;
  pending: PendingMeshClick;
  onArmAdd: () => void;
  onArmMove: (stoneId: string) => void;
  onCancelPending: () => void;
  onSelect: (stoneId: string | null) => void;
  onUpdate: (stoneId: string, patch: Partial<ManualStone>) => void;
  onRemove: (stoneId: string) => void;
}

export function ManualStonePanel({
  stones,
  selectedId,
  pending,
  onArmAdd,
  onArmMove,
  onCancelPending,
  onSelect,
  onUpdate,
  onRemove,
}: ManualStonePanelProps) {
  const isAdding = pending?.kind === 'add';
  const movingId = pending?.kind === 'move' ? pending.stoneId : null;

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
          Manual Stones
          {stones.length > 0 && (
            <span className="text-[10px] font-normal text-[var(--color-text-muted)]">
              ({stones.length})
            </span>
          )}
        </h3>
        {isAdding ? (
          <button
            id="cancel-add-manual"
            onClick={onCancelPending}
            className="text-[10px] px-2 py-1 rounded-md bg-[rgba(248,113,113,0.15)] text-[var(--color-error)] hover:bg-[rgba(248,113,113,0.25)] transition-colors"
          >
            Cancel
          </button>
        ) : (
          <button
            id="arm-add-manual"
            onClick={onArmAdd}
            className="text-[10px] px-2 py-1 rounded-md bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity"
          >
            + Add stone
          </button>
        )}
      </div>

      {isAdding && (
        <div className="rounded-lg bg-[rgba(99,102,241,0.1)] border border-[var(--color-accent)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
          Click anywhere on the model to place a stone.
        </div>
      )}

      {stones.length === 0 && !isAdding && (
        <p className="text-xs text-[var(--color-text-muted)] italic">
          No manual stones yet. Use “+ Add stone” and click on the model.
        </p>
      )}

      <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
        {stones.map((stone, idx) => (
          <ManualStoneCard
            key={stone.id}
            stone={stone}
            label={`M${idx + 1}`}
            isSelected={selectedId === stone.id}
            isMoving={movingId === stone.id}
            onSelect={onSelect}
            onArmMove={onArmMove}
            onCancelPending={onCancelPending}
            onUpdate={onUpdate}
            onRemove={onRemove}
          />
        ))}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------

interface ManualStoneCardProps {
  stone: ManualStone;
  label: string;
  isSelected: boolean;
  isMoving: boolean;
  onSelect: (stoneId: string | null) => void;
  onArmMove: (stoneId: string) => void;
  onCancelPending: () => void;
  onUpdate: (stoneId: string, patch: Partial<ManualStone>) => void;
  onRemove: (stoneId: string) => void;
}

function ManualStoneCard({
  stone,
  label,
  isSelected,
  isMoving,
  onSelect,
  onArmMove,
  onCancelPending,
  onUpdate,
  onRemove,
}: ManualStoneCardProps) {
  return (
    <div
      id={`manual-stone-card-${stone.id}`}
      onClick={() => onSelect(isSelected ? null : stone.id)}
      className={`rounded-xl p-3 cursor-pointer transition-all duration-200 border ${
        isSelected
          ? 'border-[var(--color-accent)] bg-[rgba(99,102,241,0.1)] glow-accent'
          : 'border-[var(--color-border)] bg-[var(--color-bg-card)] hover:border-[var(--color-border-active)] hover:bg-[var(--color-bg-hover)]'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">
          💎 Stone {label}
          {isMoving && (
            <span className="ml-2 text-[10px] uppercase tracking-wider text-[var(--color-accent)]">
              click to move
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          <button
            id={`move-manual-${stone.id}`}
            onClick={e => {
              e.stopPropagation();
              if (isMoving) onCancelPending();
              else onArmMove(stone.id);
            }}
            title={isMoving ? 'Cancel move' : 'Move (click on model next)'}
            className={`text-[10px] px-2 py-0.5 rounded-md transition-colors ${
              isMoving
                ? 'bg-[rgba(248,113,113,0.15)] text-[var(--color-error)]'
                : 'bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
            }`}
          >
            {isMoving ? '✕' : 'Move'}
          </button>
          <button
            id={`delete-manual-${stone.id}`}
            onClick={e => {
              e.stopPropagation();
              onRemove(stone.id);
            }}
            title="Delete stone"
            className="w-6 h-6 rounded-md flex items-center justify-center text-xs text-[var(--color-text-muted)] hover:bg-[rgba(248,113,113,0.15)] hover:text-[var(--color-error)] transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      {isSelected && (
        <div
          onClick={e => e.stopPropagation()}
          className="space-y-2 pt-2 border-t border-[var(--color-border)]"
        >
          <ControlSlider
            id={`diam-${stone.id}`}
            label="Diameter"
            min={0.5}
            max={10}
            step={0.05}
            value={stone.diameter_mm}
            unit="mm"
            onChange={v => onUpdate(stone.id, { diameter_mm: v, depth_mm: v * 0.7 })}
          />
          <ControlSlider
            id={`lift-${stone.id}`}
            label="Lift"
            min={-2}
            max={5}
            step={0.05}
            value={stone.liftOffset}
            unit="mm"
            onChange={v => onUpdate(stone.id, { liftOffset: v })}
          />
        </div>
      )}

      {!isSelected && (
        <div className="text-xs text-[var(--color-text-muted)]">
          ⌀ {stone.diameter_mm.toFixed(2)} mm
          {stone.liftOffset !== 0 && (
            <span> · lift {stone.liftOffset > 0 ? '+' : ''}{stone.liftOffset.toFixed(2)} mm</span>
          )}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------------

interface ControlSliderProps {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  onChange: (value: number) => void;
}

function ControlSlider({ id, label, min, max, step, value, unit, onChange }: ControlSliderProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <label className="text-[10px] text-[var(--color-text-muted)]">{label}</label>
        <span className="text-[10px] text-[var(--color-text-secondary)] font-mono">
          {value.toFixed(2)}{unit ? ` ${unit}` : ''}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full accent-[var(--color-accent)]"
      />
    </div>
  );
}
