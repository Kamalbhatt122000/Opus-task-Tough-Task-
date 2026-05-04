/**
 * Stone controls panel — stone type, material, toggles, export.
 */

import type { StoneMaterialName, StoneCutName } from '../types/api';
import { STONE_CUTS, STONE_MATERIAL_NAMES } from '../utils/materialPresets';

interface StoneControlsProps {
  stoneCut: StoneCutName;
  stoneMaterial: StoneMaterialName;
  stoneSize: number;
  customColor: string | null;
  showStones: boolean;
  showCavityMarkers: boolean;
  xrayMode: boolean;
  onCutChange: (cut: StoneCutName) => void;
  onMaterialChange: (mat: StoneMaterialName) => void;
  onSizeChange: (size: number) => void;
  onCustomColorChange: (color: string | null) => void;
  onToggleStones: () => void;
  onToggleCavityMarkers: () => void;
  onToggleXray: () => void;
  onExportGlb: () => void;
  onExportJson: () => void;
  isRegenerating: boolean;
}

export function StoneControls({
  stoneCut,
  stoneMaterial,
  stoneSize,
  customColor,
  showStones,
  showCavityMarkers,
  xrayMode,
  onCutChange,
  onMaterialChange,
  onSizeChange,
  onCustomColorChange,
  onToggleStones,
  onToggleCavityMarkers,
  onToggleXray,
  onExportGlb,
  onExportJson,
  isRegenerating,
}: StoneControlsProps) {
  return (
    <div className="space-y-4 animate-fade-in">
      <h3 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
        Stone Settings
      </h3>

      {/* Stone Type */}
      <div>
        <label className="text-xs text-[var(--color-text-muted)] mb-1.5 block">Stone Cut</label>
        <select
          id="stone-cut-select"
          value={stoneCut}
          onChange={e => onCutChange(e.target.value as StoneCutName)}
          disabled={isRegenerating}
          className="w-full bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
        >
          {STONE_CUTS.map(cut => (
            <option key={cut.value} value={cut.value}>{cut.label}</option>
          ))}
        </select>
      </div>

      {/* Stone Material */}
      <div>
        <label className="text-xs text-[var(--color-text-muted)] mb-1.5 block">Stone Material</label>
        <select
          id="stone-material-select"
          value={stoneMaterial}
          onChange={e => onMaterialChange(e.target.value as StoneMaterialName)}
          className="w-full bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
        >
          {STONE_MATERIAL_NAMES.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>

      {/* Stone Size */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs text-[var(--color-text-muted)]">Stone Size</label>
          <span className="text-xs text-[var(--color-text-secondary)] font-medium">
            {Math.round(stoneSize * 100)}%
          </span>
        </div>
        <input
          id="stone-size-slider"
          type="range"
          min={0.5}
          max={2.0}
          step={0.05}
          value={stoneSize}
          onChange={e => onSizeChange(parseFloat(e.target.value))}
          className="w-full accent-[var(--color-accent)]"
        />
      </div>

      {/* Custom Colour */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs text-[var(--color-text-muted)]">Custom Colour</label>
          {customColor && (
            <button
              id="reset-custom-color"
              onClick={() => onCustomColorChange(null)}
              className="text-[10px] text-[var(--color-accent)] hover:underline"
            >
              Reset to {stoneMaterial}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            id="stone-color-picker"
            type="color"
            value={customColor ?? '#ffffff'}
            onChange={e => onCustomColorChange(e.target.value)}
            className="w-10 h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] cursor-pointer"
          />
          <input
            id="stone-color-hex"
            type="text"
            value={customColor ?? ''}
            placeholder="#auto (preset)"
            onChange={e => {
              const v = e.target.value.trim();
              if (v === '') return onCustomColorChange(null);
              if (/^#[0-9a-fA-F]{6}$/.test(v)) onCustomColorChange(v);
            }}
            className="flex-1 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-xs text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)] transition-colors font-mono"
          />
        </div>
      </div>

      {/* Toggles */}
      <div className="space-y-2.5">
        <Toggle label="Show stones" checked={showStones} onChange={onToggleStones} />
        <Toggle label="Show cavity markers" checked={showCavityMarkers} onChange={onToggleCavityMarkers} />
        <Toggle label="X-ray mode" checked={xrayMode} onChange={onToggleXray} />
      </div>

      {/* Export buttons */}
      <div className="flex gap-2 pt-1">
        <button
          id="export-glb-button"
          onClick={onExportGlb}
          className="flex-1 py-2 px-3 rounded-lg text-xs font-medium border border-[var(--color-border)] bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-all"
        >
          ⬇ Export GLB
        </button>
        <button
          id="export-json-button"
          onClick={onExportJson}
          className="flex-1 py-2 px-3 rounded-lg text-xs font-medium border border-[var(--color-border)] bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-all"
        >
          ⬇ Export JSON
        </button>
      </div>

      {isRegenerating && (
        <div className="flex items-center gap-2 text-xs text-[var(--color-accent)]">
          <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path fill="currentColor" className="opacity-75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Regenerating stones…
        </div>
      )}
    </div>
  );
}


function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex items-center justify-between cursor-pointer group">
      <span className="text-xs text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)] transition-colors">
        {label}
      </span>
      <div
        onClick={e => { e.preventDefault(); onChange(); }}
        className={`
          w-9 h-5 rounded-full relative transition-colors duration-300 cursor-pointer
          ${checked ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-bg-hover)]'}
        `}
      >
        <div className={`
          absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm
          transition-transform duration-300
          ${checked ? 'translate-x-4' : 'translate-x-0.5'}
        `} />
      </div>
    </label>
  );
}
