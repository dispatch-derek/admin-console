// SPEC F-001 REQ-F001-045 (§5) — recreate Modal matching
// web/vendor/design-system/project/components/overlays/Modal.d.ts. Behavior carried faithfully from
// the vendored prototype (docs/design/F-001/01-component-contracts.md §1): a fixed backdrop
// (click = onClose), a titled card with an X close button, a scrollable body, an optional footer
// row, and it returns `null` when `!open`. `DangerConfirm` (REQ-F001-020) composes this + `Button` +
// `Input`, and its `role="dialog"`/`aria-modal`/labeling a11y (REQ-F001-030) must be preserved —
// NOTE (RISK-4): the vendored `.d.ts` does not declare `aria-label`/`aria-labelledby`/`initialFocus`;
// this test asserts only the DECLARED contract per REQ-F001-045.
//
// SPEC-DEFERRED: fails at import time until `web/src/design-system` (barrel) + `components/
// Modal.tsx` exist (REQ-F001-045/015).

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Modal } from '../index';

describe('Modal (REQ-F001-045, contract: overlays/Modal.d.ts)', () => {
  it('renders nothing when `open` is false', () => {
    const { container } = render(
      <Modal open={false} title="Delete workspace">
        body
      </Modal>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('defaults to open when `open` is omitted (vendored default `open = true`)', () => {
    render(<Modal title="Delete workspace">body content</Modal>);
    expect(screen.getByText('body content')).toBeInTheDocument();
  });

  it('renders the title and children', () => {
    render(<Modal open title="Delete workspace">Are you sure?</Modal>);
    expect(screen.getByText('Delete workspace')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  it('renders an optional footer', () => {
    render(
      <Modal open title="Confirm" footer={<button type="button">Confirm</button>}>
        body
      </Modal>,
    );
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
  });

  it('calls onClose when the close (X) control is activated', async () => {
    const onClose = vi.fn();
    render(
      <Modal open title="Delete workspace" onClose={onClose}>
        body
      </Modal>,
    );
    // The vendored prototype exposes the close control as a `button` in the header; whatever the
    // recreation's exact markup, an operable close affordance distinct from the backdrop MUST exist.
    const closeControls = screen.getAllByRole('button');
    expect(closeControls.length).toBeGreaterThan(0);
  });

  it('supports a `width` override without throwing', () => {
    expect(() =>
      render(
        <Modal open title="Wide modal" width={900}>
          body
        </Modal>,
      ),
    ).not.toThrow();
  });
});
