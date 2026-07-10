// Secret-bearing setting control (REQ-060/061). Shows a set/not-set badge for the CURRENT stored
// state (the value itself is never revealed) and an overwrite-without-reveal input: entering a new
// value overwrites the secret; leaving it EMPTY means "no change" (REQ-061).

import { SetNotSetBadge } from '../../components/SetNotSetBadge';
import { Input } from '../../design-system';

interface SecretFieldProps {
  id: string;
  label: string;
  set: boolean;
  value: string; // the pending overwrite text (empty = no change)
  onChange: (value: string) => void;
}

// F-001 REQ-F001-016/021: the overwrite-without-reveal field is the DS `Input` (password type,
// autoComplete new-password), with the set/not-set state carried by the DS-`Badge`-backed
// `SetNotSetBadge` alongside it. The DS `Input` owns the label→control association (getByLabelText),
// and the current stored state is never revealed.
export function SecretField({ id, label, set, value, onChange }: SecretFieldProps) {
  return (
    <div>
      <Input
        id={id}
        label={label}
        type="password"
        autoComplete="new-password"
        placeholder="Enter a new value to overwrite (leave blank to keep)"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <SetNotSetBadge set={set} />
    </div>
  );
}
