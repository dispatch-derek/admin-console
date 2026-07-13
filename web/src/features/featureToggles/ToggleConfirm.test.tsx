// White-box unit tests for ToggleConfirm (src/features/featureToggles/ToggleConfirm.tsx,
// REQ-F005-034/042/047/056/057). Rendered DIRECTLY with plain props — no FeatureTogglesPage, no
// api/client mocking — unlike the qa-engineer's FeatureTogglesPage.test.tsx, which only exercises
// this component indirectly through a full list-fetch + interaction flow and does not enumerate
// every consequence-copy/title branch or the focus-management contract in isolation. This file
// covers: title()/consequence() branch matrix (set enable/disable, reset unchanged/changed), the
// Cancel/Confirm footer wiring and busy-disables-both behavior, the ErrorBanner passthrough, and the
// REQ-F005-042 focus contract (initial focus onto the dialog heading, Escape-to-cancel, Tab trap
// wrapping in both directions, and focus restored to the opener on unmount) — mirroring the sibling
// DangerConfirm.test.tsx's coverage shape for the same borrowed focus-management pattern.

import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToggleConfirm, type ToggleConfirmAction } from './ToggleConfirm';

function setAction(overrides: Partial<Extract<ToggleConfirmAction, { kind: 'set' }>> = {}): ToggleConfirmAction {
  return {
    kind: 'set',
    featureKey: 'billing.invoices',
    displayName: 'Invoice viewer',
    nextEnabled: true,
    ...overrides,
  };
}

function resetAction(overrides: Partial<Extract<ToggleConfirmAction, { kind: 'reset' }>> = {}): ToggleConfirmAction {
  return {
    kind: 'reset',
    featureKey: 'billing.invoices',
    displayName: 'Invoice viewer',
    resultEnabled: false,
    effectiveUnchanged: false,
    ...overrides,
  };
}

describe('ToggleConfirm — title() (REQ-F005-034)', () => {
  it('a "set" action enabling the feature titles "Enable <displayName>"', () => {
    render(
      <ToggleConfirm
        action={setAction({ nextEnabled: true, displayName: 'Chat export' })}
        customerLabel="Acme"
        busy={false}
        error={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Enable “Chat export”' })).toBeInTheDocument();
  });

  it('a "set" action disabling the feature titles "Disable <displayName>"', () => {
    render(
      <ToggleConfirm
        action={setAction({ nextEnabled: false, displayName: 'Chat export' })}
        customerLabel="Acme"
        busy={false}
        error={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Disable “Chat export”' })).toBeInTheDocument();
  });

  it('a "reset" action titles "Reset <displayName> to default" regardless of effectiveUnchanged', () => {
    render(
      <ToggleConfirm
        action={resetAction({ displayName: 'Chat export', effectiveUnchanged: true })}
        customerLabel="Acme"
        busy={false}
        error={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Reset “Chat export” to default' })).toBeInTheDocument();
  });
});

describe('ToggleConfirm — consequence copy (REQ-F005-057 immediate-effect + REQ-F005-056 unchanged-state)', () => {
  it('a "set" enabling action asserts the feature will be IMMEDIATELY AVAILABLE, naming the customer', () => {
    render(
      <ToggleConfirm
        action={setAction({ nextEnabled: true, displayName: 'Chat export' })}
        customerLabel="Acme Corp"
        busy={false}
        error={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByText('“Chat export” will be immediately available in Acme Corp’s app.'),
    ).toBeInTheDocument();
  });

  it('a "set" disabling action asserts the feature will be IMMEDIATELY WITHHELD, naming the customer', () => {
    render(
      <ToggleConfirm
        action={setAction({ nextEnabled: false, displayName: 'Chat export' })}
        customerLabel="Acme Corp"
        busy={false}
        error={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByText('“Chat export” will be immediately withheld from Acme Corp’s app.'),
    ).toBeInTheDocument();
  });

  it('a "reset" action whose result differs from the current state uses the immediate-effect copy keyed on resultEnabled=true', () => {
    render(
      <ToggleConfirm
        action={resetAction({ resultEnabled: true, effectiveUnchanged: false, displayName: 'Chat export' })}
        customerLabel="Acme Corp"
        busy={false}
        error={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByText('“Chat export” will be immediately available in Acme Corp’s app.'),
    ).toBeInTheDocument();
  });

  it('a "reset" action whose result differs from the current state uses the withheld copy keyed on resultEnabled=false', () => {
    render(
      <ToggleConfirm
        action={resetAction({ resultEnabled: false, effectiveUnchanged: false, displayName: 'Chat export' })}
        customerLabel="Acme Corp"
        busy={false}
        error={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByText('“Chat export” will be immediately withheld from Acme Corp’s app.'),
    ).toBeInTheDocument();
  });

  it('REQ-F005-056 — a "reset" whose effective state is UNCHANGED states there is no customer-visible change, never the immediate-effect copy', () => {
    render(
      <ToggleConfirm
        action={resetAction({ effectiveUnchanged: true, resultEnabled: true, displayName: 'Chat export' })}
        customerLabel="Acme Corp"
        busy={false}
        error={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(
      screen.getByText(
        '“Chat export” to its default clears the operator override; there is no change to customer-visible state in Acme Corp’s app.',
        { exact: false },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/will be immediately/)).not.toBeInTheDocument();
  });
});

describe('ToggleConfirm — footer actions and busy state', () => {
  it('clicking Confirm calls onConfirm; clicking Cancel calls onCancel', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ToggleConfirm
        action={setAction()}
        customerLabel="Acme"
        busy={false}
        error={null}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('both Cancel and Confirm are disabled while busy', () => {
    render(
      <ToggleConfirm
        action={setAction()}
        customerLabel="Acme"
        busy={true}
        error={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('both Cancel and Confirm are enabled when not busy', () => {
    render(
      <ToggleConfirm
        action={setAction()}
        customerLabel="Acme"
        busy={false}
        error={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  });
});

describe('ToggleConfirm — error surfacing (REQ-F005-035 verbatim BFF message)', () => {
  it('renders the error message via role="alert" when error is a non-null string', () => {
    render(
      <ToggleConfirm
        action={setAction()}
        customerLabel="Acme"
        busy={false}
        error="could not confirm the change was saved"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('could not confirm the change was saved');
  });

  it('renders no alert when error is null', () => {
    render(
      <ToggleConfirm
        action={setAction()}
        customerLabel="Acme"
        busy={false}
        error={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('ToggleConfirm — focus management (REQ-F005-042)', () => {
  it('moves focus to the dialog heading on open', () => {
    render(
      <ToggleConfirm
        action={setAction()}
        customerLabel="Acme"
        busy={false}
        error={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('heading')).toHaveFocus();
  });

  it('Escape calls onCancel', async () => {
    const onCancel = vi.fn();
    render(
      <ToggleConfirm
        action={setAction()}
        customerLabel="Acme"
        busy={false}
        error={null}
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Tab from the last focusable element (Confirm) wraps to the first (Cancel)', () => {
    render(
      <ToggleConfirm
        action={setAction()}
        customerLabel="Acme"
        busy={false}
        error={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    confirm.focus();
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(cancel).toHaveFocus();
  });

  it('Shift+Tab from the first focusable element (Cancel) wraps to the last (Confirm)', () => {
    render(
      <ToggleConfirm
        action={setAction()}
        customerLabel="Acme"
        busy={false}
        error={null}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    cancel.focus();
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
    expect(confirm).toHaveFocus();
  });

  it('restores focus to the opener element when the dialog closes (unmount)', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          {open && (
            <ToggleConfirm
              action={setAction()}
              customerLabel="Acme"
              busy={false}
              error={null}
              onConfirm={() => {}}
              onCancel={() => setOpen(false)}
            />
          )}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    await userEvent.click(opener);
    expect(opener).not.toHaveFocus();

    await userEvent.keyboard('{Escape}');
    expect(opener).toHaveFocus();
  });
});
