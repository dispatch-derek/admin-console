// Preview → danger-gated apply → per-workspace result (REQ-F002-019/030/031/032/034/055). Mandatory
// pre-write preview mints the confirmToken and enables the (otherwise inert) apply control
// (REQ-F002-030). The apply is gated by DangerConfirm's typed-token pattern using the server-issued
// confirmationPhrase (REQ-F002-031/048); the opaque confirmToken never enters the DOM. The result
// renders per-workspace outcomes in an aria-live region — never a single "all saved" banner when
// anything failed or diverged (REQ-F002-032/022a/034).

import { useRef } from 'react';
import type {
  BaselineApplyResult,
  BaselinePreview,
  BaselinePreviewItem,
  OperatorMode,
  OverrideResolution,
} from '../../api/types';
import { DangerConfirm } from '../../components/DangerConfirm';
import { ErrorBanner } from '../../components/ErrorBanner';
import { ModeSelector } from './ModeSelector';
import { PreviewDiffItem } from './PreviewDiffItem';
import { Button } from '../../design-system';

interface Props {
  mode: OperatorMode;
  onModeChange: (mode: OperatorMode) => void;
  preview: BaselinePreview | null;
  previewing: boolean;
  previewError: string | null;
  onPreview: () => void;
  overrides: Record<string, OverrideResolution>;
  onOverrideChange: (workspaceId: string, resolution: OverrideResolution) => void;
  confirmOpen: boolean;
  onOpenConfirm: () => void;
  onCancelConfirm: () => void;
  applying: boolean;
  applyError: string | null;
  onApply: (typed: string) => void;
  result: BaselineApplyResult | null;
  disabled: boolean;
}

// Destructive blast radius (REQ-F002-031): union of resolvedMode==='overwrite' plus overridden
// baseline-only workspaces — the writes that discard live content with no preserve/discard choice.
function destructiveItems(items: BaselinePreviewItem[]): BaselinePreviewItem[] {
  return items.filter(
    (i) =>
      i.resolvedMode === 'overwrite' ||
      (i.resolvedMode === 'baseline-only' && i.syncState === 'overridden'),
  );
}

const OUTCOME_LABEL = {
  applied: 'Applied',
  failed: 'Failed',
  skipped: 'Skipped',
  diverged: 'Diverged (edited since preview)',
} as const;

export function BaselinePreviewApply({
  mode,
  onModeChange,
  preview,
  previewing,
  previewError,
  onPreview,
  overrides,
  onOverrideChange,
  confirmOpen,
  onOpenConfirm,
  onCancelConfirm,
  applying,
  applyError,
  onApply,
  result,
  disabled,
}: Props) {
  const canApply = preview !== null && preview.affectedCount > 0 && !applying;
  const destructive = preview ? destructiveItems(preview.items) : [];
  // The apply hint is only rendered (and thus only linkable) before a preview loads.
  const showApplyHint = preview === null && !previewing;

  // Focus fallback for a successful apply (REQ-F002-034): the apply succeeds by clearing `preview`,
  // which disables the "Apply baseline" trigger in the same commit that closes the dialog. Focus
  // returns to this section heading — which contains both the trigger and the result region — so it
  // stays predictable and is announced rather than dropping to <body>.
  const headingRef = useRef<HTMLHeadingElement>(null);

  return (
    <section className="baseline-region" aria-labelledby="baseline-apply-heading">
      <h2 id="baseline-apply-heading" ref={headingRef} tabIndex={-1}>
        Preview &amp; apply
      </h2>

      <ModeSelector value={mode} disabled={previewing || applying || disabled} onChange={onModeChange} />

      {/* DOM (and tab) order intentionally: preview → per-override radios → apply → dialog, so a
          keyboard user passes through the override preserve/discard controls that determine what gets
          written before reaching the destructive Apply trigger (REQ-F002-034). */}
      <div className="baseline-editor-actions">
        <Button variant="solid" disabled={previewing || disabled} onClick={onPreview}>
          {previewing ? 'Previewing…' : 'Preview changes'}
        </Button>
      </div>

      <ErrorBanner message={previewError} />

      {preview && (
        <div className="preview-panel">
          <p className="preview-summary">
            <strong>{preview.affectedCount}</strong> affected ·{' '}
            <strong>{preview.unchangedCount}</strong> unchanged
          </p>
          {preview.affectedCount === 0 ? (
            <p className="baseline-muted">No workspaces would change.</p>
          ) : (
            <ul className="preview-list">
              {preview.items
                .filter((i) => i.willChange || i.syncState === 'overridden')
                .map((item) => (
                  <PreviewDiffItem
                    key={item.workspaceId}
                    item={item}
                    resolution={overrides[item.workspaceId]}
                    onResolutionChange={onOverrideChange}
                  />
                ))}
            </ul>
          )}
        </div>
      )}

      <div className="baseline-apply-actions">
        <Button
          variant="danger"
          disabled={!canApply}
          onClick={onOpenConfirm}
          title={preview === null ? 'Preview to enable apply' : undefined}
          aria-describedby={showApplyHint ? 'baseline-apply-hint' : undefined}
        >
          Apply baseline
        </Button>
        {showApplyHint && (
          <span id="baseline-apply-hint" className="baseline-muted">
            Preview to enable apply.
          </span>
        )}
      </div>

      {confirmOpen && preview && (
        <DangerConfirm
          title="Apply baseline to workspaces"
          target={`${preview.affectedCount} workspace(s)`}
          consequence="Workspace prompts will be rewritten. Engine writes have no native undo — the console is the only record of the prior workspace-specific content."
          expectedToken={preview.confirmationPhrase}
          tokenLabel="confirmation phrase"
          confirmLabel="Apply baseline"
          error={applyError}
          busy={applying}
          onConfirm={onApply}
          onCancel={onCancelConfirm}
          fallbackFocusRef={headingRef}
        >
          {destructive.length > 0 && (
            <div className="danger-blast-radius">
              <p>
                <strong>{destructive.length}</strong> workspace(s) will have existing content{' '}
                <strong>discarded</strong> with no preserve/discard choice:
              </p>
              <ul>
                {destructive.map((i) => (
                  <li key={i.workspaceId}>{i.displayName}</li>
                ))}
              </ul>
            </div>
          )}
        </DangerConfirm>
      )}

      <div role="status" aria-live="polite">
        {result && (
          <div className="outcome-panel">
            <h3>Apply result</h3>
            <p className="outcome-summary">
              <strong>{result.appliedCount}</strong> applied · <strong>{result.failedCount}</strong>{' '}
              failed · <strong>{result.skippedCount}</strong> skipped ·{' '}
              <strong>{result.divergedCount}</strong> diverged
            </p>
            {result.failedCount + result.divergedCount > 0 && (
              <p className="outcome-warning">
                Some workspaces did not receive the baseline. Re-run apply to target the still-drifted
                set.
              </p>
            )}
            <ul className="outcome-list">
              {result.items.map((item) => (
                <li key={item.workspaceId} className={`outcome-${item.outcome}`}>
                  <span className="outcome-name">{item.displayName}</span>
                  <span className="outcome-tag">{OUTCOME_LABEL[item.outcome]}</span>
                  {item.message && <span className="outcome-message">{item.message}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
