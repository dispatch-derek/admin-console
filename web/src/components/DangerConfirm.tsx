// Reusable typed-target confirmation dialog for §8 dangerous operations (REQ-080). It:
//   (a) names the exact target,
//   (b) states the irreversible consequence, and
//   (c) requires an affirmative action distinct from a single default button — either the operator
//       types an exact token (workspace slug REQ-081, username REQ-082, a fixed raw-write token
//       REQ-078c) or ticks an explicit "I understand" toggle (provider/embedding/auth-token
//       warnings REQ-083/084/086).
// The destructive callback cannot fire until that criterion is satisfied.

import { useState, type ReactNode } from 'react';
import { ErrorBanner } from './ErrorBanner';

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
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal danger">
        <h3>{title}</h3>
        <p className="danger-target">
          Target: <strong>{target}</strong>
        </p>
        <p className="danger-consequence">{consequence}</p>

        {children}

        {expectedToken !== undefined ? (
          <label className="field">
            <span>
              Type the {tokenLabel ?? 'target'} <code>{expectedToken}</code> to confirm:
            </span>
            <input
              type="text"
              value={typed}
              autoComplete="off"
              onChange={(e) => setTyped(e.target.value)}
            />
          </label>
        ) : (
          <label className="field checkbox">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            <span>I understand and want to proceed</span>
          </label>
        )}

        <ErrorBanner message={error} />

        <div className="modal-actions">
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="danger-button"
            disabled={!armed || busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
