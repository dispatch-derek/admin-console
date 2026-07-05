// Secret-bearing setting control (REQ-060/061). Shows a set/not-set badge for the CURRENT stored
// state (the value itself is never revealed) and an overwrite-without-reveal input: entering a new
// value overwrites the secret; leaving it EMPTY means "no change" (REQ-061).

import { SetNotSetBadge } from '../../components/SetNotSetBadge';

interface SecretFieldProps {
  id: string;
  label: string;
  set: boolean;
  value: string; // the pending overwrite text (empty = no change)
  onChange: (value: string) => void;
}

export function SecretField({ id, label, set, value, onChange }: SecretFieldProps) {
  return (
    <label className="field secret-field">
      <span>
        {label} <SetNotSetBadge set={set} />
      </span>
      <input
        id={id}
        type="password"
        autoComplete="new-password"
        placeholder="Enter a new value to overwrite (leave blank to keep)"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
