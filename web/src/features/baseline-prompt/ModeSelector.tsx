// Composition-mode selector (REQ-F002-055). A segmented radio group (fieldset/legend + radios) —
// NOT a native <select> — so the destructive `overwrite` warning stays visible at rest. `prepend`
// is the default. Changing the mode invalidates any loaded preview (handled by the parent).

import type { OperatorMode } from '../../api/types';

interface Props {
  value: OperatorMode;
  disabled: boolean;
  onChange: (mode: OperatorMode) => void;
}

const OPTIONS: { value: OperatorMode; label: string; hint: string; destructive?: boolean }[] = [
  {
    value: 'prepend',
    label: 'Prepend (recommended)',
    hint: 'Baseline above each workspace’s preserved instructions.',
  },
  {
    value: 'overwrite',
    label: 'Overwrite',
    hint: 'Replaces the whole prompt — destroys per-workspace instructions.',
    destructive: true,
  },
  {
    value: 'fill',
    label: 'Fill when empty',
    hint: 'Writes the baseline only where a workspace has no prompt.',
  },
];

export function ModeSelector({ value, disabled, onChange }: Props) {
  return (
    <fieldset className="mode-selector" disabled={disabled}>
      <legend>Apply mode</legend>
      {OPTIONS.map((opt) => (
        <label
          key={opt.value}
          className={`mode-option${opt.destructive ? ' mode-option-destructive' : ''}${
            value === opt.value ? ' mode-option-selected' : ''
          }`}
        >
          <input
            type="radio"
            name="baseline-apply-mode"
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
          />
          <span className="mode-option-label">{opt.label}</span>
          <span className="mode-option-hint">{opt.hint}</span>
        </label>
      ))}
    </fieldset>
  );
}
