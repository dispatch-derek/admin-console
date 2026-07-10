// Baseline editor (REQ-F002-015/016/018/046). A labeled textarea to view/define/replace the single
// customer-wide baseline, plus a Clear action. Whitespace-only is blocked client-side (REQ-F002-018)
// and by the BFF (400). Clearing is a distinct action with a lightweight confirm — it is NOT a §8
// danger op (it writes no engine state, REQ-F002-017/046); the strip only happens on the next apply.

import { useEffect, useState } from 'react';
import type { BaselinePrompt } from '../../api/types';
import { ErrorBanner } from '../../components/ErrorBanner';
import { Button, Textarea } from '../../design-system';

interface Props {
  baseline: BaselinePrompt | null;
  busy: boolean;
  saved: boolean;
  saveError: string | null;
  onSave: (text: string) => void;
  onClear: () => void;
}

export function BaselineEditor({ baseline, busy, saved, saveError, onSave, onClear }: Props) {
  const stored = baseline?.text ?? '';
  const [draft, setDraft] = useState(stored);
  const [confirmingClear, setConfirmingClear] = useState(false);

  // Re-sync the draft when the persisted baseline changes (after a save/clear round-trip).
  useEffect(() => {
    setDraft(stored);
  }, [stored]);

  const trimmed = draft.trim();
  const whitespaceOnly = draft.length > 0 && trimmed.length === 0;
  const changed = draft !== stored;
  const canSave = !busy && changed && trimmed.length > 0;

  return (
    <section className="baseline-region" aria-labelledby="baseline-editor-heading">
      <div className="baseline-region-header">
        <h2 id="baseline-editor-heading">Baseline system prompt</h2>
        {baseline?.text ? (
          <span className="baseline-muted">
            Updated {formatMeta(baseline.updatedAt)}
            {baseline.updatedBy ? ` by ${baseline.updatedBy}` : ''}
          </span>
        ) : (
          <span className="baseline-muted">Not yet defined</span>
        )}
      </div>

      <p className="baseline-help">
        Defined once here and fanned out to every workspace on an explicit apply. Saving stores the
        text only — no workspace prompt changes until you preview and apply below.
      </p>

      <Textarea
        label="Baseline text"
        className="baseline-textarea"
        rows={6}
        value={draft}
        disabled={busy}
        error={whitespaceOnly ? 'Baseline cannot be empty or whitespace-only; use Clear baseline to remove it.' : null}
        placeholder="e.g. You are a concise, professional assistant for Acme Corp…"
        onChange={(e) => setDraft(e.target.value)}
      />

      <ErrorBanner message={saveError} />

      <div className="baseline-editor-actions">
        <Button variant="cta" disabled={!canSave} onClick={() => onSave(trimmed)}>
          Save baseline
        </Button>
        {baseline?.text && !confirmingClear && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmingClear(true)}>
            Clear baseline
          </Button>
        )}
        {saved && <span className="ac-success baseline-saved">Saved.</span>}
      </div>

      {confirmingClear && (
        <div className="baseline-clear-confirm" role="group" aria-label="Confirm clear baseline">
          <p>
            Clear the baseline? This writes no workspace prompt on its own — previously-synced
            workspaces will show as <em>stale</em>, and the baseline is stripped from a workspace
            only on the next apply.
          </p>
          <div className="baseline-editor-actions">
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmingClear(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                setConfirmingClear(false);
                onClear();
              }}
            >
              Clear baseline
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function formatMeta(iso: string | null): string {
  if (!iso) return 'recently';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
