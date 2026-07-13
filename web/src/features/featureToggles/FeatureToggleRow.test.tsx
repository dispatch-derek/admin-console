// White-box unit tests for FeatureToggleRow (REQ-F005-020/032/033/055), rendered DIRECTLY with plain
// props — no store, no api/client mocking, no confirm-dialog wiring, unlike
// FeatureTogglesPage.test.tsx (the qa-engineer's page-level integration suite, which drives this row
// only indirectly through a full list-fetch + interaction flow). This isolates the row's own
// conditional-render branches: the Operator-set vs Default provenance badge, the category tag's
// presence/absence, the "Reset to default" action gated strictly on hasOverride, the busy "Saving…"
// affordance, and the disabled-state propagation (busy || disabled) to both the Toggle and the Reset
// button.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FeatureToggleRow } from './FeatureToggleRow';
import type { FeatureToggle } from '../../api/types';

function feature(overrides: Partial<FeatureToggle> = {}): FeatureToggle {
  return {
    featureKey: 'billing.invoices',
    displayName: 'Invoice viewer',
    description: 'Lets the customer view generated invoices.',
    category: 'billing',
    defaultEnabled: false,
    enabled: false,
    hasOverride: false,
    updatedAt: null,
    updatedBy: null,
    ...overrides,
  };
}

function renderRow(overrides: Partial<FeatureToggle> = {}, rowProps: Partial<{ busy: boolean; disabled: boolean }> = {}) {
  const onRequestChange = vi.fn();
  const onRequestReset = vi.fn();
  render(
    <ul>
      <FeatureToggleRow
        feature={feature(overrides)}
        busy={rowProps.busy ?? false}
        disabled={rowProps.disabled ?? false}
        onRequestChange={onRequestChange}
        onRequestReset={onRequestReset}
      />
    </ul>,
  );
  return { onRequestChange, onRequestReset };
}

describe('FeatureToggleRow — provenance badge (REQ-F005-020/033)', () => {
  it('shows the "Default" badge when hasOverride is false', () => {
    renderRow({ hasOverride: false });
    expect(screen.getByText(/Default/)).toBeInTheDocument();
    expect(screen.queryByText(/Operator-set/)).not.toBeInTheDocument();
  });

  it('shows the "Operator-set" badge when hasOverride is true', () => {
    renderRow({ hasOverride: true, updatedBy: 'staff-1', updatedAt: '2026-07-12T00:00:00.000Z' });
    expect(screen.getByText(/Operator-set/)).toBeInTheDocument();
    expect(screen.queryByText(/^Default$/)).not.toBeInTheDocument();
  });

  it('shows the On/Off text label matching effective state, independent of the badge', () => {
    renderRow({ enabled: true });
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.queryByText('Off')).not.toBeInTheDocument();
  });

  it('shows "Off" when not effective-enabled', () => {
    renderRow({ enabled: false });
    expect(screen.getByText('Off')).toBeInTheDocument();
  });
});

describe('FeatureToggleRow — category tag', () => {
  it('renders the category tag when a category is present', () => {
    renderRow({ category: 'billing' });
    expect(screen.getByText('billing')).toBeInTheDocument();
  });

  it('renders no category tag when category is null', () => {
    renderRow({ category: null });
    expect(screen.queryByText('billing')).not.toBeInTheDocument();
  });
});

describe('FeatureToggleRow — REQ-F005-055 "Reset to default" gated strictly on hasOverride', () => {
  it('renders the Reset action when hasOverride is true', () => {
    renderRow({ hasOverride: true });
    expect(screen.getByRole('button', { name: /reset to default/i })).toBeInTheDocument();
  });

  it('does NOT render the Reset action when hasOverride is false', () => {
    renderRow({ hasOverride: false });
    expect(screen.queryByRole('button', { name: /reset to default/i })).not.toBeInTheDocument();
  });

  it('clicking Reset calls onRequestReset with no arguments', async () => {
    const { onRequestReset } = renderRow({ hasOverride: true });
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.setup().click(screen.getByRole('button', { name: /reset to default/i }));
    expect(onRequestReset).toHaveBeenCalledTimes(1);
    expect(onRequestReset).toHaveBeenCalledWith();
  });

  it('shows the "Set by <actor> · <timestamp>" meta line only when hasOverride is true', () => {
    renderRow({ hasOverride: true, updatedBy: 'staff-42', updatedAt: '2026-07-12T00:00:00.000Z' });
    expect(screen.getByText(/Set by staff-42/)).toBeInTheDocument();
  });

  it('shows no meta line when hasOverride is false', () => {
    renderRow({ hasOverride: false });
    expect(screen.queryByText(/Set by/)).not.toBeInTheDocument();
  });
});

describe('FeatureToggleRow — busy/disabled propagation', () => {
  it('shows "Saving…" when busy is true', () => {
    renderRow({}, { busy: true });
    expect(screen.getByText('Saving…')).toBeInTheDocument();
  });

  it('shows no "Saving…" affordance when busy is false', () => {
    renderRow({}, { busy: false });
    expect(screen.queryByText('Saving…')).not.toBeInTheDocument();
  });

  it('the switch is disabled when this row is busy', () => {
    renderRow({}, { busy: true });
    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true');
  });

  it('the switch is disabled when a SIBLING row is busy (single-flight `disabled` prop)', () => {
    renderRow({}, { busy: false, disabled: true });
    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true');
  });

  it('the switch is enabled when neither busy nor disabled', () => {
    renderRow({}, { busy: false, disabled: false });
    expect(screen.getByRole('switch')).not.toHaveAttribute('aria-disabled');
  });

  it('the Reset button is disabled when busy, even though hasOverride is true', () => {
    renderRow({ hasOverride: true }, { busy: true });
    expect(screen.getByRole('button', { name: /reset to default/i })).toBeDisabled();
  });

  it('the Reset button is disabled when a sibling row holds the single-flight lock', () => {
    renderRow({ hasOverride: true }, { disabled: true });
    expect(screen.getByRole('button', { name: /reset to default/i })).toBeDisabled();
  });
});

describe('FeatureToggleRow — switch accessible name and change forwarding', () => {
  it('the switch accessible name equals displayName (REQ-F005-054, delivered via the DS Toggle)', () => {
    renderRow({ displayName: 'Chat export' });
    expect(screen.getByRole('switch', { name: 'Chat export' })).toBeInTheDocument();
  });

  it('flipping the switch calls onRequestChange with the NEGATED enabled value', async () => {
    const { onRequestChange } = renderRow({ enabled: false }, { busy: false, disabled: false });
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.setup().click(screen.getByRole('switch'));
    expect(onRequestChange).toHaveBeenCalledWith(true);
  });
});
