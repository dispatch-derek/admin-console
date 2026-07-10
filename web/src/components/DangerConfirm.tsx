// Reusable typed-target confirmation dialog for §8 dangerous operations (REQ-080). It:
//   (a) names the exact target,
//   (b) states the irreversible consequence, and
//   (c) requires an affirmative action distinct from a single default button — either the operator
//       types an exact token (workspace slug REQ-081, username REQ-082, a fixed raw-write token
//       REQ-078c) or ticks an explicit "I understand" toggle (provider/embedding/auth-token
//       warnings REQ-083/084/086).
// The destructive callback cannot fire until that criterion is satisfied.
//
// F-001 REQ-F001-020: re-implemented on the recreated DS primitives — the dialog chrome is the DS
// `Modal` (role="dialog" + aria-modal + accessible name from `title`, parent §8 a11y preserved), the
// footer actions are DS `Button`s (ghost Cancel + danger confirm), and the typed-token field is the
// DS `Input`. The acknowledge affordance stays a native checkbox (role="checkbox") — the DS `Toggle`
// renders role="switch", which would change this component's contract, so it is NOT substituted here.
// Public props/contract and gating behavior are unchanged.

import { useState, type ReactNode } from 'react';
import { ErrorBanner } from './ErrorBanner';
import { AcknowledgeCheckbox } from './AcknowledgeCheckbox';
import { Modal, Button, Input } from '../design-system';

interface DangerConfirmProps {
  title: string;
  target: string; // the exact target named to the operator
  consequence: string; // the irreversible consequence, stated plainly
  // Typed-token mode: the operator must type this exact string to arm the action.
  expectedToken?: string;
  tokenLabel?: string; // e.g. "workspace slug", "username", "confirmation token"
  confirmLabel?: string; // destructive button text (default "Confirm")
  error?: string | null; // BFF { message } surfaced verbatim on failure
  busy?: boolean;
  children?: ReactNode; // extra content, e.g. a masked diff
  onConfirm: () => void;
  onCancel: () => void;
}

export function DangerConfirm({
  title,
  target,
  consequence,
  expectedToken,
  tokenLabel,
  confirmLabel = 'Confirm',
  error,
  busy = false,
  children,
  onConfirm,
  onCancel,
}: DangerConfirmProps) {
  const [typed, setTyped] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  // Typed-token mode requires an exact match; toggle mode requires the checkbox.
  const armed = expectedToken !== undefined ? typed === expectedToken : acknowledged;

  return (
    <Modal
      open
      title={title}
      width={512}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" disabled={!armed || busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="ac-danger-target">
        Target: <strong>{target}</strong>
      </p>
      <p>{consequence}</p>

      {children}

      {expectedToken !== undefined ? (
        <Input
          label={`Type the ${tokenLabel ?? 'target'} "${expectedToken}" to confirm:`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
        />
      ) : (
        <AcknowledgeCheckbox checked={acknowledged} onChange={setAcknowledged}>
          I understand and want to proceed
        </AcknowledgeCheckbox>
      )}

      <ErrorBanner message={error} />
    </Modal>
  );
}
