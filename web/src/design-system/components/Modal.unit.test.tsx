// White-box unit tests for Modal (REQ-F001-045). Complements Modal.test.tsx (spec-level) by
// exercising: backdrop-click-vs-card-click branch (stopPropagation), the `onClose` optional branch
// (no close button rendered when `onClose` is absent), the default `width`, and the a11y invariants
// (role="dialog" + aria-modal + accessible name from `title`, REQ-F001-030/RISK-4 ruling).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from '../index';

describe('Modal (white-box)', () => {
  it('exposes role="dialog", aria-modal="true", and an accessible name derived from `title`', () => {
    render(
      <Modal open title="Delete workspace">
        body
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Delete workspace' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('clicking the backdrop (outside the card) calls onClose', () => {
    const onClose = vi.fn();
    render(
      <Modal open title="Confirm" onClose={onClose}>
        body
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking inside the card does NOT call onClose (event does not bubble to the backdrop)', () => {
    const onClose = vi.fn();
    render(
      <Modal open title="Confirm" onClose={onClose}>
        body content
      </Modal>,
    );
    fireEvent.click(screen.getByText('body content'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders no close (X) button when `onClose` is omitted', () => {
    render(
      <Modal open title="No close handler">
        body
      </Modal>,
    );
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  it('clicking the backdrop without an onClose handler does not throw', () => {
    render(
      <Modal open title="No handler">
        body
      </Modal>,
    );
    const backdrop = screen.getByRole('dialog').parentElement!;
    expect(() => fireEvent.click(backdrop)).not.toThrow();
  });

  it('defaults `width` to 672 (applied as inline maxWidth) when omitted', () => {
    render(
      <Modal open title="Default width">
        body
      </Modal>,
    );
    const dialog = screen.getByRole('dialog') as HTMLDivElement;
    expect(parseInt(dialog.style.maxWidth, 10)).toBe(672);
  });

  it('renders no footer wrapper when `footer` is omitted', () => {
    const { container } = render(
      <Modal open title="No footer">
        body
      </Modal>,
    );
    // Only header + body sections should be direct children of the card.
    const card = screen.getByRole('dialog');
    expect(card.children.length).toBe(2);
    expect(container.textContent).not.toMatch(/undefined/);
  });
});
