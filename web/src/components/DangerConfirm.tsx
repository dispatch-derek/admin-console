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
//
// Accessibility (REQ-F002-034): as a modal dialog it (1) moves keyboard focus into itself on open,
// (2) traps Tab/Shift+Tab within the dialog, (3) cancels on Escape, and (4) returns focus to the
// element that opened it on ANY close — cancel, escape, or a successful confirm. Focus-return is
// handled here (not by each caller threading a trigger ref) so all callers are correct by default:
// every caller conditionally mounts this component, so mount captures the opener and unmount
// restores it. When a successful confirm disables or unmounts the opener in the same commit that
// closes the dialog, the opener can no longer take focus; callers may pass `fallbackFocusRef` — a
// stable landmark near the trigger — so focus lands there instead of falling through to <body>.
//
// The DS `Modal` has no built-in focus management and a vendored, closed prop contract (no keydown
// or ref hook), so the trap/initial-focus/restore logic below wraps Modal from the OUTSIDE: an owned
// wrapper div carries `modalRef` + `onKeyDown` (keydown bubbles up through Modal's real DOM subtree,
// since Modal renders in place with no portal), and `fieldRef` scopes the initial-focus query to just
// the typed-token/checkbox control, rather than relying on a ref Modal/Input don't expose.

import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { ErrorBanner } from './ErrorBanner';
import { AcknowledgeCheckbox } from './AcknowledgeCheckbox';
import { useModalFocusTrap } from './useModalFocusTrap';
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
  // Receives the exact string the operator typed (empty in toggle mode) so the caller can send the
  // operator's own input to the server rather than echoing a server-issued phrase back (defense in
  // depth; the server check must validate real input).
  onConfirm: (typed: string) => void;
  onCancel: () => void;
  // A stable, always-focusable landmark in the caller's markup (e.g. the section heading that
  // contains both the trigger and the result/status region). Focus falls back here on close ONLY
  // when the opener is no longer focusable — e.g. a successful confirm disabled or unmounted the
  // trigger in the same commit that closed this dialog. Optional: when omitted (or when the opener
  // is still valid, as on cancel/escape) the opener-focus path is used as before.
  fallbackFocusRef?: RefObject<HTMLElement>;
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
  fallbackFocusRef,
}: DangerConfirmProps) {
  const [typed, setTyped] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);

  // Wraps <Modal> from the outside — see file header. tabIndex={-1} makes this div itself a valid
  // (if unlikely-needed) initial-focus/programmatic-focus target without joining Tab order.
  const modalRef = useRef<HTMLDivElement>(null);
  // Scopes the initial-focus query to just the typed-token field, so we always focus the real typed
  // control instead of whatever happens to be first in DOM order (Modal's own header close-button,
  // if present, would otherwise win that race). Deliberately excludes the checkbox: in toggle mode
  // (no expectedToken) the reviewed, intended landing point is the dialog's own heading, not the
  // checkbox — jumping straight to a checkbox skips past the title/consequence a screen-reader user
  // needs to hear first.
  const fieldRef = useRef<HTMLDivElement>(null);

  const { handleKeyDown } = useModalFocusTrap(modalRef, {
    onCancel,
    // Scope initial focus to the typed-token field (so we land on the real control, not Modal's own
    // header close-button); in toggle mode there is no typed field, so the hook falls back to the
    // dialog heading. Deliberately excludes the checkbox — a screen-reader user should hear the
    // title/consequence before the acknowledge control.
    initialFocus: () => fieldRef.current?.querySelector<HTMLElement>('input:not([type="checkbox"])'),
    // A successful confirm can disable or unmount the opener in the same commit that closes this
    // dialog; fall back to the caller's stable landmark rather than dropping focus to <body>.
    resolveFallback: () => fallbackFocusRef?.current ?? null,
  });

  // Typed-token mode requires an exact match; toggle mode requires the checkbox.
  const armed = expectedToken !== undefined ? typed === expectedToken : acknowledged;

  return (
    <div ref={modalRef} tabIndex={-1} onKeyDown={handleKeyDown}>
      <Modal
        open
        title={title}
        width={512}
        footer={
          <>
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" disabled={!armed || busy} onClick={() => onConfirm(typed)}>
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

        <div ref={fieldRef}>
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
        </div>

        <ErrorBanner message={error} />
      </Modal>
    </div>
  );
}
