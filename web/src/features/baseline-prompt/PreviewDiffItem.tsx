// One workspace's current-vs-composed diff in the preview (REQ-F002-019). Branches on
// `resolvedMode` (REQ-F002-059):
//   prepend + not overridden → single current-vs-composed diff.
//   prepend + overridden     → preserve/discard choice; diff shows the SELECTED candidate
//                              (composedIfPreserve | composedIfDiscard) (REQ-F002-025/050).
//   baseline-only            → single current-vs-B diff; NO preserve/discard (exempt, REQ-F002-050);
//                              flagged as content-dropping.
//   overwrite                → current-vs-B with an explicit DESTROY marker on the current prompt.
//   fill (writable)          → "will be filled" empty-vs-B.
//   fill (skipped)           → skip message, no diff.

import type { BaselinePreviewItem, OverrideResolution } from '../../api/types';
import { SyncStateChip } from './SyncStateChip';

interface Props {
  item: BaselinePreviewItem;
  resolution: OverrideResolution | undefined;
  onResolutionChange: (workspaceId: string, resolution: OverrideResolution) => void;
}

function isOverriddenPrepend(item: BaselinePreviewItem): boolean {
  return (
    item.resolvedMode === 'prepend' &&
    item.composedIfPreserve !== undefined &&
    item.composedIfDiscard !== undefined
  );
}

export function PreviewDiffItem({ item, resolution, onResolutionChange }: Props) {
  const overriddenPrepend = isOverriddenPrepend(item);
  const skipped = item.resolvedMode === 'fill' && !item.willChange;
  const destructive =
    item.resolvedMode === 'overwrite' ||
    (item.resolvedMode === 'baseline-only' && item.syncState === 'overridden');

  // The composed side to show: overridden-prepend depends on the operator's not-yet-made choice.
  const composed = overriddenPrepend
    ? resolution === 'preserve'
      ? item.composedIfPreserve
      : resolution === 'discard'
        ? item.composedIfDiscard
        : undefined
    : (item.composedPrompt ?? undefined);

  return (
    <li className="preview-diff">
      <div className="preview-diff-head">
        <span className="preview-diff-name">{item.displayName}</span>
        <SyncStateChip state={item.syncState} />
        {destructive && (
          <span className="preview-destroy-tag">Discards existing content</span>
        )}
      </div>

      {skipped ? (
        <p className="baseline-muted">
          {item.message ?? 'Skipped — this workspace already has a prompt.'}
        </p>
      ) : (
        <>
          {overriddenPrepend && (
            <fieldset
              className="override-resolution"
              aria-label={`Resolve override for ${item.displayName}`}
            >
              <legend>This workspace was edited out-of-band. Choose how to re-apply:</legend>
              <label className="override-option">
                <input
                  type="radio"
                  name={`override-${item.workspaceId}`}
                  checked={resolution === 'preserve'}
                  onChange={() => onResolutionChange(item.workspaceId, 'preserve')}
                />
                <span>
                  <strong>Preserve</strong> — keep the current text as this workspace&apos;s
                  instructions, beneath the baseline.
                </span>
              </label>
              <label className="override-option">
                <input
                  type="radio"
                  name={`override-${item.workspaceId}`}
                  checked={resolution === 'discard'}
                  onChange={() => onResolutionChange(item.workspaceId, 'discard')}
                />
                <span>
                  <strong>Discard</strong> — drop the out-of-band edit and recompose from the stored
                  workspace text.
                </span>
              </label>
              {resolution === undefined && (
                <p className="override-warning">
                  Leave unresolved and this workspace will be <em>skipped</em> on apply.
                </p>
              )}
            </fieldset>
          )}

          <div className="preview-diff-cols">
            <div className={`diff-current${destructive ? ' diff-current-destroy' : ''}`}>
              <div className="diff-label">Current</div>
              <pre>{displayPrompt(item.currentPrompt)}</pre>
            </div>
            <div className="diff-composed">
              <div className="diff-label">
                {item.resolvedMode === 'fill' ? 'Will be filled with' : 'Will become'}
              </div>
              <pre>
                {composed === undefined ? (
                  <span className="baseline-muted">Choose preserve or discard above.</span>
                ) : (
                  displayPrompt(composed)
                )}
              </pre>
            </div>
          </div>
        </>
      )}
    </li>
  );
}

function displayPrompt(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '(empty)';
  return value;
}
