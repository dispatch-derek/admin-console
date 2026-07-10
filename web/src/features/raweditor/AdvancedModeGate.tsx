// Advanced-mode acknowledgement (REQ-078). Raw-editor write controls stay inert until the operator
// explicitly enables advanced mode here. This is a deliberate friction step before break-glass
// raw env writes; it offers no default-on state.
import { AcknowledgeCheckbox } from '../../components/AcknowledgeCheckbox';

interface AdvancedModeGateProps {
  advanced: boolean;
  onChange: (advanced: boolean) => void;
}

export function AdvancedModeGate({ advanced, onChange }: AdvancedModeGateProps) {
  return (
    <div className="ac-advanced-gate">
      <p className="ac-warning">
        The raw environment editor writes engine configuration keys directly. Values are validated
        against the accepted key list, but no product-level guardrails apply. Enable advanced mode
        only if you understand the consequences.
      </p>
      <AcknowledgeCheckbox checked={advanced} onChange={onChange}>
        Enable advanced mode
      </AcknowledgeCheckbox>
    </div>
  );
}
