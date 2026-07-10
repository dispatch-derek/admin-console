// Instance settings (§7). The screen is DATA-DRIVEN: it loads GET /api/settings once per view open
// and renders whatever categories/controls the BFF returns — it holds no compiled-in engine keys
// or control-id literals (REQ-021a/101). All edits batch into ONE PATCH /api/settings (REQ-101).
// The response's per-control-id `verified` map drives per-field verification state (REQ-098a/098b):
// true = saved; observable false = not confirmed; secret/write-only false = submitted-but-unverified.
// It never shows a single "all saved" banner when any entry is false. A change to a provider-style
// selector (type 'select') or a security secret (auth token / JWT secret) is a §8 dangerous op — it
// is gated behind an explicit confirmation whose opening triggers a fresh GET /api/settings (REQ-092).
//
// Presentation mirrors the native AnythingLLM settings section: the shell renders one nav entry per
// category (passed via `categoryIds`), and within a category the per-provider control clusters
// (ids shaped `<category>.<provider>.<field>`) render as collapsible provider sections with the
// currently-selected provider expanded and badged. Grouping is derived structurally from the ids
// and labels the BFF returns — no control-id literals are compiled in.

import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../../api/client';
import { ApiError } from '../../api/errors';
import { ErrorBanner } from '../../components/ErrorBanner';
import { DangerConfirm } from '../../components/DangerConfirm';
import { SecretField } from './SecretField';
import { Button, Input, Select, Toggle } from '../../design-system';
import type {
  SettingCategory,
  SettingControl,
  SettingsPatch,
  SettingsView,
} from '../../api/types';

type DraftValue = string | number | boolean | null;

interface SettingsPageProps {
  // When present, only these categories render (the shell shows one category per sidebar page,
  // like the native AnythingLLM settings). Absent = render everything the BFF returned.
  categoryIds?: string[];
}

// A changed control is a §8 dangerous op iff the BFF flagged it so (server-authoritative:
// exactly the LLM-provider/embedding-engine/embedding-model/vector-db/auth-token/jwt-secret
// controls, REQ-083/084/086). The web gates confirmation on this flag rather than a client-side
// heuristic, so tts/stt selectors (not §8 ops) are correctly NOT gated.
function isDangerousControl(control: SettingControl): boolean {
  return control.dangerous === true;
}

// Structural grouping: a control id shaped `<category>.<group>.<field>` belongs to a provider
// group; shorter ids are category-level controls (the provider selector, shared knobs, flags).
function groupKeyOf(id: string): string | null {
  const parts = id.split('.');
  return parts.length >= 3 ? parts[1] : null;
}

// Catalog labels are em-dash paths mirroring the id ("Llm — Openai — Api Key"). Inside a titled
// page/group the leading segments are redundant, so display only the tail. Labels without the
// separator (and the danger-dialog summaries) pass through unchanged.
function displayLabel(control: SettingControl): string {
  const parts = control.label.split(' — ');
  if (parts.length >= 3) return parts.slice(2).join(' — ');
  if (parts.length === 2) return parts[1];
  return control.label;
}

function groupLabelOf(control: SettingControl, key: string): string {
  const parts = control.label.split(' — ');
  if (parts.length >= 3) return parts[1];
  // Fallback: prettify the camelCase id segment.
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

// Loose provider-name match between a selector value (engine vocabulary, e.g. "generic-openai")
// and a group id segment (product vocabulary, e.g. "genericOpenai").
function normalizeProviderName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function SettingsPage({ categoryIds }: SettingsPageProps = {}) {
  const [view, setView] = useState<SettingsView | null>(null);
  const [draft, setDraft] = useState<Record<string, DraftValue>>({});
  const [verified, setVerified] = useState<Record<string, boolean> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // Provider sections the operator explicitly opened/closed; unset = follow the active provider.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

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

  // The categories this page instance renders (the shell passes one per sidebar entry).
  const categories = useMemo(() => {
    const all = view?.categories ?? [];
    if (!categoryIds) return all;
    return all.filter((c) => categoryIds.includes(c.id));
  }, [view, categoryIds]);

  // Flat id → { control, categoryId } index for danger classification and status rendering,
  // limited to the categories THIS page renders so a save only batches its own edits.
  const controlIndex = useMemo(() => {
    const index = new Map<string, { control: SettingControl; categoryId: string }>();
    for (const category of categories) {
      for (const control of category.controls) {
        index.set(control.id, { control, categoryId: category.id });
      }
    }
    return index;
  }, [categories]);

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
    return entry ? isDangerousControl(entry.control) : false;
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
  if (!view) return <p className="ac-page-loading">Loading…</p>;

  const allVerified = verified !== null && Object.values(verified).every(Boolean);

  const renderControl = (control: SettingControl) => {
    const draftHas = Object.prototype.hasOwnProperty.call(draft, control.id);
    const status = verified?.[control.id];
    const label = displayLabel(control);

    let field: React.ReactNode;
    if (control.secret) {
      field = (
        <SecretField
          id={control.id}
          label={label}
          set={control.set ?? false}
          value={draftHas ? String(draft[control.id] ?? '') : ''}
          onChange={(v) => setValue(control.id, v)}
        />
      );
    } else if (control.type === 'boolean') {
      const current = draftHas ? Boolean(draft[control.id]) : Boolean(control.value);
      // A boolean setting is a genuine on/off switch → DS `Toggle` (role="switch"). This differs
      // from the §8 DangerConfirm acknowledgement, which stays a native checkbox (role="checkbox").
      field = (
        <Toggle
          label={label}
          enabled={current}
          disabled={control.readOnly}
          onChange={(next) => setValue(control.id, next)}
        />
      );
    } else {
      const current = draftHas
        ? String(draft[control.id] ?? '')
        : control.value === null || control.value === undefined
          ? ''
          : String(control.value);
      // A 'select' control renders a real dropdown ONLY when the BFF supplies an option set;
      // otherwise it degrades to validated free-text (the accepted provider enum values are not
      // grounded today, REQ-036b/064a — the dropdown is a forward hook).
      const asDropdown = control.type === 'select' && (control.options?.length ?? 0) > 0;
      const fieldLabel = control.type === 'select' ? `${label} (provider selector)` : label;
      if (asDropdown) {
        field = (
          <Select
            id={control.id}
            label={fieldLabel}
            value={current}
            disabled={control.readOnly}
            onChange={(e) => setValue(control.id, e.target.value)}
          >
            {!control.options!.some((o) => o.value === current) && (
              <option value={current}>{current || '— select —'}</option>
            )}
            {control.options!.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        );
      } else {
        field = (
          <Input
            id={control.id}
            label={fieldLabel}
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
        );
      }
    }

    return (
      <div key={control.id} className="ac-control-row">
        {field}
        {status !== undefined && (
          <span className={status ? 'ac-verify-ok' : 'ac-verify-pending'}>
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

  const renderCategory = (category: SettingCategory) => {
    // Category-level controls (selector + shared knobs) render first; the per-provider
    // clusters render as collapsible sections below, active provider expanded.
    const topControls: SettingControl[] = [];
    const groups: { key: string; label: string; controls: SettingControl[] }[] = [];
    const groupIndex = new Map<string, { key: string; label: string; controls: SettingControl[] }>();

    for (const control of category.controls) {
      const key = groupKeyOf(control.id);
      if (key === null) {
        topControls.push(control);
        continue;
      }
      let group = groupIndex.get(key);
      if (!group) {
        group = { key, label: groupLabelOf(control, key), controls: [] };
        groupIndex.set(key, group);
        groups.push(group);
      }
      group.controls.push(control);
    }

    // The category's provider/engine selector (a category-level 'select') decides which
    // provider section is "active": it gets the badge and opens by default.
    const selector = topControls.find((c) => c.type === 'select' && /\.(provider|engine)$/.test(c.id))
      ?? topControls.find((c) => c.type === 'select');
    const selectorValue = selector
      ? Object.prototype.hasOwnProperty.call(draft, selector.id)
        ? String(draft[selector.id] ?? '')
        : String(selector.value ?? '')
      : '';
    const activeKey = selectorValue
      ? groups.find((g) => normalizeProviderName(g.key) === normalizeProviderName(selectorValue))?.key ?? null
      : null;

    return (
      <section key={category.id} className="ac-settings-category">
        {categories.length > 1 && <h3 className="ac-category-title">{category.label}</h3>}
        {topControls.map(renderControl)}

        {groups.length > 0 && (
          <div className="ac-provider-groups">
            {groups.map((group) => {
              const stateKey = `${category.id}:${group.key}`;
              const open = openGroups[stateKey] ?? group.key === activeKey;
              return (
                <div key={group.key} className={`ac-provider-group${group.key === activeKey ? ' active' : ''}`}>
                  <button
                    type="button"
                    className="ac-provider-group-header"
                    aria-expanded={open}
                    onClick={() => setOpenGroups((s) => ({ ...s, [stateKey]: !open }))}
                  >
                    <span className="ac-provider-group-caret">{open ? '▾' : '▸'}</span>
                    <span className="ac-provider-group-name">{group.label}</span>
                    {group.key === activeKey && <span className="ac-badge ac-badge-active">Active</span>}
                  </button>
                  <div className={`ac-provider-group-body${open ? '' : ' collapsed'}`}>
                    {group.controls.map(renderControl)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="ac-settings-page">
      {categories.map(renderCategory)}

      <ErrorBanner message={saveError} />
      {verified !== null &&
        (allVerified ? (
          <p className="ac-success">All changes saved.</p>
        ) : (
          <p className="ac-warning">Some changes could not be confirmed — see the fields above.</p>
        ))}

      <div className="ac-settings-actions">
        <Button
          variant="cta"
          disabled={busy || changedIds.length === 0}
          onClick={onSave}
        >
          Save changes ({changedIds.length})
        </Button>
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
