// F-005 feature roster row (REQ-F005-020/032/033/055). Presentational: renders the DS `Toggle`
// (role="switch", accessible name = displayName via the DS's programmatic label binding,
// REQ-F005-054), an explicit On/Off text label + a glyph+text provenance Badge so state and
// provenance are legible WITHOUT relying on color alone (REQ-F005-033), the override meta when
// operator-set, and a per-row "Reset to default" action ONLY on rows with an override (REQ-F005-055).
// The switch is controlled by the effective `enabled` and is never flipped optimistically — the value
// changes only after a confirmed, successful write (REQ-F005-035).

import { Toggle, Badge, Button } from '../../design-system';
import type { FeatureToggle } from '../../api/types';

export interface FeatureToggleRowProps {
  feature: FeatureToggle;
  busy: boolean; // this row's write is in flight → switch disabled, "Saving…"
  disabled: boolean; // a confirm/write for another row is active (single-flight)
  onRequestChange: (next: boolean) => void; // Toggle.onChange → opens the set confirm
  onRequestReset: () => void; // "Reset to default" (rendered only when hasOverride)
}

export function FeatureToggleRow({
  feature,
  busy,
  disabled,
  onRequestChange,
  onRequestReset,
}: FeatureToggleRowProps) {
  return (
    <li className="feature-toggle-row">
      <div className="feature-row-main">
        <Toggle
          variant="horizontal"
          enabled={feature.enabled}
          label={feature.displayName}
          description={feature.description ?? undefined}
          disabled={busy || disabled}
          onChange={onRequestChange}
        />
      </div>

      <div className="feature-row-side">
        <span className="feature-state-label">{feature.enabled ? 'On' : 'Off'}</span>

        {feature.hasOverride ? (
          <Badge tone="info">
            <span aria-hidden="true">● </span>Operator-set
          </Badge>
        ) : (
          <Badge tone="neutral">
            <span aria-hidden="true">○ </span>Default
          </Badge>
        )}

        {feature.category && <span className="feature-category-tag">{feature.category}</span>}

        {feature.hasOverride && (
          <span className="feature-row-meta">
            Set by {feature.updatedBy} · {feature.updatedAt}
          </span>
        )}

        {busy && <span className="feature-saving">Saving…</span>}

        {feature.hasOverride && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || disabled}
            onClick={() => onRequestReset()}
          >
            Reset to default
          </Button>
        )}
      </div>
    </li>
  );
}
