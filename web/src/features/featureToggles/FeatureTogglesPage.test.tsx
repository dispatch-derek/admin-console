// F-005 Per-Customer Feature Toggle Console — web UI (specs/F-005-per-customer-feature-toggle-
// console.md §8, REQ-F005-031..036/042/054..057). Written BEFORE any implementation exists (no
// `web/src/features/featureToggles/` directory yet), per the QA workflow's "derive from spec, not
// implementation" rule — mirrors the BFF route test files' own header note for the same situation.
// This whole file is expected to fail to even load right now ("Cannot find module
// './FeatureTogglesPage'") — an explicitly sanctioned RED reason (component module not found), not a
// test-authoring defect.
//
// SPEC-AMBIGUITY (flagged in the QA report; ambiguity #2 RATIFIED 2026-07-12 — see
// tests/TEST_PLAN.md's F-005 ambiguity section): the exact component path/name and the exact
// `web/src/api/client.ts` function names/signatures for F-005 are still not pinned by the spec
// itself (implementation detail), so this file still assumes:
//   - component: `web/src/features/featureToggles/FeatureTogglesPage.tsx`, exporting `FeatureTogglesPage`
//     (directory naming CONFIRMED 2026-07-12; the UX doc's `feature-toggles/` kebab-case spelling is
//     being corrected to match this camelCase `featureToggles/` directory, not the other way round)
//   - client fns: `listFeatureToggles()`, `setFeatureToggle(featureKey, enabled)`,
//     `clearFeatureToggleOverride(featureKey)` — matching the existing naming convention
//     (`listUsers`/`deleteUser`, `getSettings`/`patchSettings`) already used across
//     `web/src/features/*`. The API client module is mocked with an EXPLICIT factory (not
//     `vi.mock('../../api/client')` auto-mock) specifically so this file does not depend on those
//     exports already existing on the real module — only the HTTP/DOM contract matters.
//
// CONFIRM DIALOG (ambiguity #2 — RESOLVED, was OVERRULED): the ratified UX design doc
// `docs/design/ux/F-005-feature-toggle-console.md` (rev 2, §4.1/§4.2/§8) is authoritative here and
// wins over this file's prior `DangerConfirm`-checkbox-mode assumption: F-005 introduces its OWN new
// `ToggleConfirm` component wrapping the design-system `Modal` — `DangerConfirm` is EXPLICITLY named
// "deliberately not reused" (§4.1) because its typed-token/checkbox acknowledgement gate is reserved
// for irreversible ops, whereas a toggle is highly reversible (REQ-F005-047). `ToggleConfirm`'s
// footer is "ghost Cancel + PRIMARY (not danger) Confirm" with NO arming mechanism (no checkbox, no
// typed token) — the Confirm control is enabled as soon as the dialog opens; that immediacy IS the
// "lightweight, non-typed" gate REQ-F005-034/047 ratify. Tests below therefore:
//   - query `role="dialog"` (the same external focus-wrapper pattern `DangerConfirm` already applies
//     over the un-managed DS `Modal`, per the UX doc's §7 a11y notes, so `Modal` alone not
//     guaranteeing `role="dialog"` is not assumed to block this) + a non-Cancel Confirm button,
//   - click Confirm DIRECTLY with no prior arming step,
//   - do NOT import `ToggleConfirm`'s module directly and do NOT assert its internal structure/props
//     — only the rendered role/name/text contract the page produces is asserted, so these tests
//     remain valid even if the page renders `ToggleConfirm` via a different internal composition.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeatureTogglesPage } from './FeatureTogglesPage';

interface FeatureToggle {
  featureKey: string;
  displayName: string;
  description: string | null;
  category: string | null;
  defaultEnabled: boolean;
  enabled: boolean;
  hasOverride: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}
interface FeatureToggleListView {
  customerLabel: string;
  features: FeatureToggle[];
  counts: { enabled: number; disabled: number; total: number };
}

const listFeatureToggles = vi.fn();
const setFeatureToggle = vi.fn();
const clearFeatureToggleOverride = vi.fn();

vi.mock('../../api/client', () => ({
  listFeatureToggles: (...args: unknown[]) => listFeatureToggles(...args),
  setFeatureToggle: (...args: unknown[]) => setFeatureToggle(...args),
  clearFeatureToggleOverride: (...args: unknown[]) => clearFeatureToggleOverride(...args),
}));

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

function view(features: FeatureToggle[], overrides: Partial<FeatureToggleListView> = {}): FeatureToggleListView {
  const enabled = features.filter((f) => f.enabled).length;
  return {
    customerLabel: 'Acme Corp',
    features,
    counts: { enabled, disabled: features.length - enabled, total: features.length },
    ...overrides,
  };
}

function findConfirmButton(dialog: HTMLElement): HTMLElement {
  const buttons = within(dialog).getAllByRole('button');
  const confirm = buttons.find((b) => !/cancel/i.test(b.textContent ?? ''));
  if (!confirm) throw new Error('no non-Cancel button found in confirm dialog');
  return confirm;
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------------------------
// REQ-F005-031 (component-level slice) — not bound to a single workspace
// ---------------------------------------------------------------------------------------------

describe('REQ-F005-031 — not workspace-scoped', () => {
  it('renders with zero props / route params (customer-wide, not per-workspace)', async () => {
    listFeatureToggles.mockResolvedValue(view([feature()]));
    expect(() => render(<FeatureTogglesPage />)).not.toThrow();
    await screen.findByText('Invoice viewer');
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-F005-036 — loading & empty states
// ---------------------------------------------------------------------------------------------

describe('REQ-F005-036 — loading & empty states', () => {
  it('renders a loading affordance while GET /api/feature-toggles is in flight', async () => {
    let resolve: (v: FeatureToggleListView) => void;
    listFeatureToggles.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<FeatureTogglesPage />);
    // Some loading affordance must be present before data resolves — status role or visible text.
    expect(
      screen.queryByRole('status') ?? screen.queryByText(/loading/i),
    ).not.toBeNull();
    resolve!(view([]));
    await waitFor(() => expect(listFeatureToggles).toHaveBeenCalled());
  });

  it('REQ-F005-024 — an empty catalog renders the empty-state copy, not an error', async () => {
    listFeatureToggles.mockResolvedValue(view([]));
    render(<FeatureTogglesPage />);
    expect(await screen.findByText(/No features are defined for this install yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-F005-027 — customer/install label
// ---------------------------------------------------------------------------------------------

describe('REQ-F005-027 — customer/install label', () => {
  it('renders the customerLabel from the list view', async () => {
    listFeatureToggles.mockResolvedValue(view([feature()], { customerLabel: 'Acme Corp' }));
    render(<FeatureTogglesPage />);
    expect(await screen.findByText('Acme Corp')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-F005-032/054 — DS Toggle reuse, accessible name == displayName
// ---------------------------------------------------------------------------------------------

describe('REQ-F005-032/054 — each row is a role="switch" named for its displayName', () => {
  it('a row switch reflects the effective state and its accessible name equals displayName', async () => {
    listFeatureToggles.mockResolvedValue(
      view([feature({ featureKey: 'a', displayName: 'Feature A', enabled: true })]),
    );
    render(<FeatureTogglesPage />);
    const sw = await screen.findByRole('switch', { name: 'Feature A' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('multiple rows each get a distinct, correctly-matched accessible name', async () => {
    listFeatureToggles.mockResolvedValue(
      view([
        feature({ featureKey: 'a', displayName: 'Feature A', enabled: false }),
        feature({ featureKey: 'b', displayName: 'Feature B', enabled: true }),
      ]),
    );
    render(<FeatureTogglesPage />);
    expect(await screen.findByRole('switch', { name: 'Feature A' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('switch', { name: 'Feature B' })).toHaveAttribute('aria-checked', 'true');
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-F005-033 — non-color-only state + provenance encoding
// ---------------------------------------------------------------------------------------------

describe('REQ-F005-033 — state + provenance are legible without color alone', () => {
  it('a default (no-override) row carries text distinguishing it from an operator-set row', async () => {
    listFeatureToggles.mockResolvedValue(
      view([
        feature({ featureKey: 'a', displayName: 'Feature A', hasOverride: false }),
        feature({ featureKey: 'b', displayName: 'Feature B', hasOverride: true, updatedBy: 'staff-1' }),
      ]),
    );
    render(<FeatureTogglesPage />);
    await screen.findByRole('switch', { name: 'Feature A' });
    const rowA = screen.getByRole('switch', { name: 'Feature A' }).closest('*') as HTMLElement;
    const rowB = screen.getByRole('switch', { name: 'Feature B' }).closest('*') as HTMLElement;
    // The two rows' TEXT content must differ in a way that encodes provenance (not solely a color
    // class) — e.g. "Default" vs "Set by operator"/"Custom". We assert only that some distinguishing
    // text token exists and differs between rows, without prescribing the exact copy.
    const ancestorA = rowA.closest('li,tr,div[role="row"],div') ?? rowA;
    const ancestorB = rowB.closest('li,tr,div[role="row"],div') ?? rowB;
    expect(ancestorA.textContent).not.toBe(ancestorB.textContent);
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-F005-034/047/057 — confirmation & consequence framing
// ---------------------------------------------------------------------------------------------

describe('REQ-F005-034/057 — change confirmation names the feature + customer, asserts immediate effect', () => {
  it('flipping a switch opens a confirmation naming the feature and the customer BEFORE any write', async () => {
    listFeatureToggles.mockResolvedValue(
      view([feature({ featureKey: 'billing.invoices', displayName: 'Invoice viewer', enabled: false })], {
        customerLabel: 'Acme Corp',
      }),
    );
    render(<FeatureTogglesPage />);
    const sw = await screen.findByRole('switch', { name: 'Invoice viewer' });
    await userEvent.click(sw);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Invoice viewer');
    expect(dialog).toHaveTextContent('Acme Corp');
    expect(setFeatureToggle).not.toHaveBeenCalled();
  });

  it('REQ-F005-034/047 — the confirm control is enabled immediately (lightweight, non-typed — no arming step)', async () => {
    listFeatureToggles.mockResolvedValue(view([feature({ enabled: false })]));
    render(<FeatureTogglesPage />);
    await userEvent.click(await screen.findByRole('switch'));
    const dialog = await screen.findByRole('dialog');
    // No checkbox / typed-token input exists in this lightweight gate (DangerConfirm deliberately
    // not reused, ratified UX doc §4.1) — Confirm is immediately actionable.
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
    expect(findConfirmButton(dialog)).toBeEnabled();
  });

  it('REQ-F005-057 — the confirm copy asserts the change is IMMEDIATE for the customer', async () => {
    listFeatureToggles.mockResolvedValue(view([feature({ enabled: false })]));
    render(<FeatureTogglesPage />);
    await userEvent.click(await screen.findByRole('switch'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/immediately/i);
  });

  it('cancelling the confirmation leaves the switch in its prior state and issues no write', async () => {
    listFeatureToggles.mockResolvedValue(view([feature({ enabled: false })]));
    render(<FeatureTogglesPage />);
    const sw = await screen.findByRole('switch');
    await userEvent.click(sw);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(setFeatureToggle).not.toHaveBeenCalled();
  });

  it('confirming a set writes via setFeatureToggle(featureKey, enabled) and reflects the new state on success', async () => {
    const f = feature({ featureKey: 'billing.invoices', displayName: 'Invoice viewer', enabled: false });
    listFeatureToggles.mockResolvedValue(view([f]));
    setFeatureToggle.mockResolvedValue({
      ...f,
      enabled: true,
      hasOverride: true,
      updatedAt: '2026-07-12T00:00:00.000Z',
      updatedBy: 'staff-1',
    });
    render(<FeatureTogglesPage />);
    await userEvent.click(await screen.findByRole('switch', { name: 'Invoice viewer' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(findConfirmButton(dialog));

    expect(setFeatureToggle).toHaveBeenCalledWith('billing.invoices', true);
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Invoice viewer' })).toHaveAttribute('aria-checked', 'true'),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-F005-035 — success/failure reflection
// ---------------------------------------------------------------------------------------------

describe('REQ-F005-035 — failure leaves the prior state and shows the verbatim error', () => {
  it('a rejected setFeatureToggle call leaves the switch showing its prior state and renders the message via ErrorBanner', async () => {
    const f = feature({ featureKey: 'billing.invoices', displayName: 'Invoice viewer', enabled: false });
    listFeatureToggles.mockResolvedValue(view([f]));
    setFeatureToggle.mockRejectedValue(new Error('could not confirm the change was saved'));
    render(<FeatureTogglesPage />);
    await userEvent.click(await screen.findByRole('switch', { name: 'Invoice viewer' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(findConfirmButton(dialog));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('could not confirm the change was saved'));
    expect(screen.getByRole('switch', { name: 'Invoice viewer' })).toHaveAttribute('aria-checked', 'false');
    // Per the ratified UX doc §5 "ToggleConfirm — error" state: the dialog stays open on a failed
    // write (verbatim message shown IN the dialog) so the operator can retry or cancel — it is not
    // auto-dismissed out from under them.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-F005-055/056 — per-row Reset to default
// ---------------------------------------------------------------------------------------------

describe('REQ-F005-055 — per-row "Reset to default" gated on hasOverride', () => {
  it('a row WITH an override shows a "Reset to default" action', async () => {
    listFeatureToggles.mockResolvedValue(
      view([feature({ featureKey: 'a', displayName: 'Feature A', hasOverride: true, updatedBy: 'staff-1' })]),
    );
    render(<FeatureTogglesPage />);
    await screen.findByRole('switch', { name: 'Feature A' });
    expect(screen.getByRole('button', { name: /reset to default/i })).toBeInTheDocument();
  });

  it('a row WITHOUT an override does NOT show a "Reset to default" action', async () => {
    listFeatureToggles.mockResolvedValue(
      view([feature({ featureKey: 'a', displayName: 'Feature A', hasOverride: false })]),
    );
    render(<FeatureTogglesPage />);
    await screen.findByRole('switch', { name: 'Feature A' });
    expect(screen.queryByRole('button', { name: /reset to default/i })).not.toBeInTheDocument();
  });

  it('invoking Reset opens the confirm dialog and, on confirm, calls clearFeatureToggleOverride(featureKey)', async () => {
    const f = feature({
      featureKey: 'billing.invoices',
      displayName: 'Invoice viewer',
      enabled: true,
      hasOverride: true,
      updatedBy: 'staff-1',
      updatedAt: '2026-07-12T00:00:00.000Z',
    });
    listFeatureToggles.mockResolvedValue(view([f]));
    clearFeatureToggleOverride.mockResolvedValue({
      ...f,
      enabled: false,
      hasOverride: false,
      updatedAt: null,
      updatedBy: null,
    });
    render(<FeatureTogglesPage />);
    await screen.findByRole('switch', { name: 'Invoice viewer' });
    await userEvent.click(screen.getByRole('button', { name: /reset to default/i }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(findConfirmButton(dialog));

    expect(clearFeatureToggleOverride).toHaveBeenCalledWith('billing.invoices');
  });
});

describe('REQ-F005-056 — effective-state-unchanged reset is STILL confirmed, never silent', () => {
  it('resetting a feature whose override equals the default still opens the confirm dialog with "state will not change" copy', async () => {
    const f = feature({
      featureKey: 'billing.invoices',
      displayName: 'Invoice viewer',
      defaultEnabled: false,
      enabled: false, // override happens to equal the default
      hasOverride: true,
      updatedBy: 'staff-1',
      updatedAt: '2026-07-12T00:00:00.000Z',
    });
    listFeatureToggles.mockResolvedValue(view([f]));
    render(<FeatureTogglesPage />);
    await screen.findByRole('switch', { name: 'Invoice viewer' });
    await userEvent.click(screen.getByRole('button', { name: /reset to default/i }));

    const dialog = await screen.findByRole('dialog');
    // Never silently applied: clearFeatureToggleOverride must NOT have fired before confirmation.
    expect(clearFeatureToggleOverride).not.toHaveBeenCalled();
    // Spec REQ-F005-056's own paraphrase is "will not change"; the ratified UX doc §4.2 suggests the
    // literal copy "there is NO CHANGE to customer-visible state" — match either phrasing rather than
    // pinning one exact string the implementer didn't commit to verbatim.
    expect(dialog.textContent).toMatch(/will not change|no change/i);
  });
});

// ---------------------------------------------------------------------------------------------
// REQ-F005-042 — accessibility: focus management
// ---------------------------------------------------------------------------------------------

describe('REQ-F005-042 — confirmation dialog focus management', () => {
  it('opening the confirmation moves focus into the dialog', async () => {
    listFeatureToggles.mockResolvedValue(view([feature({ enabled: false })]));
    render(<FeatureTogglesPage />);
    const sw = await screen.findByRole('switch');
    sw.focus();
    await userEvent.click(sw);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('cancelling returns focus to the row that opened the dialog', async () => {
    listFeatureToggles.mockResolvedValue(view([feature({ enabled: false })]));
    render(<FeatureTogglesPage />);
    const sw = await screen.findByRole('switch');
    sw.focus();
    await userEvent.click(sw);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /cancel/i }));
    expect(screen.getByRole('switch')).toHaveFocus();
  });
});
