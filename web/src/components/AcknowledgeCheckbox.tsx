// A native `role="checkbox"` acknowledgement affordance (e.g. "I understand and want to proceed",
// "I've saved these recovery codes", "Enable advanced mode"). Kept as a plain checkbox rather than
// the DS `Toggle` (which renders `role="switch"`) so callers whose contract/tests assert
// `role="checkbox"` are unaffected (see DangerConfirm's header comment). Extracted because this
// exact label/input/span markup was duplicated across DangerConfirm, EnrollMfa, and
// AdvancedModeGate.
import type { ReactNode } from 'react';

interface AcknowledgeCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}

export function AcknowledgeCheckbox({ checked, onChange, children }: AcknowledgeCheckboxProps) {
  return (
    <label className="ac-field checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}
