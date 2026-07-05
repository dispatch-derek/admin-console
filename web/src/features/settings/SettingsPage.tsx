// Instance settings (§7). The screen is DATA-DRIVEN: it loads GET /api/settings once per view open
// and renders whatever categories/controls the BFF returns — it holds no compiled-in engine keys
// or control-id literals (REQ-021a/101). All edits batch into ONE PATCH /api/settings (REQ-101).
// The response's per-control-id `verified` map drives per-field verification state (REQ-098a/098b):
// true = saved; observable false = not confirmed; secret/write-only false = submitted-but-unverified.
// It never shows a single "all saved" banner when any entry is false. A change to a provider-style
// selector (type 'select') or a security secret (auth token / JWT secret) is a §8 dangerous op — it
// is gated behind an explicit confirmation whose opening triggers a fresh GET /api/settings (REQ-092).

import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../../api/client';
import { ApiError } from '../../api/errors';
import { ErrorBanner } from '../../components/ErrorBanner';
import { DangerConfirm } from '../../components/DangerConfirm';
import { SecretField } from './SecretField';
import type {
  SettingControl,
  SettingsPatch,
  SettingsView,
} from '../../api/types';

type DraftValue = string | number | boolean | null;

// Classify a changed control as a §8 dangerous op WITHOUT referencing any engine key or control-id
// literal: provider-style selectors (type 'select', REQ-083/084) and security-category secrets
// (auth token / JWT secret, REQ-086). Category id is a structural product field, not an engine key.
function isDangerousControl(control: SettingControl, categoryId: string): boolean {
  if (control.type === 'select') return true;
  if (categoryId === 'security' && control.secret) return true;
  return false;
}

export function SettingsPage() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [draft, setDraft] = useState<Record<string, DraftValue>>({});
  const [verified, setVerified] = useState<Record<string, boolean> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<SettingsView | null> => {
    setLoadError(null);
    try {
      const v = await api.getSettings();
      setView(v);
      return v;
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Failed to load settings');
      return null;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Flat id → { control, categoryId } index for danger classification and status rendering.
  const controlIndex = useMemo(() => {
    const index = new Map<string, { control: SettingControl; categoryId: string }>();
    for (const category of view?.categories ?? []) {
      for (const control of category.controls) {
        index.set(control.id, { control, categoryId: category.id });
      }
    }
    return index;
  }, [view]);

  function setValue(id: string, value: DraftValue) {
    setDraft((d) => ({ ...d, [id]: value }));
    setVerified(null); // an edit after a write invalidates the stale verify status
  }

  // Build the batched patch: drop empty secrets (empty = no change, REQ-061).
  const buildPatch = useCallback((): SettingsPatch => {
    const patch: SettingsPatch = {};
    for (const [id, value] of Object.entries(draft)) {
      const entry = controlIndex.get(id);
      if (!entry) continue;
      if (entry.control.secret && (value === '' || value === null || value === undefined)) continue;
      patch[id] = value;
    }
    return patch;
  }, [draft, controlIndex]);

  const patch = buildPatch();
  const changedIds = Object.keys(patch);
  const dangerousIds = changedIds.filter((id) => {
    const entry = controlIndex.get(id);
    return entry ? isDangerousControl(entry.control, entry.categoryId) : false;
  });

  async function write() {
    setSaveError(null);
    setBusy(true);
    try {
      const result = await api.patchSettings(patch);
      setView({ categories: result.categories });
      setVerified(result.verified);
      setDraft({});
      setConfirming(false);
    } catch (err) {
      // No partial success (REQ-098): a non-OK write saved nothing, so DISCARD the pending
      // edits — every field reverts to its last persisted value (from `view`) rather than
      // showing the un-persisted, rejected input as if it were current. The failure is
      // surfaced at page level; any open danger dialog is closed.
      setSaveError(err instanceof ApiError ? err.message : 'Save failed');
      setDraft({});
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  async function onSave() {
    if (changedIds.length === 0) return;
    if (dangerousIds.length > 0) {
      // Fresh read before a dangerous settings change (REQ-092), then open the confirmation.
      await load();
      setConfirming(true);
      return;
    }
    await write();
  }

  if (loadError) return <ErrorBanner message={loadError} />;
  if (!view) return <p>Loading…</p>;

  const allVerified = verified !== null && Object.values(verified).every(Boolean);

  const renderControl = (control: SettingControl) => {
    const draftHas = Object.prototype.hasOwnProperty.call(draft, control.id);
    const status = verified?.[control.id];

    let field: React.ReactNode;
    if (control.secret) {
      field = (
        <SecretField
          id={control.id}
          label={control.label}
          set={control.set ?? false}
          value={draftHas ? String(draft[control.id] ?? '') : ''}
          onChange={(v) => setValue(control.id, v)}
        />
      );
    } else if (control.type === 'boolean') {
      const current = draftHas ? Boolean(draft[control.id]) : Boolean(control.value);
      field = (
        <label className="field checkbox">
          <input
            type="checkbox"
            checked={current}
            disabled={control.readOnly}
            onChange={(e) => setValue(control.id, e.target.checked)}
          />
          <span>{control.label}</span>
        </label>
      );
    } else {
      const current = draftHas
        ? String(draft[control.id] ?? '')
        : control.value === null || control.value === undefined
          ? ''
          : String(control.value);
      field = (
        <label className="field">
          <span>
            {control.label}
            {control.type === 'select' && <em className="hint"> (provider selector)</em>}
          </span>
          <input
            id={control.id}
            type={control.type === 'number' ? 'number' : 'text'}
            value={current}
            readOnly={control.readOnly}
            onChange={(e) =>
              setValue(
                control.id,
                control.type === 'number' && e.target.value !== ''
                  ? Number(e.target.value)
                  : e.target.value,
              )
            }
          />
        </label>
      );
    }

    return (
      <div key={control.id} className="control-row">
        {field}
        {status !== undefined && (
          <span className={status ? 'verify-ok' : 'verify-pending'}>
            {status
              ? 'Saved'
              : control.secret
                ? 'Submitted — not verified (re-check via the provider or re-enter)'
                : 'Not confirmed — may not have saved'}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="settings-page">
      <h2>Instance settings</h2>

      {view.categories.map((category) => (
        <section key={category.id} className="settings-category">
          <h3>{category.label}</h3>
          {category.controls.map(renderControl)}
        </section>
      ))}

      <ErrorBanner message={saveError} />
      {verified !== null &&
        (allVerified ? (
          <p className="success">All changes saved.</p>
        ) : (
          <p className="warning">Some changes could not be confirmed — see the fields above.</p>
        ))}

      <div className="settings-actions">
        <button type="button" disabled={busy || changedIds.length === 0} onClick={onSave}>
          Save changes ({changedIds.length})
        </button>
      </div>

      {confirming && (
        <DangerConfirm
          title="Confirm settings change"
          target={dangerousIds
            .map((id) => controlIndex.get(id)?.control.label ?? id)
            .join(', ')}
          consequence="Changing a provider selector or security credential affects instance-wide behavior: chat behavior may change, existing embeddings may be invalidated, and active sessions may be logged out. Review the current values before proceeding."
          confirmLabel="Apply changes"
          error={saveError}
          busy={busy}
          onConfirm={write}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
