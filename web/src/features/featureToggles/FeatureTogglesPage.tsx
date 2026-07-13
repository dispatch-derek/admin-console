// F-005 Per-Customer Feature Toggle Console — stateful shell (REQ-F005-019/024/027/031/035/036/042).
// Fetches the list view, renders the customer/install label, counts summary, feature roster (or the
// first-class empty state), and owns the single-flight confirm→set/clear flow with success/failure
// reflection. Speaks ONLY the product /api/feature-toggles* routes (REQ-F005-029/039) — no engine
// field names cross this boundary. On a confirmed write it patches the returned FeatureToggle into
// the list and announces the outcome via an ARIA live region; on failure it keeps the confirm dialog
// open with the BFF { message } verbatim and leaves the row at its prior state (REQ-F005-035).

import { useEffect, useState } from 'react';
import {
  listFeatureToggles,
  setFeatureToggle,
  clearFeatureToggleOverride,
} from '../../api/client';
import type { FeatureToggle, FeatureToggleListView } from '../../api/types';
import { ErrorBanner } from '../../components/ErrorBanner';
import { FeatureToggleRow } from './FeatureToggleRow';
import { EmptyFeaturesState } from './EmptyFeaturesState';
import { ToggleConfirm, type ToggleConfirmAction } from './ToggleConfirm';

type PendingAction =
  | { kind: 'set'; feature: FeatureToggle; nextEnabled: boolean }
  | { kind: 'reset'; feature: FeatureToggle };

function recount(features: FeatureToggle[]): FeatureToggleListView['counts'] {
  const enabled = features.filter((f) => f.enabled).length;
  return { enabled, disabled: features.length - enabled, total: features.length };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function FeatureTogglesPage() {
  const [listView, setListView] = useState<FeatureToggleListView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [writing, setWriting] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    let active = true;
    listFeatureToggles()
      .then((v) => {
        if (active) {
          setListView(v);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setLoadError(errorMessage(err));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  function closeConfirm() {
    setPending(null);
    setWriteError(null);
  }

  async function handleConfirm() {
    if (!pending || !listView) return;
    setWriting(true);
    setWriteError(null);
    try {
      const key = pending.feature.featureKey;
      const updated =
        pending.kind === 'set'
          ? await setFeatureToggle(key, pending.nextEnabled)
          : await clearFeatureToggleOverride(key);
      const features = listView.features.map((f) => (f.featureKey === updated.featureKey ? updated : f));
      setListView({ ...listView, features, counts: recount(features) });
      // Announce the outcome truthfully per action kind (WCAG 4.1.3): a "set" reports the new
      // enabled/disabled state; a "reset to default" reports the revert — and, when clearing the
      // override does not change the effective state (REQ-F005-056), says so explicitly rather than
      // misleading an operator into thinking customer-visible behavior changed.
      const unchanged = pending.feature.enabled === updated.enabled;
      const announcement =
        pending.kind === 'reset'
          ? unchanged
            ? `${updated.displayName} reset to default for ${listView.customerLabel}; no change to the customer-visible state.`
            : `${updated.displayName} reset to default for ${listView.customerLabel}; now ${updated.enabled ? 'enabled' : 'disabled'}.`
          : `Feature ${updated.displayName} ${updated.enabled ? 'enabled' : 'disabled'} for ${listView.customerLabel}`;
      setAnnouncement(announcement);
      setPending(null);
      setWriteError(null);
    } catch (err: unknown) {
      // Keep the dialog open with the verbatim message; leave the row at its prior state (no
      // stranded optimistic "saved") (REQ-F005-035).
      setWriteError(errorMessage(err));
    } finally {
      setWriting(false);
    }
  }

  if (loading) {
    return (
      <div role="status" className="feature-loading">
        Loading…
      </div>
    );
  }

  if (loadError) {
    return <ErrorBanner message={loadError} />;
  }

  if (!listView) return null;

  const { customerLabel, features, counts } = listView;

  const confirmAction: ToggleConfirmAction | null = !pending
    ? null
    : pending.kind === 'set'
      ? {
          kind: 'set',
          featureKey: pending.feature.featureKey,
          displayName: pending.feature.displayName,
          nextEnabled: pending.nextEnabled,
        }
      : {
          kind: 'reset',
          featureKey: pending.feature.featureKey,
          displayName: pending.feature.displayName,
          resultEnabled: pending.feature.defaultEnabled,
          effectiveUnchanged: pending.feature.enabled === pending.feature.defaultEnabled,
        };

  return (
    <div className="feature-toggles-page">
      <div className="feature-customer-label">
        Acting on: <strong>{customerLabel}</strong>
      </div>

      <p className="feature-counts">
        <strong>{counts.enabled}</strong> enabled · <strong>{counts.disabled}</strong> disabled ·{' '}
        <strong>{counts.total}</strong> total
      </p>

      {features.length === 0 ? (
        <EmptyFeaturesState />
      ) : (
        <ul className="feature-roster" aria-label="Declared features">
          {features.map((f) => (
            <FeatureToggleRow
              key={f.featureKey}
              feature={f}
              busy={writing && pending?.feature.featureKey === f.featureKey}
              disabled={pending !== null && pending.feature.featureKey !== f.featureKey}
              onRequestChange={(next) => setPending({ kind: 'set', feature: f, nextEnabled: next })}
              onRequestReset={() => setPending({ kind: 'reset', feature: f })}
            />
          ))}
        </ul>
      )}

      {confirmAction && (
        <ToggleConfirm
          action={confirmAction}
          customerLabel={customerLabel}
          busy={writing}
          error={writeError}
          onConfirm={() => void handleConfirm()}
          onCancel={closeConfirm}
        />
      )}

      <div aria-live="polite" className="feature-announce">
        {announcement}
      </div>
    </div>
  );
}
