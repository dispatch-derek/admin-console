// F-005 lightweight (non-typed) confirmation dialog (REQ-F005-034/042/047/056/057). Wraps the DS
// `Modal` (role="dialog" + aria-modal). Deliberately NOT the parent §8 DangerConfirm: a toggle is
// highly reversible, so the gate is lightweight — no typed token, no acknowledge checkbox; the
// Confirm control is actionable the moment the dialog opens (REQ-F005-047). The copy names the
// feature + customer/install and ASSERTS IMMEDIATE customer effect (REQ-F005-034/057); an
// effective-state-unchanged reset shows explicit "no change to customer-visible state" copy and is
// still confirmed, never silent (REQ-F005-056).
//
// Focus management (REQ-F005-042): shares the app's `useModalFocusTrap` hook with DangerConfirm — move
// focus into the dialog on open, trap Tab within it, Escape cancels, and restore focus to the
// triggering control on any close. A successful "Reset to default" flips the row to hasOverride:false,
// which UNMOUNTS the Reset button that opened this dialog in the same commit; so we supply a stable
// per-row fallback — the row's Toggle switch (which never unmounts) — so focus lands there instead of
// dropping to <body> (REQ-F005-042 focus-returned-on-close).

import { useRef } from 'react';
import { ErrorBanner } from '../../components/ErrorBanner';
import { useModalFocusTrap } from '../../components/useModalFocusTrap';
import { Modal, Button } from '../../design-system';

export type ToggleConfirmAction =
  | { kind: 'set'; featureKey: string; displayName: string; nextEnabled: boolean }
  | {
      kind: 'reset';
      featureKey: string;
      displayName: string;
      resultEnabled: boolean;
      effectiveUnchanged: boolean;
    };

export interface ToggleConfirmProps {
  action: ToggleConfirmAction;
  customerLabel: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

// Consequence copy asserting immediate customer effect (REQ-F005-057). A reset whose result equals
// the current effective state states there is NO change to customer-visible state (REQ-F005-056).
function consequence(action: ToggleConfirmAction, customerLabel: string): string {
  if (action.kind === 'reset' && action.effectiveUnchanged) {
    return (
      `Resetting “${action.displayName}” to its default clears the operator override; there is ` +
      `no change to customer-visible state in ${customerLabel}’s app.`
    );
  }
  const willEnable = action.kind === 'set' ? action.nextEnabled : action.resultEnabled;
  return willEnable
    ? `“${action.displayName}” will be immediately available in ${customerLabel}’s app.`
    : `“${action.displayName}” will be immediately withheld from ${customerLabel}’s app.`;
}

function title(action: ToggleConfirmAction): string {
  if (action.kind === 'reset') return `Reset “${action.displayName}” to default`;
  return action.nextEnabled ? `Enable “${action.displayName}”` : `Disable “${action.displayName}”`;
}

export function ToggleConfirm({
  action,
  customerLabel,
  busy,
  error,
  onConfirm,
  onCancel,
}: ToggleConfirmProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  const { handleKeyDown } = useModalFocusTrap(modalRef, {
    onCancel,
    // Fallback when the opener is gone by close time: the switch in the same feature row. On a
    // successful reset the opener (the "Reset to default" button) unmounts, but the row's switch is
    // always rendered, so focus lands on it rather than dropping to <body> (REQ-F005-042).
    resolveFallback: (opener) =>
      opener?.closest('.feature-toggle-row')?.querySelector<HTMLElement>('[role="switch"]') ?? null,
  });

  return (
    <div ref={modalRef} tabIndex={-1} onKeyDown={handleKeyDown}>
      <Modal
        open
        title={title(action)}
        width={512}
        footer={
          <>
            <Button variant="ghost" onClick={() => onCancel()} disabled={busy}>
              Cancel
            </Button>
            <Button variant="solid" onClick={() => onConfirm()} disabled={busy}>
              Confirm
            </Button>
          </>
        }
      >
        <p className="feature-confirm-copy">{consequence(action, customerLabel)}</p>
        <ErrorBanner message={error} />
      </Modal>
    </div>
  );
}
